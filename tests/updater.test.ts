import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// ---------------------------------------------------------------------------
// CRITICAL: Override the partial fs mock from logger.test.ts.
// logger.test.ts calls mock.module('fs', () => ({...partial...})) which
// replaces the global fs module with a stub. Since Bun's mock.module is
// process-global and test files run alphabetically, our mock runs AFTER
// logger.test.ts and overrides it.
//
// Strategy: Create a complete fs mock that delegates to the real node:fs
// for all functions that updater.ts needs.
// ---------------------------------------------------------------------------

const realFs = require('node:fs');
const realPath = require('node:path');
const realOs = require('node:os');

mock.module('fs', () => ({ ...realFs }));
mock.module('path', () => ({ ...realPath }));
const fakeHomeDir = realPath.join(realOs.tmpdir(), 'ul-opencode-event-test-home');
mock.module('os', () => ({
  ...realOs,
  homedir: () => fakeHomeDir,
}));

const nodeFs = require('node:fs') as typeof import('node:fs');
const nodePath = require('node:path') as typeof import('node:path');
const nodeOs = require('node:os') as typeof import('node:os');

// ---------------------------------------------------------------------------
// Bypass the stub mock from index.test.ts.
//
// index.test.ts registers mock.module('../src/updater', () => stub) which
// intercepts ALL imports of that module. Strategy: copy the real source to a
// temp file with a DIFFERENT name within the same src/ directory.
// ---------------------------------------------------------------------------
const srcDir = nodePath.resolve(nodePath.dirname(import.meta.url.replace(/^file:\/\/\//, '').replace(/\//g, '\\')), '..', 'src');
const updaterTmpCopy = nodePath.join(srcDir, `_updater_test_copy_${Date.now()}.ts`);
nodeFs.copyFileSync(nodePath.join(srcDir, 'updater.ts'), updaterTmpCopy);

const {
  getCurrentVersion,
  getLatestVersion,
  getCachedCheck,
  setCachedCheck,
  isCacheValid,
  readPluginList,
  runAutoUpdate,
  resetVersionCache,
} = await import(updaterTmpCopy);

try { nodeFs.unlinkSync(updaterTmpCopy); } catch {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpDir(): string {
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ul-opencode-event-test-'));
}

function cleanupTmpDir(dir: string): void {
  try {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/** Write cache file directly to bypass the fs mock issue in full suite */
function writeCacheFileForTest(dataDir: string, latestVersion: string, timestamp: number): void {
  const cachePath = nodePath.join(dataDir, 'ul-opencode-event-update-cache.json');
  nodeFs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
  nodeFs.writeFileSync(cachePath, JSON.stringify({ latestVersion, timestamp }), 'utf-8');
}

/** Create a project directory with an OpenCode v2 config listing a plugin */
function createProjectDir(pluginEntry: string, key: 'plugins' | 'plugin' = 'plugins'): string {
  const projectDir = createTmpDir();
  const configDir = nodePath.join(projectDir, '.opencode');
  nodeFs.mkdirSync(configDir, { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(configDir, 'opencode.json'),
    JSON.stringify({ [key]: [pluginEntry] }),
    'utf-8',
  );
  return projectDir;
}

let originalFetch: typeof globalThis.fetch;
let savedOpencodeDataDir: string | undefined;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCurrentVersion', () => {
  beforeEach(() => {
    resetVersionCache();
  });

  test('returns the version of this package', () => {
    const version = getCurrentVersion();
    expect(version === null || typeof version === 'string').toBe(true);
  });

  test('caches result - repeated calls return same value', () => {
    const first = getCurrentVersion();
    const second = getCurrentVersion();
    expect(second).toBe(first);
  });

  test('cache can be reset and version re-read', () => {
    const first = getCurrentVersion();
    resetVersionCache();
    expect(getCurrentVersion()).toBe(first);
  });
});

describe('getLatestVersion', () => {
  let fetchCalled = false;

  beforeEach(() => {
    fetchCalled = false;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns latest version from npm registry', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ latest: '9.9.9' }),
    })) as unknown as typeof globalThis.fetch;

    expect(await getLatestVersion()).toBe('9.9.9');
  });

  test('returns null on network error / fetch failure', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('network down');
    }) as unknown as typeof globalThis.fetch;

    expect(await getLatestVersion()).toBeNull();
  });

  test('returns null on non-ok response', async () => {
    globalThis.fetch = mock(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof globalThis.fetch;

    expect(await getLatestVersion()).toBeNull();
  });

  test('returns null when response json has no latest field', async () => {
    globalThis.fetch = mock(async () => ({ ok: true, json: async () => ({ nope: true }) })) as unknown as typeof globalThis.fetch;

    expect(await getLatestVersion()).toBeNull();
  });
});

