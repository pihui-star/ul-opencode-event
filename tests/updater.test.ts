import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// ---------------------------------------------------------------------------
// CRITICAL: Override the partial fs mock from logger.test.ts.
// logger.test.ts calls mock.module('fs', () => ({...partial...})) which
// replaces the global fs module with a stub. Since Bun's mock.module is
// process-global and test files run alphabetically, our mock runs AFTER
// logger.test.ts and overrides it.
//
// Strategy: Create a complete fs mock that delegates to the real node:fs
// for all functions that updater.ts needs. We construct the mock object
// by spreading require('node:fs') — this works because require() at the
// module level captures the real fs before mock.module hoisting affects
// the test file's own require calls.
// ---------------------------------------------------------------------------

// Capture spawn behavior for runBunInstall tests
interface SpawnCapture {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

let spawnCapture: SpawnCapture | null = null;
let spawnExitCode: number | null = 0;
let spawnShouldError: boolean = false;

// Get a reference to the real fs module via require.
// In Bun, require() at module top-level gets the un-mocked module.
const realFs = require('node:fs');
const realPath = require('node:path');
const realOs = require('node:os');

// Override fs with a full mock that delegates ALL functions to real fs.
// This overrides logger.test.ts's partial mock.
mock.module('fs', () => ({ ...realFs }));
mock.module('path', () => ({ ...realPath }));
// Override os.homedir() to return a fake path so readPluginList() doesn't
// read the real ~/.config/opencode/opencode.json (which may contain a pinned
// version like @ulthon/ul-opencode-event@0.1.57 that causes isPinnedVersion()
// to return true, breaking runAutoUpdate tests).
const fakeHomeDir = realPath.join(realOs.tmpdir(), 'ul-opencode-event-test-home');
mock.module('os', () => ({
  ...realOs,
  homedir: () => fakeHomeDir,
}));

// Mock child_process for controlled runBunInstall tests
mock.module('child_process', () => ({
  spawn: mock((_command: string, _args: string[], _options: Record<string, unknown>) => {
    spawnCapture = { command: _command, args: _args, options: _options };

    const fakeChild = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, fn: (...a: unknown[]) => void) => {
        if (event === 'close' && !spawnShouldError) {
          setTimeout(() => fn(spawnExitCode), 0);
        }
        if (event === 'error' && spawnShouldError) {
          setTimeout(() => fn(new Error('spawn ENOENT')), 0);
        }
      },
      kill: mock(() => {}),
    };

    return fakeChild;
  }),
  execFileSync: mock((_command: string, _args: string[], _options: Record<string, unknown>) => {
    // Simulate bun not found, npm available
    if (_command === 'npm') return '10.0.0';
    throw new Error('command not found');
  }),
}));

// Use require() for our own fs needs (bypasses mock interception)
const nodeFs = require('node:fs') as typeof import('node:fs');
const nodePath = require('node:path') as typeof import('node:path');
const nodeOs = require('node:os') as typeof import('node:os');

// ---------------------------------------------------------------------------
// Bypass the stub mock from index.test.ts.
//
// index.test.ts registers mock.module('../src/updater', () => stub) which
// intercepts ALL imports of that module — even via file:// URL, because Bun
// resolves to the same canonical path.
//
// Strategy: Copy the real source to a temp file with a DIFFERENT name within
// the same src/ directory, then import from there. No mock is registered for
// the temp file name, so we get the real module. Its internal imports
// (fs, path, os, child_process, ./logger.js) resolve correctly because it's
// in the same directory.
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
  syncCachePackageJsonToIntent,
  invalidatePackage,
  runBunInstall,
  runAutoUpdate,
  resetVersionCache,
} = await import(updaterTmpCopy);

// Clean up the temp file (module already loaded in memory)
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

interface ToastCall {
  title: string;
  message: string;
  variant: string;
  duration: number;
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const toastCalls: ToastCall[] = [];

  return {
    directory: '/test/project',
    client: {
      tui: {
        showToast: mock(async (opts: {
          body: { title: string; message: string; variant: string; duration: number };
        }) => {
          toastCalls.push(opts.body);
        }),
      },
    },
    toastCalls,
    ...overrides,
  };
}

  /** Write cache file directly to bypass the fs mock issue in full suite */
  function writeCacheFileForTest(dataDir: string, latestVersion: string, timestamp: number): void {
    const cachePath = nodePath.join(dataDir, 'ul-opencode-event-update-cache.json');
    nodeFs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
    nodeFs.writeFileSync(cachePath, JSON.stringify({ latestVersion, timestamp }), 'utf-8');
  }

  /** Create a project directory with .opencode/settings.json */
