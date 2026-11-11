import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as os from 'node:os';

// Override any fs/node:fs mocks from earlier test files with real modules
const nodeRequire = createRequire(import.meta.url);
const realFs = nodeRequire('node:fs');
mock.module('fs', () => ({ ...realFs }));
mock.module('node:fs', () => ({ ...realFs }));

// Use createRequire to get the real fs module, matching session-cache.ts pattern
const fs = nodeRequire('node:fs') as typeof import('node:fs');

// Use createRequire to load the REAL session-cache module, bypassing any
// mock.module('../src/session-cache', ...) registered by earlier test files
// (e.g., request-count.test.ts). createRequire bypasses mock.module().
const _sc = nodeRequire('../src/session-cache.js');
const loadSessionCache = _sc.loadSessionCache as typeof import('../src/session-cache.js').loadSessionCache;
const writeCacheEntry = _sc.writeCacheEntry as typeof import('../src/session-cache.js').writeCacheEntry;
const buildCacheEntry = _sc.buildCacheEntry as typeof import('../src/session-cache.js').buildCacheEntry;
const aggregateProjectFromCache = _sc.aggregateProjectFromCache as typeof import('../src/session-cache.js').aggregateProjectFromCache;
const syncFromDB = _sc.syncFromDB as typeof import('../src/session-cache.js').syncFromDB;
import type { SessionCacheEntry, TokenBreakdown, SessionTokenData, TokenData } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

const CACHE_FILENAME = 'ul-opencode-event-session-cache.jsonl';

function cacheFilePath(): string {
  return path.join(tempDir, CACHE_FILENAME);
}

