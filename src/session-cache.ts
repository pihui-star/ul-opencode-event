/**
 * Session token cache - persists completed session aggregate data to JSONL.
 *
 * Follows the exact same file I/O pattern as recorder.ts:
 * - createRequire to bypass test mocks
 * - Synchronous appendFileSync writes
 * - Auto-rotation at 2 MB (keeps newest half, line-boundary aligned)
 * - Silent failure: never throws, logs errors via logger
 */

import { createRequire } from 'node:module';
import * as path from 'node:path';
import { logger } from './logger.js';
import type { TokenBreakdown, SessionCacheEntry } from './types.js';

// Re-export for consumer convenience
export type { SessionCacheEntry } from './types.js';

// Use createRequire to get the real fs module, bypassing any test mock.module('fs')
const nodeRequire = createRequire(import.meta.url);
const fs = nodeRequire('node:fs') as typeof import('node:fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const CACHE_FILENAME = 'ul-opencode-event-session-cache.jsonl';
const TRUNCATE_MARKER = '[TRUNCATED] ... old records dropped\n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the absolute cache file path. */
function resolveCachePath(dataDir: string): string {
  return path.join(dataDir, CACHE_FILENAME);
}

/** Ensure the parent directory exists (non-fatal). */
function ensureDir(filePath: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // Directory creation failure is non-fatal.
  }
}