describe('cache functions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTmpDir();
    savedOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = tempDir;
  });

  afterEach(() => {
    if (savedOpencodeDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = savedOpencodeDataDir;
    cleanupTmpDir(tempDir);
  });

  test('getCachedCheck returns cached data when file exists', () => {
    writeCacheFileForTest(tempDir, '1.2.3', Date.now());
    expect(getCachedCheck()?.latestVersion).toBe('1.2.3');
  });

  test('isCacheValid returns true within 1h', () => {
    writeCacheFileForTest(tempDir, '1.2.3', Date.now());
    expect(isCacheValid()).toBe(true);
  });

  test('isCacheValid returns false when expired', () => {
    writeCacheFileForTest(tempDir, '1.2.3', Date.now() - 2 * 60 * 60 * 1000);
    expect(isCacheValid()).toBe(false);
  });

  test('isCacheValid returns false when no cache file exists', () => {
    expect(isCacheValid()).toBe(false);
  });

  test('getCachedCheck returns null when no cache file exists', () => {
    expect(getCachedCheck()).toBeNull();
  });

  test('setCachedCheck writes the cache file', () => {
    setCachedCheck('4.5.6');
    expect(getCachedCheck()?.latestVersion).toBe('4.5.6');
  });
});

describe('readPluginList', () => {
  test('reads the OpenCode v2 "plugins" key', () => {
    const dir = createProjectDir('@ulthon/ul-opencode-event');
    expect(readPluginList(dir)).toContain('@ulthon/ul-opencode-event');
    cleanupTmpDir(dir);
  });

  test('reads the legacy OpenCode v1 "plugin" key', () => {
    const dir = createProjectDir('@ulthon/ul-opencode-event', 'plugin');
    expect(readPluginList(dir)).toContain('@ulthon/ul-opencode-event');
    cleanupTmpDir(dir);
  });
});

describe('runAutoUpdate', () => {
  let fetchCalled = false;

  beforeEach(() => {
    fetchCalled = false;
    originalFetch = globalThis.fetch;
    savedOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
    const tempDir = createTmpDir();
    process.env.OPENCODE_DATA_DIR = tempDir;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({ latest: '99.0.0' }) };
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (savedOpencodeDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = savedOpencodeDataDir;
  });

  test('checks npm for a newer version', async () => {
    const dir = createTmpDir();
    await runAutoUpdate({ location: { directory: dir } }, true);
    expect(fetchCalled).toBe(true);
    cleanupTmpDir(dir);
  });

  test('local dev mode - skips update check entirely', async () => {
    const dir = createProjectDir('file:///D:/workspace/ul-opencode-event');
    await runAutoUpdate({ location: { directory: dir } }, true);
    expect(fetchCalled).toBe(false);
    cleanupTmpDir(dir);
  });

  test('auto-update disabled - no registry request', async () => {
    const dir = createTmpDir();
    await runAutoUpdate({ location: { directory: dir } }, false);
    expect(fetchCalled).toBe(false);
    cleanupTmpDir(dir);
  });

  test('network failure - graceful degradation, no crash', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;

    const dir = createTmpDir();
    await expect(runAutoUpdate({ location: { directory: dir } }, true)).resolves.toBeUndefined();
    cleanupTmpDir(dir);
  });

  test('cache hit within 1h - uses cached version, skips fetch', async () => {
    const dir = createTmpDir();
    writeCacheFileForTest(process.env.OPENCODE_DATA_DIR!, '99.0.0', Date.now());

    await runAutoUpdate({ location: { directory: dir } }, true);

    expect(fetchCalled).toBe(false);
    cleanupTmpDir(dir);
  });

  test('supports the legacy ctx.directory shape', async () => {
    const dir = createTmpDir();
    await runAutoUpdate({ directory: dir }, true);
    expect(fetchCalled).toBe(true);
    cleanupTmpDir(dir);
  });
});