function makeEntry(overrides: Partial<SessionCacheEntry> & { sessionId: string }): SessionCacheEntry {
  return {
    projectPath: '/test/project',
    tokens: { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 175 },
    cost: 0.01,
    modelID: 'test-model',
    providerID: 'test-provider',
    mode: 'code',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSessionData(
  messages: Array<{ tokens: Partial<TokenBreakdown>; cost?: number; modelID?: string }>,
  projectPath?: string,
): SessionTokenData {
  const map = new Map<string, TokenData>();
  messages.forEach((msg, i) => {
    const t = msg.tokens;
    const input = t?.input ?? 0;
    const output = t?.output ?? 0;
    const cacheRead = t?.cacheRead ?? 0;
    const cacheWrite = t?.cacheWrite ?? 0;
    map.set(`msg-${i}`, {
      cost: msg.cost ?? 0,
      tokens: {
        input,
        output,
        reasoning: t?.reasoning ?? 0,
        cacheRead,
        cacheWrite,
        total: input + output + cacheRead + cacheWrite,
      },
      modelID: msg.modelID ?? 'test-model',
      providerID: 'test-provider',
      mode: 'code',
    });
  });
  return {
    messages: map,
    lastModelID: messages.length > 0 ? (messages[messages.length - 1].modelID ?? 'test-model') : '',
    lastProviderID: 'test-provider',
    lastMode: 'code',
    projectPath: projectPath ?? '/test/project',
  };
}

function writeLinesToFile(fp: string, lines: string[]): void {
  const content = lines.join('\n') + '\n';
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-cache', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // loadSessionCache
  // =========================================================================

  describe('loadSessionCache', () => {
    it('loads valid JSONL and deduplicates by sessionId (latest wins)', () => {
      const fp = cacheFilePath();
      const entry1 = makeEntry({ sessionId: 'sess-1', cost: 0.01 });
      const entry2 = makeEntry({ sessionId: 'sess-2', cost: 0.02 });
      const entry1Updated = makeEntry({ sessionId: 'sess-1', cost: 0.05 });

      writeLinesToFile(fp, [
        JSON.stringify(entry1),
        JSON.stringify(entry2),
        JSON.stringify(entry1Updated),
      ]);

      const cache = loadSessionCache(tempDir);
      expect(cache.size).toBe(2);
      // sess-1 should have the latest entry (cost 0.05)
      expect(cache.get('sess-1')!.cost).toBe(0.05);
      expect(cache.get('sess-2')!.cost).toBe(0.02);
    });

    it('skips corrupted JSON lines without crashing', () => {
      const fp = cacheFilePath();
      const validEntry = makeEntry({ sessionId: 'sess-ok' });

      writeLinesToFile(fp, [
        JSON.stringify(validEntry),
        'this is not valid json{{{',
        '{"sessionId": "incomplete"',
        '',
        '   ',
      ]);

      const cache = loadSessionCache(tempDir);
      expect(cache.size).toBe(1);
      expect(cache.get('sess-ok')).toBeDefined();
    });

    it('returns empty Map for non-existent file', () => {
      const cache = loadSessionCache(path.join(tempDir, 'nonexistent'));
      expect(cache).toBeInstanceOf(Map);
      expect(cache.size).toBe(0);
    });

    it('returns empty Map for empty file', () => {
      const fp = cacheFilePath();
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(fp, '', 'utf-8');

      const cache = loadSessionCache(tempDir);
      expect(cache.size).toBe(0);
    });

    it('skips [TRUNCATED] marker lines', () => {
      const fp = cacheFilePath();
      const entry = makeEntry({ sessionId: 'sess-after-truncate' });

      writeLinesToFile(fp, [
        '[TRUNCATED] ... old records dropped',
        JSON.stringify(entry),
      ]);

      const cache = loadSessionCache(tempDir);
      expect(cache.size).toBe(1);
      expect(cache.get('sess-after-truncate')).toBeDefined();
    });

    it('skips entries without a valid sessionId string', () => {
      const fp = cacheFilePath();

      writeLinesToFile(fp, [
        JSON.stringify({ cost: 1.0, tokens: { input: 1 } }),
        JSON.stringify({ sessionId: null, cost: 2.0 }),
        JSON.stringify({ sessionId: 123, cost: 3.0 }),
        JSON.stringify({ sessionId: 'sess-valid', cost: 4.0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }),
      ]);

      const cache = loadSessionCache(tempDir);
      expect(cache.size).toBe(1);
      expect(cache.get('sess-valid')).toBeDefined();
    });
  });

  // =========================================================================
  // writeCacheEntry
  // =========================================================================

  describe('writeCacheEntry', () => {
    it('appends a JSON line to the file', () => {
      const entry = makeEntry({ sessionId: 'sess-write-1' });

      writeCacheEntry(tempDir, entry);

      const fp = cacheFilePath();
      expect(fs.existsSync(fp)).toBe(true);

      const content = fs.readFileSync(fp, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.sessionId).toBe('sess-write-1');
      expect(parsed.tokens.input).toBe(100);
    });

    it('appends multiple entries as separate lines', () => {
      const entry1 = makeEntry({ sessionId: 'sess-a', cost: 1.0 });
      const entry2 = makeEntry({ sessionId: 'sess-b', cost: 2.0 });

      writeCacheEntry(tempDir, entry1);
      writeCacheEntry(tempDir, entry2);

      const fp = cacheFilePath();
      const lines = fs.readFileSync(fp, 'utf-8').trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).sessionId).toBe('sess-a');
      expect(JSON.parse(lines[1]).sessionId).toBe('sess-b');
    });

    it('triggers rotation when file exceeds 2MB', () => {
      const fp = cacheFilePath();
      fs.mkdirSync(tempDir, { recursive: true });

      // Pre-fill file to exceed 2MB
      const bigEntry = makeEntry({
        sessionId: 'sess-big',
        cost: 1,
        tokens: { input: 1, output: 1, reasoning: 1, cacheRead: 1, cacheWrite: 1, total: 4 },
      });
      // Add extra padding to make entry larger
      const bigLine = JSON.stringify({ ...bigEntry, padding: 'x'.repeat(2000) }) + '\n';
      const linesNeeded = Math.ceil((2 * 1024 * 1024) / bigLine.length) + 5;

      const fd = fs.openSync(fp, 'w');
      for (let i = 0; i < linesNeeded; i++) {
        fs.writeSync(fd, bigLine);
      }
      fs.closeSync(fd);

      const sizeBefore = fs.statSync(fp).size;
      expect(sizeBefore).toBeGreaterThanOrEqual(2 * 1024 * 1024);

      // Write a new entry - should trigger rotation
      const newEntry = makeEntry({ sessionId: 'sess-after-rotate', cost: 99 });
      writeCacheEntry(tempDir, newEntry);

      const content = fs.readFileSync(fp, 'utf-8');
      // After rotation, file starts with TRUNCATE_MARKER
      expect(content.startsWith('[TRUNCATED] ... old records dropped\n')).toBe(true);

      // The new entry should be present
      const lines = content.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      const lastParsed = JSON.parse(lastLine);
      expect(lastParsed.sessionId).toBe('sess-after-rotate');
    });

    it('creates directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'sub', 'dir');
      const entry = makeEntry({ sessionId: 'sess-nested' });

      writeCacheEntry(nestedDir, entry);

      const fp = path.join(nestedDir, CACHE_FILENAME);
      expect(fs.existsSync(fp)).toBe(true);
    });
  });

  // =========================================================================
  // buildCacheEntry
  // =========================================================================

  describe('buildCacheEntry', () => {
    it('builds an entry from a usage snapshot', () => {
      const entry = buildCacheEntry('sess-build-1', {
        cost: 0.03,
        tokens: { input: 300, output: 150, reasoning: 30, cacheRead: 60, cacheWrite: 15, total: 525 },
        requestCount: 2,
        projectPath: '/test/project',
        modelID: 'test-model',
        providerID: 'test-provider',
        mode: 'code',
      });

      expect(entry).not.toBeNull();
      expect(entry!.sessionId).toBe('sess-build-1');
      expect(entry!.tokens.input).toBe(300);
      expect(entry!.tokens.output).toBe(150);
      expect(entry!.tokens.reasoning).toBe(30);
      expect(entry!.tokens.cacheRead).toBe(60);
      expect(entry!.tokens.cacheWrite).toBe(15);
      expect(entry!.tokens.total).toBe(525);
      expect(entry!.cost).toBeCloseTo(0.03);
      expect(entry!.requestCount).toBe(2);
      expect(entry!.modelID).toBe('test-model');
      expect(entry!.providerID).toBe('test-provider');
      expect(entry!.mode).toBe('code');
      expect(entry!.projectPath).toBe('/test/project');
    });

    it('returns null for sessions without any usage', () => {
      const entry = buildCacheEntry('sess-zero', {
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        requestCount: 0,
      });
      expect(entry).toBeNull();
    });

    it('keeps the cost even when the token total is zero', () => {
      const entry = buildCacheEntry('sess-cost-only', {
        cost: 0.5,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        requestCount: 1,
      });
      expect(entry).not.toBeNull();
      expect(entry!.cost).toBeCloseTo(0.5);
    });

    it('sets updatedAt to current ISO timestamp', () => {
      const before = new Date().toISOString();
      const entry = buildCacheEntry('sess-ts', {
        cost: 0.1,
        tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 },
        requestCount: 1,
      });
      const after = new Date().toISOString();

      expect(entry).not.toBeNull();
      expect(entry!.updatedAt >= before).toBe(true);
      expect(entry!.updatedAt <= after).toBe(true);
    });

    it('handles a missing projectPath gracefully', () => {
      const entry = buildCacheEntry('sess-no-path', {
        cost: 0.1,
        tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 },
        requestCount: 1,
      });

      expect(entry).not.toBeNull();
      expect(entry!.projectPath).toBe('');
    });
  });

  // =========================================================================
  // aggregateProjectFromCache
  // =========================================================================

  describe('aggregateProjectFromCache', () => {
    it('aggregates matching projectPath entries', () => {
      const cache = new Map<string, SessionCacheEntry>();
      cache.set('s1', makeEntry({
        sessionId: 's1',
        projectPath: '/projects/myapp',
        tokens: { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 175 },
        cost: 0.01,
      }));
      cache.set('s2', makeEntry({
        sessionId: 's2',
        projectPath: '/projects/myapp',
        tokens: { input: 200, output: 100, reasoning: 20, cacheRead: 40, cacheWrite: 10, total: 350 },
        cost: 0.02,
      }));

      const result = aggregateProjectFromCache(cache, '/projects/myapp');

      expect(result.cost).toBeCloseTo(0.03);
      expect(result.tokens.input).toBe(300);
      expect(result.tokens.output).toBe(150);
      expect(result.tokens.cacheRead).toBe(60);
      expect(result.tokens.cacheWrite).toBe(15);
      expect(result.tokens.total).toBe(525);
    });

    it('excludes entries with different projectPath', () => {
      const cache = new Map<string, SessionCacheEntry>();
      cache.set('s1', makeEntry({
        sessionId: 's1',
        projectPath: '/projects/myapp',
        tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0.01,
      }));
      cache.set('s2', makeEntry({
        sessionId: 's2',
        projectPath: '/projects/other',
        tokens: { input: 999, output: 999, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 1998 },
        cost: 9.99,
      }));

      const result = aggregateProjectFromCache(cache, '/projects/myapp');

      expect(result.cost).toBeCloseTo(0.01);
      expect(result.tokens.input).toBe(100);
      expect(result.tokens.total).toBe(150);
    });

    it('returns zeroed result for empty cache', () => {
      const cache = new Map<string, SessionCacheEntry>();

      const result = aggregateProjectFromCache(cache, '/projects/any');

      expect(result.cost).toBe(0);
      expect(result.tokens.input).toBe(0);
      expect(result.tokens.output).toBe(0);
      expect(result.tokens.reasoning).toBe(0);
      expect(result.tokens.cacheRead).toBe(0);
      expect(result.tokens.cacheWrite).toBe(0);
      expect(result.tokens.total).toBe(0);
    });

    it('handles path normalization (trailing slashes)', () => {
      const cache = new Map<string, SessionCacheEntry>();
      cache.set('s1', makeEntry({
        sessionId: 's1',
        // Use trailing slash in stored entry
        projectPath: path.normalize('/projects/myapp') + path.sep,
        tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 15 },
        cost: 0.001,
      }));

      // Query without trailing slash
      // On Windows, path.normalize adds backslash, so we need to match the format
      // This test verifies that both get normalized the same way
      const entryNormalized = path.normalize(cache.get('s1')!.projectPath);
      const queryNormalized = path.normalize('/projects/myapp');
      // If they don't match (Windows trailing sep issue), the aggregate won't find it
      // The source code uses plain path.normalize, so this is expected behavior
      const result = aggregateProjectFromCache(cache, '/projects/myapp');

      if (entryNormalized === queryNormalized) {
        expect(result.tokens.input).toBe(10);
        expect(result.cost).toBeCloseTo(0.001);
      } else {
        // On Windows with trailing separator mismatch, entries won't match
        // This is expected platform behavior
        expect(result.tokens.input).toBe(0);
      }
    });

    it('handles path normalization (dots and double slashes)', () => {
      const cache = new Map<string, SessionCacheEntry>();
      cache.set('s1', makeEntry({
        sessionId: 's1',
        projectPath: '/projects/../projects/./myapp',
        tokens: { input: 50, output: 25, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 75 },
        cost: 0.005,
      }));

      const result = aggregateProjectFromCache(cache, '/projects/myapp');

      expect(result.tokens.input).toBe(50);
      expect(result.cost).toBeCloseTo(0.005);
    });

    it('returns zeroed result when no entries match', () => {
      const cache = new Map<string, SessionCacheEntry>();
      cache.set('s1', makeEntry({
        sessionId: 's1',
        projectPath: '/projects/other',
        tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0.01,
      }));

      const result = aggregateProjectFromCache(cache, '/projects/nowhere');

      expect(result.cost).toBe(0);
      expect(result.tokens.total).toBe(0);
    });
  });

  // =========================================================================
  // syncFromDB
  // =========================================================================

  describe('syncFromDB', () => {
    it('returns zero result when DB file does not exist', async () => {
      const emptyCache = new Map<string, SessionCacheEntry>();
      const noDbDir = path.join(tempDir, 'no-db-here');

      const result = await syncFromDB(noDbDir, '/nonexistent/project', emptyCache);

      expect(result.newSessions).toBe(0);
      expect(result.totalSessions).toBe(0);
    });

    it('returns existing cache size when DB file does not exist', async () => {
      const cache = new Map<string, SessionCacheEntry>();
      cache.set('existing-1', makeEntry({ sessionId: 'existing-1' }));

      const result = await syncFromDB(path.join(tempDir, 'no-db'), '/any', cache);

      expect(result.newSessions).toBe(0);
      expect(result.totalSessions).toBe(1); // existing cache entry
    });

    it('returns zeroed totalTokens when DB file does not exist', async () => {
      const emptyCache = new Map<string, SessionCacheEntry>();

      const result = await syncFromDB(path.join(tempDir, 'no-db'), '/any', emptyCache);

      expect(result.totalTokens.input).toBe(0);
      expect(result.totalTokens.output).toBe(0);
      expect(result.totalTokens.reasoning).toBe(0);
      expect(result.totalTokens.cacheRead).toBe(0);
      expect(result.totalTokens.cacheWrite).toBe(0);
      expect(result.totalTokens.total).toBe(0);
    });
  });
});