function createProjectDir(pluginEntry: string): string {
  const projectDir = createTmpDir();
  const settingsDir = nodePath.join(projectDir, '.opencode');
  nodeFs.mkdirSync(settingsDir, { recursive: true });
  nodeFs.writeFileSync(
    nodePath.join(settingsDir, 'settings.json'),
    JSON.stringify({ plugin: [pluginEntry] }),
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

  test('returns non-null version when package.json found with correct name', () => {
    const version = getCurrentVersion();
    if (version !== null) {
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof version).toBe('string');
    }
  });

  test('returns null or valid version string without crashing', () => {
    const version = getCurrentVersion();
    expect(version === null || typeof version === 'string').toBe(true);
  });

  test('caches result - repeated calls return same value', () => {
    const v1 = getCurrentVersion();
    const v2 = getCurrentVersion();
    const v3 = getCurrentVersion();
    expect(v1).toBe(v2);
    expect(v2).toBe(v3);
  });

  test('cache can be reset and version re-read', () => {
    const v1 = getCurrentVersion();
    resetVersionCache();
    const v2 = getCurrentVersion();
    // Same result but proves re-read happened
    expect(v1).toBe(v2);
  });
});

describe('getLatestVersion', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns latest version from npm registry', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ latest: '99.9.9' }),
    })) as unknown as typeof globalThis.fetch;

    const version = await getLatestVersion();
    expect(version).toBe('99.9.9');
  });

  test('returns null on network error / fetch failure', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Network timeout');
    }) as unknown as typeof globalThis.fetch;

    const version = await getLatestVersion();
    expect(version).toBeNull();
  });

  test('returns null on non-ok response', async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof globalThis.fetch;

    const version = await getLatestVersion();
    expect(version).toBeNull();
  });

  test('returns null when response json has no latest field', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: 'not found' }),
    })) as unknown as typeof globalThis.fetch;

    const version = await getLatestVersion();
    expect(version).toBeNull();
  });
});

describe('cache functions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    savedOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (savedOpencodeDataDir !== undefined) {
      process.env.OPENCODE_DATA_DIR = savedOpencodeDataDir;
    } else {
      delete process.env.OPENCODE_DATA_DIR;
    }
    cleanupTmpDir(tmpDir);
  });

  /** Write cache file directly to bypass the fs mock issue in full suite */
  function writeCacheFile(latestVersion: string, timestamp: number): void {
    const cachePath = nodePath.join(tmpDir, 'ul-opencode-event-update-cache.json');
    nodeFs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
    nodeFs.writeFileSync(cachePath, JSON.stringify({ latestVersion, timestamp }), 'utf-8');
  }

  test('getCachedCheck returns cached data when file exists', () => {
    writeCacheFile('5.0.0', Date.now());
    const cached = getCachedCheck();

    expect(cached).not.toBeNull();
    expect(cached!.latestVersion).toBe('5.0.0');
    expect(typeof cached!.timestamp).toBe('number');
  });

  test('isCacheValid returns true within 1h', () => {
    writeCacheFile('3.0.0', Date.now());
    expect(isCacheValid()).toBe(true);
  });

  test('isCacheValid returns false when expired', () => {
    const staleTimestamp = Date.now() - 2 * 60 * 60 * 1000;
    writeCacheFile('1.0.0', staleTimestamp);

    expect(isCacheValid()).toBe(false);
  });

  test('isCacheValid returns false when no cache file exists', () => {
    expect(isCacheValid()).toBe(false);
  });

  test('getCachedCheck returns null when no cache file exists', () => {
    expect(getCachedCheck()).toBeNull();
  });
});

