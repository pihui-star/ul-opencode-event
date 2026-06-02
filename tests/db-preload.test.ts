import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import type { SessionTokenData } from '../src/types';

// ---------------------------------------------------------------------------
// Cache real fs/os/path BEFORE any mock.module('fs', ...) from other test
// files can poison the module registry.  Using require() at the top-level of
// an ESM file works in Bun and captures the native module directly.
// ---------------------------------------------------------------------------

const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');

// ---------------------------------------------------------------------------
// Mock state (reset before each test)
// ---------------------------------------------------------------------------

let mockRows: Array<{ id: string; session_id: string; data: string }> = [];
let dbConstructed = false;
let dbClosed = false;

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
// Mock bun:sqlite
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
      prepare(_sql: string) {
        return {
          all: () => mockRows,
        };
      }
      close() {
        dbClosed = true;
      }
    },
  };
});

// NOTE: Do NOT mock '../src/logger' — Bun mock.module is process-wide and
// would replace logger.error() with a no-op for ALL test files, breaking
// dingtalk.test.ts and email.test.ts error-logging assertions.
// The real logger works fine — db-preload only calls logger.debug() which
// is gated by DEBUG_ENABLED (false by default in test env).

// Dynamic import - evaluated AFTER mocks are registered.
const { preloadTokenData } = await import('../src/db-preload');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('preloadTokenData', () => {
  beforeEach(() => {
    mockRows = [];
    dbConstructed = false;
    dbClosed = false;
  });

  test('normal preload populates tokenDataMap from DB rows', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'msg-1',
        session_id: 'sess-abc',
        data: JSON.stringify({
          role: 'assistant',
          tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 3 } },
          cost: 0.0123,
          modelID: 'gpt-4',
          providerID: 'openai',
          mode: 'code',
        }),
      },
    ];
    await preloadTokenData(tokenDataMap, tempDir);
    expect(tokenDataMap.size).toBe(1);
    const session = tokenDataMap.get('sess-abc')!;
    expect(session.messages.size).toBe(1);
    expect(session.lastModelID).toBe('gpt-4');
    const td = session.messages.get('msg-1')!;
    expect(td.tokens.input).toBe(100);
    expect(td.tokens.output).toBe(50);
    expect(td.tokens.cacheRead).toBe(5);
    expect(td.tokens.cacheWrite).toBe(3);
    expect(td.tokens.total).toBe(100 + 50 + 5 + 3);
    expect(td.cost).toBe(0.0123);
    expect(dbClosed).toBe(true);
  });

  test('skips when DB file does not exist', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    await preloadTokenData(tokenDataMap, nonexistentDir);
    expect(tokenDataMap.size).toBe(0);
    expect(dbConstructed).toBe(false);
  });

  test('skips rows with invalid JSON without crashing', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      { id: 'msg-bad', session_id: 'sess-x', data: 'not-valid-json' },
      {
        id: 'msg-good',
        session_id: 'sess-x',
        data: JSON.stringify({
          role: 'assistant',
          tokens: { input: 10, output: 5 },
          cost: 0,
          modelID: 'm',
          providerID: 'p',
          mode: 'default',
        }),
      },
    ];
    await preloadTokenData(tokenDataMap, tempDir);
    expect(tokenDataMap.size).toBe(1);
    expect(tokenDataMap.get('sess-x')!.messages.has('msg-bad')).toBe(false);
    expect(tokenDataMap.get('sess-x')!.messages.has('msg-good')).toBe(true);
  });

  test('converts nested cache.read to flat cacheRead', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'msg-cache',
        session_id: 'sess-cache',
        data: JSON.stringify({
          role: 'assistant',
          tokens: { input: 200, output: 100, cache: { read: 42, write: 7 } },
          cost: 1.5,
          modelID: 'claude',
          providerID: 'anthropic',
          mode: 'ask',
        }),
      },
    ];
    await preloadTokenData(tokenDataMap, tempDir);
    const td = tokenDataMap.get('sess-cache')!.messages.get('msg-cache')!;
    expect(td.tokens.cacheRead).toBe(42);
    expect(td.tokens.cacheWrite).toBe(7);
    expect(td.tokens.total).toBe(200 + 100 + 42 + 7);
  });

  test('coerces null, undefined, NaN and empty-string token values to 0', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'msg-safe',
        session_id: 'sess-safe',
        data: JSON.stringify({
          role: 'assistant',
          tokens: { input: null, output: undefined, reasoning: NaN, cache: { read: '', write: null } },
          cost: undefined,
          modelID: 'model-x',
          providerID: 'prov-y',
          mode: 'mode-z',
        }),
      },
    ];
    await preloadTokenData(tokenDataMap, tempDir);
    const td = tokenDataMap.get('sess-safe')!.messages.get('msg-safe')!;
    expect(td.tokens.input).toBe(0);
    expect(td.tokens.output).toBe(0);
    expect(td.tokens.reasoning).toBe(0);
    expect(td.tokens.cacheRead).toBe(0);
    expect(td.tokens.cacheWrite).toBe(0);
    expect(td.tokens.total).toBe(0);
    expect(td.cost).toBe(0);
  });

  test('tracks lastModelID/lastProviderID/lastMode from the last row', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'msg-a',
        session_id: 'sess-multi',
        data: JSON.stringify({ role: 'assistant', tokens: { input: 10 }, cost: 0, modelID: 'model-a', providerID: 'prov-a', mode: 'mode-a' }),
      },
      {
        id: 'msg-b',
        session_id: 'sess-multi',
        data: JSON.stringify({ role: 'assistant', tokens: { input: 20 }, cost: 0.5, modelID: 'model-b', providerID: 'prov-b', mode: 'mode-b' }),
      },
    ];
    await preloadTokenData(tokenDataMap, tempDir);
    const session = tokenDataMap.get('sess-multi')!;
    expect(session.messages.size).toBe(2);
    expect(session.lastModelID).toBe('model-b');
    expect(session.lastProviderID).toBe('prov-b');
    expect(session.lastMode).toBe('mode-b');
  });

  test('skips rows where role is not assistant', async () => {
    const tokenDataMap = new Map<string, SessionTokenData>();
    mockRows = [
      {
        id: 'msg-user',
        session_id: 'sess-filter',
        data: JSON.stringify({ role: 'user', tokens: { input: 99, output: 99 }, cost: 99, modelID: 'm', providerID: 'p', mode: 'x' }),
      },
    ];
    await preloadTokenData(tokenDataMap, tempDir);
    expect(tokenDataMap.size).toBe(0);
  });
});