/** Truncate file by keeping only the second (newer) half, aligned to newline boundary. */
function truncate(fp: string): void {
  try {
    const content = fs.readFileSync(fp, 'utf-8');
    if (content.length === 0) return;

    const mid = Math.floor(content.length / 2);
    const nl = content.indexOf('\n', mid);
    const cut = nl >= 0 ? nl + 1 : mid;

    fs.writeFileSync(fp, TRUNCATE_MARKER + content.slice(cut), 'utf-8');
  } catch {
    // Truncation is best-effort - ignore failures silently
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the session cache from a JSONL file.
 * Uses "latest-per-session wins" deduplication: Map keyed by sessionId.
 * Never throws - returns empty Map on any error.
 */
export function loadSessionCache(dataDir: string): Map<string, SessionCacheEntry> {
  try {
    const fp = resolveCachePath(dataDir);
    let content: string;
    try {
      content = fs.readFileSync(fp, 'utf-8');
    } catch {
      // File doesn't exist yet - that's fine
      return new Map();
    }

    if (!content.trim()) {
      return new Map();
    }

    const cache = new Map<string, SessionCacheEntry>();
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[TRUNCATED]')) continue;

      try {
        const entry: SessionCacheEntry = JSON.parse(trimmed);
        if (entry && typeof entry === 'object' && typeof entry.sessionId === 'string') {
          cache.set(entry.sessionId, entry);
        }
      } catch {
        logger.warn(`Skipping corrupted cache line: ${trimmed.substring(0, 100)}`);
      }
    }

    return cache;
  } catch (err) {
    logger.error(`Failed to load session cache: ${err}`);
    return new Map();
  }
}

/**
 * Append one cache entry to the JSONL file.
 * Auto-rotates when file exceeds 2 MB. Never throws.
 */
export function writeCacheEntry(dataDir: string, entry: SessionCacheEntry): void {
  try {
    const fp = resolveCachePath(dataDir);
    ensureDir(fp);

    // Rotate if file exceeds max size
    try {
      const stat = fs.statSync(fp);
      if (stat.size >= DEFAULT_MAX_SIZE_BYTES) {
        truncate(fp);
      }
    } catch {
      // File may not exist yet - that's fine, we'll create it on append
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(fp, line, 'utf-8');
  } catch (err) {
    logger.error(`Failed to write cache entry: ${err}`);
  }
}

/**
 * Aggregate project-level totals from cache entries.
 * Filters by normalized projectPath, sums tokens and cost.
 * Returns zeroed result if no matches.
 */
export function aggregateProjectFromCache(
  cache: Map<string, SessionCacheEntry>,
  projectPath: string,
): { cost: number; tokens: TokenBreakdown; requestCount: number } {
  const normalized = path.normalize(projectPath);
  let cost = 0;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let requestCount = 0;

  for (const entry of cache.values()) {
    if (path.normalize(entry.projectPath) === normalized) {
      cost += entry.cost;
      input += entry.tokens.input;
      output += entry.tokens.output;
      reasoning += entry.tokens.reasoning;
      cacheRead += entry.tokens.cacheRead;
      cacheWrite += entry.tokens.cacheWrite;
      requestCount += entry.requestCount;
    }
  }

  return {
    cost,
    tokens: {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + cacheRead + cacheWrite,
    },
    requestCount,
  };
}

/**
 * Build a cache entry from a session usage snapshot.
 * Returns null when the session has no usage at all (nothing worth caching).
 */
export function buildCacheEntry(
  sessionId: string,
  data: {
    cost: number;
    tokens: TokenBreakdown;
    requestCount: number;
    projectPath?: string;
    modelID?: string;
    providerID?: string;
    mode?: string;
  },
): SessionCacheEntry | null {
  const tokens = data.tokens;

  // If all token fields are zero, return null
  if (tokens.total === 0 && data.cost === 0) {
    return null;
  }

  return {
    sessionId,
    projectPath: data.projectPath ?? '',
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      total: tokens.total,
    },
    cost: data.cost,
    modelID: data.modelID ?? '',
    providerID: data.providerID ?? '',
    mode: data.mode ?? '',
    requestCount: data.requestCount,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Convert cached entries of a project back into usage rows.
 * Used as a fallback source when the OpenCode database is unavailable.
 */
export function cacheToUsageRows(
  cache: Map<string, SessionCacheEntry>,
  projectPath: string,
): Map<string, import('./usage.js').UsageRow> {
  const normalized = path.normalize(projectPath);
  const rows = new Map<string, import('./usage.js').UsageRow>();
  for (const entry of cache.values()) {
    if (!entry.projectPath || path.normalize(entry.projectPath) !== normalized) continue;
    rows.set(entry.sessionId, {
      sessionId: entry.sessionId,
      cost: entry.cost,
      tokens: { ...entry.tokens },
      requestCount: entry.requestCount ?? 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// syncFromDB - Rebuild cache from OpenCode SQLite database
// ---------------------------------------------------------------------------

/**
 * Sync result returned by syncFromDB.
 */
export interface SyncResult {
  /** Number of new sessions added to cache */
  newSessions: number;
  /** Total sessions in cache after sync */
  totalSessions: number;
  /** Total token breakdown across all cached sessions (matching projectPath) */
  totalTokens: TokenBreakdown;
  /** False when the database could not be read (no SQLite support / missing file) */
  databaseAvailable: boolean;
}

/**
 * Synchronize cache from OpenCode database.
 * Queries DB for sessions matching projectPath that are NOT already in the cache,
 * computes aggregate token data for each, and writes them to the cache file.
 * Returns sync statistics.
 */
export async function syncFromDB(
  dataDir: string,
  projectPath: string,
  existingCache: Map<string, SessionCacheEntry>,
): Promise<SyncResult> {
  const ZERO_RESULT: SyncResult = {
    newSessions: 0,
    totalSessions: existingCache.size,
    totalTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    databaseAvailable: false,
  };

  try {
    // Lazy import to avoid loading the SQLite binding at plugin startup
    const { readSessionsFromDb, databaseAvailable } = await import('./db-preload.js');

    const dbAvailable = await databaseAvailable(dataDir);

    // OpenCode v2 keeps per-session aggregates in `session_v2`;
    // readSessionsFromDb falls back to the legacy schema when needed.
    const sessions = dbAvailable
      ? await readSessionsFromDb(dataDir, { projectPath, limit: 1000 })
      : [];

    let newSessions = 0;
    for (const usage of sessions) {
      if (existingCache.has(usage.sessionId)) continue;
      if (usage.tokens.total === 0 && usage.cost === 0) continue;

      const entry: SessionCacheEntry = {
        sessionId: usage.sessionId,
        projectPath: usage.projectPath ? path.normalize(usage.projectPath) : path.normalize(projectPath),
        tokens: { ...usage.tokens },
        cost: usage.cost,
        modelID: '',
        providerID: '',
        mode: '',
        requestCount: usage.requestCount,
        updatedAt: new Date().toISOString(),
      };
      writeCacheEntry(dataDir, entry);
      newSessions++;
    }

    // Reload cache to get accurate totals (keep entries that are only in memory)
    const reloaded = loadSessionCache(dataDir);
    const merged = new Map(existingCache);
    for (const [id, entry] of reloaded) merged.set(id, entry);
    const agg = aggregateProjectFromCache(merged, projectPath);

    return {
      newSessions,
      totalSessions: merged.size,
      totalTokens: agg.tokens,
      databaseAvailable: dbAvailable,
    };
  } catch (err) {
    logger.error(`syncFromDB failed: ${err}`);
    return ZERO_RESULT;
  }
}
