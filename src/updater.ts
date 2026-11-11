/**
 * Auto-update module for @ulthon/ul-opencode-event.
 *
 * Checks the npm registry for a newer version of the plugin and reports it.
 *
 * OpenCode v2 manages plugin installations itself (see `opencode plugin update`),
 * so this module never touches the installation directory - it only reports
 * the available version.
 *
 * Zero runtime dependencies - only Node.js built-ins + project logger.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_NAME = '@ulthon/ul-opencode-event';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/-/package/${encodeURIComponent(PACKAGE_NAME)}/dist-tags`;
const NPM_FETCH_TIMEOUT = 5000;        // 5 seconds
const CACHE_TTL = 60 * 60 * 1000;      // 1 hour in ms

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

let versionCache: string | null | undefined = undefined;

export function resetVersionCache(): void {
  versionCache = undefined;
}

/**
 * Read the current installed version from this module's package.json
 * by walking up from `import.meta.url`.
 * Result is cached after first call.
 */
export function getCurrentVersion(): string | null {
  if (versionCache !== undefined) return versionCache;
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, 'package.json');
      try {
        const raw = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (pkg.name === PACKAGE_NAME) {
          versionCache = pkg.version ?? null;
          return versionCache;
        }
      } catch {
        // package.json not found here, walk up
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }
    versionCache = null;
    return versionCache;
  } catch {
    versionCache = null;
    return versionCache;
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
  /** OpenCode v1 config key */
  plugin?: string[];
  /** OpenCode v2 config key */
  plugins?: string[];
}

/**
 * Read the configured plugin list from the known configuration files.
 * Supports both the v1 (`plugin`) and the v2 (`plugins`) configuration keys.
 */
export function readPluginList(directory: string): string[] {
  const results: string[] = [];
  const candidates = [
    path.join(directory, '.opencode', 'opencode.json'),
    path.join(directory, '.opencode', 'opencode.jsonc'),
    path.join(directory, 'opencode.json'),
    path.join(getUserConfigDir(), 'opencode.json'),
    path.join(getUserConfigDir(), 'opencode.jsonc'),
  ];

  for (const cfgPath of candidates) {
    try {
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const settings = JSON.parse(raw) as SettingsJson;
      if (Array.isArray(settings.plugin)) {
        results.push(...settings.plugin);
      }
      if (Array.isArray(settings.plugins)) {
        results.push(...settings.plugins);
      }
    } catch {
      // file missing or invalid - skip
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
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Check npm for a newer release and report it.
 *
 * OpenCode v2 installs and updates plugins itself, so the plugin never
 * modifies the installation - it only logs the available version.
 */
export async function runAutoUpdate(ctx: any, autoUpdate: boolean): Promise<void> {
  try {
    const directory: string = ctx?.location?.directory ?? ctx?.directory ?? '';
    logger.info(`[updater] runAutoUpdate started, directory=${directory}, autoUpdate=${autoUpdate}`);

    // 1. Skip checks
    if (isLocalDevMode(directory)) {
      logger.info('[updater] Local development mode detected, skipping update check');
      return;
    }

    if (!autoUpdate) {
      logger.info('[updater] Update check disabled by configuration');
      return;
    }

    // 2. Get current version
    const currentVersion = getCurrentVersion();
    if (!currentVersion) {
      logger.warn('[updater] Could not determine current version');
      return;
    }

    // 3. Check cache first
    let latestVersion: string | null = null;

    if (isCacheValid()) {
      const cached = getCachedCheck();
      if (cached) {
        latestVersion = cached.latestVersion;
        logger.info(`[updater] Using cached version info: ${latestVersion}`);
      }
    }

    // 4. Fetch latest if no valid cache
    if (!latestVersion) {
      logger.info('[updater] Fetching latest version from npm...');
      latestVersion = await getLatestVersion();
      if (latestVersion) {
        setCachedCheck(latestVersion);
      }
    }

    if (!latestVersion) {
      logger.warn('[updater] Could not fetch latest version');
      return;
    }

    if (currentVersion === latestVersion) {
      logger.info(`[updater] Already on latest version: ${currentVersion}`);
      return;
    }

    const pinned = isPinnedVersion(directory);
    const suffix = pinned
      ? ' (配置已锁定版本，未自动更新)'
      : '，运行 `opencode plugin update` 更新';

    logger.info(
      `[updater] Update available: ${currentVersion} -> ${latestVersion}${suffix}`,
    );
  } catch (err) {
    logger.error(`[updater] Auto-update check failed: ${err}`);
  }
}