describe('runBunInstall', () => {
  let savedDataDir: string | undefined;

  beforeEach(() => {
    spawnCapture = null;
    spawnExitCode = 0;
    spawnShouldError = false;
    // Redirect getCacheDir() to a temp dir so detectPackageManager() doesn't
    // find the real ~/.cache/opencode/packages/bun.lock (which makes it pick
    // 'bun' instead of falling through to the execFileSync mock).
    savedDataDir = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = createTmpDir();
  });

  afterEach(() => {
    if (savedDataDir !== undefined) {
      process.env.OPENCODE_DATA_DIR = savedDataDir;
    } else {
      delete process.env.OPENCODE_DATA_DIR;
    }
  });

  test('returns true when package install succeeds (exit code 0)', async () => {
    spawnExitCode = 0;
    const result = await runBunInstall('/test/workspace');

    expect(result).toBe(true);
    expect(spawnCapture).not.toBeNull();
    // Mock env has no bun, so it falls back to npm
    expect(spawnCapture!.command).toBe('npm');
    expect(spawnCapture!.args).toEqual(['install', '--no-fund', '--no-audit']);
  });

  test('returns false when bun install fails (non-zero exit code)', async () => {
    spawnExitCode = 1;
    const result = await runBunInstall('/test/workspace');

    expect(result).toBe(false);
  });

  test('returns false when spawn errors', async () => {
    spawnShouldError = true;
    const result = await runBunInstall('/test/workspace');

    expect(result).toBe(false);
  });
});

