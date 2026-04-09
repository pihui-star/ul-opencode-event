/**
 * Auto-update module for @ulthon/ul-opencode-event.
 *
 * Checks npm registry for new versions, manages a 1h cache,
 * and optionally runs `bun install` to auto-update.
 *
 * Zero runtime dependencies — only Node.js built-ins + project logger.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import type { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_NAME = '@ulthon/ul-opencode-event';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(PACKAGE_NAME)}/dist-tags`;
const NPM_FETCH_TIMEOUT = 5000;        // 5 seconds
const BUN_INSTALL_TIMEOUT = 60000;     // 60 seconds
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms

// ---------------------------------------------------------------------------
// Helpers: cache paths
// ---------------------------------------------------------------------------

function getCacheDir(): string {
  return process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.cache', 'opencode');
}

function getCacheFilePath(): string {
  return path.join(getCacheDir(), 'ul-opencode-event-update-cache.json');
}

function getUserConfigDir(): string {
  return path.join(os.homedir(), '.config', 'opencode');
}

// ---------------------------------------------------------------------------
// Exported: version resolution
// ---------------------------------------------------------------------------

/**
 * Read the current installed version from this module's package.json
 * by walking up from `import.meta.url`.
 */
export function getCurrentVersion(): string | null {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, 'package.json');
      try {
        const raw = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === PACKAGE_NAME) {
          return pkg.version ?? null;
        }
      } catch {
        // package.json not found here, walk up
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported: npm registry fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the latest version string from the npm dist-tags API.
 * Returns `null` on any error (network, parse, timeout).
 */
export async function getLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT);

    const resp = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timer);

    if (!resp.ok) {
      logger.debug(`[updater] npm registry returned status ${resp.status}`);
      return null;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    return typeof data.latest === 'string' ? data.latest : null;
  } catch (err) {
    logger.debug(`[updater] Failed to fetch latest version: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported: cache read / write / validity
// ---------------------------------------------------------------------------

export function getCachedCheck(): { latestVersion: string; timestamp: number } | null {
  try {
    const raw = fs.readFileSync(getCacheFilePath(), 'utf-8');
    return JSON.parse(raw) as { latestVersion: string; timestamp: number };
  } catch {
    return null;
  }
}

export function setCachedCheck(latestVersion: string): void {
  try {
    const obj = { latestVersion, timestamp: Date.now() };
    fs.mkdirSync(path.dirname(getCacheFilePath()), { recursive: true });
    fs.writeFileSync(getCacheFilePath(), JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`[updater] Failed to write update cache: ${err}`);
  }
}

export function isCacheValid(): boolean {
  const cached = getCachedCheck();
  if (!cached) return false;
  return Date.now() - cached.timestamp < CACHE_TTL;
}

// ---------------------------------------------------------------------------
// Helpers: dev-mode & pinned-version detection
// ---------------------------------------------------------------------------

interface SettingsJson {
  plugin?: string[];
}

function readPluginList(directory: string): string[] {
  const results: string[] = [];
  const candidates = [
    path.join(directory, '.opencode', 'settings.json'),
    path.join(directory, '.opencode', 'opencode.json'),
    path.join(getUserConfigDir(), 'settings.json'),
    path.join(getUserConfigDir(), 'opencode.json'),
  ];

  for (const cfgPath of candidates) {
    try {
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const settings = JSON.parse(raw) as SettingsJson;
      if (Array.isArray(settings.plugin)) {
        results.push(...settings.plugin);
      }
    } catch {
      // file missing or invalid — skip
    }
  }
  return results;
}

function isLocalDevMode(directory: string): boolean {
  try {
    const plugins = readPluginList(directory);
    return plugins.some(
      (entry) => entry.startsWith('file://') && entry.includes('ul-opencode-event'),
    );
  } catch {
    return false;
  }
}

const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

function isPinnedVersion(directory: string): boolean {
  try {
    const plugins = readPluginList(directory);
    return plugins.some((entry) => {
      // Match patterns like @ulthon/ul-opencode-event@1.2.3 or @ulthon/ul-opencode-event@1.2.3-beta.1
      if (!entry.includes('ul-opencode-event')) return false;
      const atIndex = entry.lastIndexOf('@');
      if (atIndex <= 0) return false; // no version part or starts with @ (scoped package)
      const version = entry.slice(atIndex + 1);
      // For scoped packages like @ulthon/ul-opencode-event@1.2.3, the lastIndexOf('@')
      // will find the second @. But we need to make sure the prefix is the scoped package.
      // So we check the version part matches exact semver.
      return EXACT_SEMVER_RE.test(version);
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helper: package invalidation
// ---------------------------------------------------------------------------

function invalidatePackage(): void {
  try {
    const scopedFlatDir = path.join(getCacheDir(), 'packages', `${PACKAGE_NAME}@latest`);
    const dirs: string[] = [
      path.join(getCacheDir(), 'packages', 'node_modules', PACKAGE_NAME),
      path.join(scopedFlatDir, 'node_modules', PACKAGE_NAME),
      path.join(getUserConfigDir(), 'node_modules', PACKAGE_NAME),
    ];

    for (const pkgDir of dirs) {
      try {
        if (fs.existsSync(pkgDir)) {
          fs.rmSync(pkgDir, { recursive: true, force: true });
          logger.info(`[updater] Invalidated package at ${pkgDir}`);
        }
      } catch (err) {
        logger.debug(`[updater] Could not remove ${pkgDir}: ${err}`);
      }
    }

    // Also remove the scoped flat install directory contents if present
    try {
      if (fs.existsSync(scopedFlatDir)) {
        fs.rmSync(scopedFlatDir, { recursive: true, force: true });
        logger.info(`[updater] Removed scoped flat directory ${scopedFlatDir}`);
      }
    } catch (err) {
      logger.debug(`[updater] Could not remove ${scopedFlatDir}: ${err}`);
    }

    // Also remove bun.lock / bun.lockb from workspace dirs
    const workspaceDirs = [
      path.join(getCacheDir(), 'packages'),
      getUserConfigDir(),
    ];
    for (const wsDir of workspaceDirs) {
      for (const lockFile of ['bun.lock', 'bun.lockb']) {
        const lockPath = path.join(wsDir, lockFile);
        try {
          if (fs.existsSync(lockPath)) {
            fs.rmSync(lockPath, { force: true });
            logger.info(`[updater] Removed ${lockPath}`);
          }
        } catch (err) {
          logger.debug(`[updater] Could not remove ${lockPath}: ${err}`);
        }
      }
    }
  } catch (err) {
    logger.error(`[updater] Package invalidation failed: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Exported: sync cache package.json to intended version
// ---------------------------------------------------------------------------

interface PluginInfo {
  entry: string;
  isPinned: boolean;
  pinnedVersion: string | null;
}

/**
 * Sync the workspace package.json to match the intended version from config.
 * Updates cacheDir/packages/@ulthon/ul-opencode-event@latest/package.json
 * with the version intent (latest or pinned).
 * Uses atomic write (write to temp + rename) to prevent corruption.
 */
export function syncCachePackageJsonToIntent(pluginInfo: PluginInfo): { synced: boolean; error: string | null; message?: string } {
  const intentVersion = pluginInfo.isPinned && pluginInfo.pinnedVersion ? pluginInfo.pinnedVersion : 'latest';
  const scopedDir = path.join(getCacheDir(), 'packages', `${PACKAGE_NAME}@latest`);
  const pkgJsonPath = path.join(scopedDir, 'package.json');

  try {
    // Ensure directory exists
    fs.mkdirSync(scopedDir, { recursive: true });

    let pkgJson: { dependencies?: Record<string, string> } = {};

    if (fs.existsSync(pkgJsonPath)) {
      const content = fs.readFileSync(pkgJsonPath, 'utf-8');
      pkgJson = JSON.parse(content) as { dependencies?: Record<string, string> };
      if (pkgJson.dependencies?.[PACKAGE_NAME] === intentVersion) {
        return { synced: false, error: null, message: `Already matches intent: ${intentVersion}` };
      }
    }

    pkgJson.dependencies = { ...pkgJson.dependencies, [PACKAGE_NAME]: intentVersion };

    // Atomic write: temp file + rename
    const tmpPath = `${pkgJsonPath}.${crypto.randomUUID()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(pkgJson, null, 2));
    fs.renameSync(tmpPath, pkgJsonPath);

    return { synced: true, error: null, message: `Updated to ${intentVersion}` };
  } catch (err) {
    return { synced: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve workspace directory
// ---------------------------------------------------------------------------

function resolveWorkspaceDir(): string {
  const configDir = getUserConfigDir();
  const packagesDir = path.join(getCacheDir(), 'packages');

  // 1. Config dir node_modules
  const configPkg = path.join(configDir, 'node_modules', PACKAGE_NAME, 'package.json');
  if (fs.existsSync(configPkg)) return configDir;

  // 2. Cache packages node_modules (traditional)
  const packagesPkg = path.join(packagesDir, 'node_modules', PACKAGE_NAME, 'package.json');
  if (fs.existsSync(packagesPkg)) return packagesDir;

  // 3. Cache packages flat (package.json in root)
  const flatPkg = path.join(packagesDir, 'package.json');
  if (fs.existsSync(flatPkg)) return packagesDir;

  // 4. Cache packages scoped flat (@ulthon/ul-opencode-event@latest/package.json)
  const scopedPkg = path.join(packagesDir, `${PACKAGE_NAME}@latest`, 'package.json');
  if (fs.existsSync(scopedPkg)) return path.join(packagesDir, `${PACKAGE_NAME}@latest`);

  // Default to packages dir (let bun install create what it needs)
  return packagesDir;
}

// ---------------------------------------------------------------------------
// Exported: bun install
// ---------------------------------------------------------------------------

/**
 * Execute `bun install` in the given workspace directory.
 * Uses Bun.spawn if available, otherwise falls back to child_process.spawn.
 */
export async function runBunInstall(workspaceDir: string): Promise<boolean> {
  try {
    const { spawn } = await import('child_process');

    return await new Promise<boolean>((resolve) => {
      const spawnOptions = {
        cwd: workspaceDir,
        windowsHide: true,
        shell: true as const,
      };

      const child: ChildProcess = spawn('bun', ['install'], spawnOptions);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Timeout guard
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        logger.warn('[updater] bun install timed out after 60s');
        resolve(false);
      }, BUN_INSTALL_TIMEOUT);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(true);
        } else {
          logger.warn(`[updater] bun install exited with code ${code}`);
          if (stderr) logger.debug(`[updater] bun install stderr: ${stderr}`);
          if (stdout) logger.debug(`[updater] bun install stdout: ${stdout}`);
          resolve(false);
        }
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        logger.error(`[updater] bun install spawn error: ${err}`);
        resolve(false);
      });
    });
  } catch (err) {
    logger.error(`[updater] bun install failed: ${err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helper: toast notification
// ---------------------------------------------------------------------------

async function showToast(
  ctx: any,
  title: string,
  message: string,
  variant: string,
  duration: number,
): Promise<void> {
  try {
    await ctx.client.tui
      .showToast({ body: { title, message, variant, duration } })
      .catch(() => {});
  } catch {
    logger.info(`[updater] ${title}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full auto-update flow:
 * 1. Skip checks (dev mode, pinned version)
 * 2. Get current version
 * 3. Check cache, fetch latest if stale
 * 4. Compare versions
 * 5. Notify or auto-update
 */
export async function runAutoUpdate(ctx: any, autoUpdate: boolean): Promise<void> {
  try {
    // 1. Skip checks
    if (isLocalDevMode(ctx.directory)) {
      logger.info('[updater] Local development mode detected, skipping update check');
      return;
    }

    if (isPinnedVersion(ctx.directory)) {
      logger.info('[updater] Pinned version detected, skipping auto-update');
      // Still check and notify, but don't auto-install
      autoUpdate = false;
    }

    // 2. Get current version
    const currentVersion = getCurrentVersion();
    if (!currentVersion) {
      logger.debug('[updater] Could not determine current version');
      return;
    }

    // 3. Check cache first
    let latestVersion: string | null = null;

    if (isCacheValid()) {
      const cached = getCachedCheck();
      if (cached) {
        latestVersion = cached.latestVersion;
        logger.debug(`[updater] Using cached version info: ${latestVersion}`);
      }
    }

    // 4. Fetch latest if no valid cache
    if (!latestVersion) {
      latestVersion = await getLatestVersion();
      if (latestVersion) {
        setCachedCheck(latestVersion);
      }
    }

    if (!latestVersion) {
      logger.debug('[updater] Could not fetch latest version');
      return;
    }

    // 5. Compare versions (simple string equality)
    if (currentVersion === latestVersion) {
      logger.debug(`[updater] Already on latest version: ${currentVersion}`);
      return;
    }

    logger.info(`[updater] Update available: ${currentVersion} -> ${latestVersion}`);

    // 6. If auto-update disabled, just notify
    if (!autoUpdate) {
      await showToast(
        ctx,
        `ul-opencode-event ${latestVersion}`,
        `Update available: v${currentVersion} -> v${latestVersion}\nRun: npm update @ulthon/ul-opencode-event`,
        'info',
        8000,
      );
      return;
    }

    // 7. Auto-update: sync -> invalidate -> resolve workspace -> bun install
    // First, find plugin info for sync
    const plugins = readPluginList(ctx.directory);
    const pluginEntry = plugins.find((e) => e.includes('ul-opencode-event')) ?? PACKAGE_NAME;
    const atIndex = pluginEntry.lastIndexOf('@');
    const pinnedVersion = atIndex > 0 ? pluginEntry.slice(atIndex + 1) : null;
    const isPinned = pinnedVersion !== null && EXACT_SEMVER_RE.test(pinnedVersion);
    const pluginInfo = { entry: pluginEntry, isPinned, pinnedVersion: isPinned ? pinnedVersion : null };

    // Sync workspace package.json to intent
    const syncResult = syncCachePackageJsonToIntent(pluginInfo);
    if (syncResult.error) {
      logger.warn(`[updater] Sync failed: ${syncResult.error}, continuing with notification only`);
      await showToast(ctx, `ul-opencode-event ${latestVersion}`, `Update available: v${currentVersion} -> v${latestVersion}\nSync failed, try manual update.`, 'info', 8000);
      return;
    }

    // Invalidate old package
    invalidatePackage();

    // Resolve workspace and install
    const workspaceDir = resolveWorkspaceDir();
    const success = await runBunInstall(workspaceDir);

    if (success) {
      await showToast(
        ctx,
        'ul-opencode-event Updated!',
        `v${currentVersion} -> v${latestVersion}\nRestart OpenCode to apply.`,
        'success',
        8000,
      );
      logger.info(`[updater] Update installed: ${currentVersion} -> ${latestVersion}`);
    } else {
      await showToast(
        ctx,
        'ul-opencode-event Update Failed',
        `Failed to install v${latestVersion}. Run manually: npm update @ulthon/ul-opencode-event`,
        'error',
        8000,
      );
      logger.warn('[updater] bun install failed, update not installed');
    }
  } catch (err) {
    logger.error(`[updater] Auto-update check failed: ${err}`);
  }
}
