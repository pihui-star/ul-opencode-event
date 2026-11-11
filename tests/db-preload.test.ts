import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import type { SessionTokenData } from '../src/types';

// ---------------------------------------------------------------------------
// Cache real fs/os/path BEFORE any mock.module('fs', ...) from other test
// files can poison the module registry.
// ---------------------------------------------------------------------------

const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Mock state (reset before each test)
// ---------------------------------------------------------------------------

let mockRows: Array<Record<string, unknown>> = [];
let mockTables: string[] = ['session_v2', 'session_message'];
let dbConstructed = false;
let dbClosed = false;
let lastSql = '';

// ---------------------------------------------------------------------------
// Real temp directory with empty opencode.db (so existsSync returns true)
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-preload-test-'));
fs.writeFileSync(path.join(tempDir, 'opencode.db'), '');
const nonexistentDir = path.join(os.tmpdir(), 'db-preload-nonexistent-' + Date.now());

afterAll(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Mock bun:sqlite (OpenCode v2 schema)
// ---------------------------------------------------------------------------

mock.module('bun:sqlite', () => {
  return {
    Database: class MockDatabase {
      constructor(filePath: string, _opts: { readonly: boolean }) {
        // Simulate real bun:sqlite behavior: readonly open throws if file missing
        if (!fs.existsSync(filePath)) {
          throw new Error(`SQLite: file not found: ${filePath}`);
        }
        dbConstructed = true;
      }
      prepare(sql: string) {
        lastSql = sql;
        return {
          all: () => mockRows,
          get: (name?: string) => {
            if (sql.includes('sqlite_master')) {
              return mockTables.includes(String(name)) ? { name } : undefined;
            }
            return undefined;
          },
        };
      }
      close() {
        dbClosed = true;
      }
    },
  };
});

// NOTE: Do NOT mock '../src/logger' - Bun mock.module is process-wide.

const { preloadTokenData, readSessionsFromDb } = await import('../src/db-preload');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readSessionsFromDb (OpenCode v2 schema)', () => {
  beforeEach(() => {
    mockRows = [];
    mockTables = ['session_v2', 'session_message'];
    dbConstructed = false;
    dbClosed = false;
    lastSql = '';
  });

  test('reads per-session aggregates from session_v2', async () => {
    mockRows = [
      {
        id: 'ses_1',
        directory: '/proj',
        parent_id: null,
        time_created: 1700000000000,
        cost: 0.25,
        tokens_input: 100,
        tokens_output: 50,
        tokens_reasoning: 10,
        tokens_cache_read: 5,
        tokens_cache_write: 3,
        request_count: 4,
      },
    ];

    const rows = await readSessionsFromDb(tempDir, { projectPath: '/proj' });

    expect(rows.length).toBe(1);
    expect(rows[0].sessionId).toBe('ses_1');
    expect(rows[0].cost).toBe(0.25);
    expect(rows[0].tokens.input).toBe(100);
    expect(rows[0].tokens.output).toBe(50);
    expect(rows[0].tokens.cacheRead).toBe(5);
    expect(rows[0].tokens.cacheWrite).toBe(3);
    expect(rows[0].tokens.total).toBe(100 + 50 + 5 + 3);
    expect(rows[0].requestCount).toBe(4);
    expect(lastSql).toContain('session_v2');
    expect(dbClosed).toBe(true);
  });

  test('falls back to the legacy schema when session_v2 is missing', async () => {
    mockTables = ['session', 'message'];
    mockRows = [
      {
        id: 'ses_legacy',
        directory: '/proj',
        parent_id: null,
        time_created: 1700000000000,
        cost: 1,
        tokens_input: 10,
        tokens_output: 5,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        request_count: 2,
      },
    ];

    const rows = await readSessionsFromDb(tempDir, { projectPath: '/proj' });

    expect(rows.length).toBe(1);
    expect(lastSql).toContain('FROM session s');
  });

  test('returns an empty list when the database file does not exist', async () => {
    const rows = await readSessionsFromDb(nonexistentDir, { projectPath: '/proj' });

    expect(rows.length).toBe(0);
    expect(dbConstructed).toBe(false);
  });
});

describe('preloadTokenData', () => {
  beforeEach(() => {
    mockRows = [];
    mockTables = ['session_v2', 'session_message'];
    dbConstructed = false;
    dbClosed = false;
  });

  test('stores one aggregate entry per session', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'ses_abc',
        directory: '/proj',
        parent_id: null,
        time_created: 1700000000000,
        cost: 0.0123,
        tokens_input: 100,
        tokens_output: 50,
        tokens_reasoning: 10,
        tokens_cache_read: 5,
        tokens_cache_write: 3,
        request_count: 7,
      },
    ];

    await preloadTokenData(tokenDataMap, tempDir);

    expect(tokenDataMap.size).toBe(1);
    const session = tokenDataMap.get('ses_abc')!;
    expect(session.messages.size).toBe(1);
    expect(session.requestCount).toBe(7);
    expect(session.projectPath).toBe(path.normalize('/proj'));

    const td = [...session.messages.values()][0];
    expect(td.tokens.input).toBe(100);
    expect(td.tokens.output).toBe(50);
    expect(td.tokens.cacheRead).toBe(5);
    expect(td.tokens.cacheWrite).toBe(3);
    expect(td.tokens.total).toBe(100 + 50 + 5 + 3);
    expect(td.cost).toBe(0.0123);
    expect(dbClosed).toBe(true);
  });

  test('skips when the DB file does not exist', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    await preloadTokenData(tokenDataMap, nonexistentDir);
    expect(tokenDataMap.size).toBe(0);
    expect(dbConstructed).toBe(false);
  });

  test('coerces null token values to 0', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'ses_safe',
        directory: '/proj',
        parent_id: null,
        time_created: 1700000000000,
        cost: null,
        tokens_input: null,
        tokens_output: undefined,
        tokens_reasoning: NaN,
        tokens_cache_read: '',
        tokens_cache_write: null,
        request_count: 0,
      },
    ];

    await preloadTokenData(tokenDataMap, tempDir);

    const td = [...tokenDataMap.get('ses_safe')!.messages.values()][0];
    expect(td.tokens.input).toBe(0);
    expect(td.tokens.output).toBe(0);
    expect(td.tokens.reasoning).toBe(0);
    expect(td.tokens.cacheRead).toBe(0);
    expect(td.tokens.cacheWrite).toBe(0);
    expect(td.tokens.total).toBe(0);
    expect(td.cost).toBe(0);
  });
});