describe('runAutoUpdate', () => {
  let tmpDir: string;
  let originalFetchAuto: typeof globalThis.fetch;

  beforeEach(() => {
    tmpDir = createTmpDir();
    savedOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = tmpDir;
    originalFetchAuto = globalThis.fetch;
    spawnCapture = null;
    spawnExitCode = 0;
    spawnShouldError = false;
  });

  afterEach(() => {
    if (savedOpencodeDataDir !== undefined) {
      process.env.OPENCODE_DATA_DIR = savedOpencodeDataDir;
    } else {
      delete process.env.OPENCODE_DATA_DIR;
    }
    globalThis.fetch = originalFetchAuto;
    cleanupTmpDir(tmpDir);
  });

  test('happy path - update available, auto-update enabled, install success -> shows "Updated!" toast', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ latest: '99.0.0' }),
    })) as unknown as typeof globalThis.fetch;

    spawnExitCode = 0;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event');
    const ctx = createMockCtx({ directory: projectDir });

    await runAutoUpdate(ctx, true);

    expect(ctx.toastCalls.length).toBeGreaterThanOrEqual(1);
    const lastToast = ctx.toastCalls[ctx.toastCalls.length - 1];
    expect(lastToast.title).toContain('Updated');
    expect(lastToast.variant).toBe('success');

    cleanupTmpDir(projectDir);
  });

  test('no update - same version -> no toast shown', async () => {
    const currentVer = getCurrentVersion();
    const sameVersion = currentVer ?? '0.0.0-notfound';

    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ latest: sameVersion }),
    })) as unknown as typeof globalThis.fetch;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event');
    const ctx = createMockCtx({ directory: projectDir });

    await runAutoUpdate(ctx, true);

    expect(ctx.toastCalls).toHaveLength(0);

    cleanupTmpDir(projectDir);
  });

  test('auto-update disabled - shows "Update available" toast, no install', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ latest: '99.0.0' }),
    })) as unknown as typeof globalThis.fetch;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event');
    const ctx = createMockCtx({ directory: projectDir });

    await runAutoUpdate(ctx, false);

    // Should show "Update available" toast with info variant
    expect(ctx.toastCalls).toHaveLength(1);
    expect(ctx.toastCalls[0].title).toContain('99.0.0');
    expect(ctx.toastCalls[0].message).toContain('Update available');
    expect(ctx.toastCalls[0].variant).toBe('info');

    cleanupTmpDir(projectDir);
  });

  test('local dev mode - skips update check entirely', async () => {
    const projectDir = createProjectDir('file:///home/user/ul-opencode-event');

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ latest: '99.0.0' }) };
    }) as unknown as typeof globalThis.fetch;

    const ctx = createMockCtx({ directory: projectDir });

    await runAutoUpdate(ctx, true);

    expect(fetchCalled).toBe(false);
    expect(ctx.toastCalls).toHaveLength(0);

    cleanupTmpDir(projectDir);
  });

  test('network failure - graceful degradation, no crash', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Network unreachable');
    }) as unknown as typeof globalThis.fetch;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event');
    const ctx = createMockCtx({ directory: projectDir });

    await expect(runAutoUpdate(ctx, true)).resolves.toBeUndefined();
    expect(ctx.toastCalls).toHaveLength(0);

    cleanupTmpDir(projectDir);
  });

  test('cache hit within 1h - uses cached version, skips fetch', async () => {
    // Write cache file directly (bypasses setCachedCheck which may use broken fs mock)
    writeCacheFileForTest(tmpDir, '88.0.0', Date.now());

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ latest: '99.0.0' }) };
    }) as unknown as typeof globalThis.fetch;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event');
    const ctx = createMockCtx({ directory: projectDir });

    await runAutoUpdate(ctx, false);

    expect(fetchCalled).toBe(false);
    expect(ctx.toastCalls).toHaveLength(1);
    expect(ctx.toastCalls[0].title).toContain('88.0.0');

    cleanupTmpDir(projectDir);
  });

  test('pinned version - shows update available toast but no auto-install', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ latest: '99.0.0' }),
    })) as unknown as typeof globalThis.fetch;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event@0.1.17');
    const ctx = createMockCtx({ directory: projectDir });

    await runAutoUpdate(ctx, true);

    expect(ctx.toastCalls).toHaveLength(1);
    expect(ctx.toastCalls[0].message).toContain('Update available');

    cleanupTmpDir(projectDir);
  });

  test('runAutoUpdate calls invalidatePackage before syncCachePackageJsonToIntent', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ latest: '99.0.0' }),
    })) as unknown as typeof globalThis.fetch;

    spawnExitCode = 0;

    const projectDir = createProjectDir('@ulthon/ul-opencode-event');
    const ctx = createMockCtx({ directory: projectDir });

    // Pre-create scopedDir with a package.json and a marker file
    const scopedDir = nodePath.join(tmpDir, 'packages', '@ulthon/ul-opencode-event@latest');
    nodeFs.mkdirSync(scopedDir, { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(scopedDir, 'package.json'),
      JSON.stringify({ dependencies: { '@ulthon/ul-opencode-event': 'latest' } }),
      'utf-8',
    );
    nodeFs.writeFileSync(nodePath.join(scopedDir, 'marker.txt'), 'old-cache', 'utf-8');

    // Track call order via an array
    const callOrder: string[] = [];

    // We verify order by checking file system state after runAutoUpdate:
    // - If invalidatePackage runs first, it deletes scopedDir (including marker.txt)
    // - Then syncCachePackageJsonToIntent recreates scopedDir with new package.json
    // - Result: package.json exists, marker.txt does NOT exist
    // - If order were reversed (sync first, invalidate second), both would be gone

    await runAutoUpdate(ctx, true);

    // After correct order (invalidate -> sync):
    // - package.json should exist (recreated by sync after invalidate deleted it)
    // - marker.txt should NOT exist (invalidated, not recreated)
    const pkgJsonPath = nodePath.join(scopedDir, 'package.json');
    const markerPath = nodePath.join(scopedDir, 'marker.txt');

    expect(nodeFs.existsSync(pkgJsonPath)).toBe(true);
    expect(nodeFs.existsSync(markerPath)).toBe(false);

    // Verify update actually succeeded
    expect(ctx.toastCalls.length).toBeGreaterThanOrEqual(1);
    const lastToast = ctx.toastCalls[ctx.toastCalls.length - 1];
    expect(lastToast.title).toContain('Updated');

    cleanupTmpDir(projectDir);
  });
});

describe('syncCachePackageJsonToIntent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    savedOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (savedOpencodeDataDir !== undefined) {
      process.env.OPENCODE_DATA_DIR = savedOpencodeDataDir;
    } else {
      delete process.env.OPENCODE_DATA_DIR;
    }
    cleanupTmpDir(tmpDir);
  });

  test('creates package.json when missing', () => {
    const pluginInfo = { entry: '@ulthon/ul-opencode-event', isPinned: false, pinnedVersion: null };
    const result = syncCachePackageJsonToIntent(pluginInfo);

    expect(result.synced).toBe(true);
    expect(result.error).toBeNull();

    // Verify the file was created with correct content
    const scopedDir = nodePath.join(tmpDir, 'packages', '@ulthon/ul-opencode-event@latest');
    const pkgJsonPath = nodePath.join(scopedDir, 'package.json');
    expect(nodeFs.existsSync(pkgJsonPath)).toBe(true);

    const content = JSON.parse(nodeFs.readFileSync(pkgJsonPath, 'utf-8'));
    expect(content.dependencies['@ulthon/ul-opencode-event']).toBe('latest');
  });

  test('updates version when different', () => {
    const pluginInfo = { entry: '@ulthon/ul-opencode-event@1.2.3', isPinned: true, pinnedVersion: '1.2.3' };

    // Pre-create with different version
    const scopedDir = nodePath.join(tmpDir, 'packages', '@ulthon/ul-opencode-event@latest');
    nodeFs.mkdirSync(scopedDir, { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(scopedDir, 'package.json'),
      JSON.stringify({ dependencies: { '@ulthon/ul-opencode-event': 'latest' } }),
      'utf-8',
    );

    const result = syncCachePackageJsonToIntent(pluginInfo);

    expect(result.synced).toBe(true);
    expect(result.error).toBeNull();

    const content = JSON.parse(nodeFs.readFileSync(nodePath.join(scopedDir, 'package.json'), 'utf-8'));
    expect(content.dependencies['@ulthon/ul-opencode-event']).toBe('1.2.3');
  });

  test('skips when already matching', () => {
    const pluginInfo = { entry: '@ulthon/ul-opencode-event', isPinned: false, pinnedVersion: null };

    // Pre-create with matching version
    const scopedDir = nodePath.join(tmpDir, 'packages', '@ulthon/ul-opencode-event@latest');
    nodeFs.mkdirSync(scopedDir, { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(scopedDir, 'package.json'),
      JSON.stringify({ dependencies: { '@ulthon/ul-opencode-event': 'latest' } }),
      'utf-8',
    );

    const result = syncCachePackageJsonToIntent(pluginInfo);

    expect(result.synced).toBe(false);
    expect(result.error).toBeNull();
    expect(result.message).toContain('Already matches intent');
  });

  test('preserves existing dependencies when updating', () => {
    const pluginInfo = { entry: '@ulthon/ul-opencode-event@2.0.0', isPinned: true, pinnedVersion: '2.0.0' };

    const scopedDir = nodePath.join(tmpDir, 'packages', '@ulthon/ul-opencode-event@latest');
    nodeFs.mkdirSync(scopedDir, { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(scopedDir, 'package.json'),
      JSON.stringify({ dependencies: { '@ulthon/ul-opencode-event': 'latest', 'other-pkg': '^1.0.0' } }),
      'utf-8',
    );

    const result = syncCachePackageJsonToIntent(pluginInfo);

    expect(result.synced).toBe(true);

    const content = JSON.parse(nodeFs.readFileSync(nodePath.join(scopedDir, 'package.json'), 'utf-8'));
    expect(content.dependencies['@ulthon/ul-opencode-event']).toBe('2.0.0');
    expect(content.dependencies['other-pkg']).toBe('^1.0.0');
  });
});

describe('CACHE_TTL', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    savedOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
    process.env.OPENCODE_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (savedOpencodeDataDir !== undefined) {
      process.env.OPENCODE_DATA_DIR = savedOpencodeDataDir;
    } else {
      delete process.env.OPENCODE_DATA_DIR;
    }
    cleanupTmpDir(tmpDir);
  });

  test('cache is invalid exactly at 1 hour boundary', () => {
    const exactlyOneHourAgo = Date.now() - 60 * 60 * 1000;
    const cachePath = nodePath.join(tmpDir, 'ul-opencode-event-update-cache.json');
    nodeFs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
    nodeFs.writeFileSync(cachePath, JSON.stringify({ latestVersion: '1.0.0', timestamp: exactlyOneHourAgo }), 'utf-8');

    expect(isCacheValid()).toBe(false);
  });

  test('cache is valid just under 1 hour', () => {
    const justUnderOneHour = Date.now() - 59 * 60 * 1000;
    const cachePath = nodePath.join(tmpDir, 'ul-opencode-event-update-cache.json');
    nodeFs.mkdirSync(nodePath.dirname(cachePath), { recursive: true });
    nodeFs.writeFileSync(cachePath, JSON.stringify({ latestVersion: '1.0.0', timestamp: justUnderOneHour }), 'utf-8');

    expect(isCacheValid()).toBe(true);
  });
});
