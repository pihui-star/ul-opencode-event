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
import type { TokenBreakdown, SessionTokenData, SessionCacheEntry } from './types.js';

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
): { cost: number; tokens: TokenBreakdown } {
  const normalized = path.normalize(projectPath);
  let cost = 0;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  for (const entry of cache.values()) {
    if (path.normalize(entry.projectPath) === normalized) {
      cost += entry.cost;
      input += entry.tokens.input;
      output += entry.tokens.output;
      reasoning += entry.tokens.reasoning;
      cacheRead += entry.tokens.cacheRead;
      cacheWrite += entry.tokens.cacheWrite;
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
  };
}

/**
 * Build a cache entry from session token data.
 * Uses the same aggregation logic as sumAllCompletedTokens() from index.ts:
 * - Only accumulates messages where input + output + cacheRead + cacheWrite > 0
 * - total = input + output + cacheRead + cacheWrite (excludes reasoning)
 * Returns null if all token fields are zero.
 */
export function buildCacheEntry(
  sessionId: string,
  sessionData: SessionTokenData,
): SessionCacheEntry | null {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;

  for (const td of sessionData.messages.values()) {
    const t = td.tokens;
    // Only accumulate messages with non-zero usage (skip streaming intermediates)
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) {
      input += t.input;
      output += t.output;
      reasoning += t.reasoning;
      cacheRead += t.cacheRead;
      cacheWrite += t.cacheWrite;
      cost += td.cost;
    }
  }

  // If all token fields are zero, return null
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return null;
  }

  return {
    sessionId,
    projectPath: sessionData.projectPath ?? '',
    tokens: {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + cacheRead + cacheWrite,
    },
    cost,
    modelID: sessionData.lastModelID,
    providerID: sessionData.lastProviderID,
    mode: sessionData.lastMode,
    updatedAt: new Date().toISOString(),
  };
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
  };

  try {
    // Lazy import to avoid loading bun:sqlite at plugin startup
    const { Database } = await import('bun:sqlite');

    const dbPath = path.join(dataDir, 'opencode.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      const normalizedProjectPath = path.normalize(projectPath);

      // Build exclusion clause for sessions already in cache
      const existingIds = [...existingCache.keys()];
      let rows: Array<Record<string, unknown>>;

      if (existingIds.length === 0) {
        // No existing cache entries - query all sessions for this project
        const sql =
          `SELECT m.id, m.session_id, m.data, s.directory ` +
          `FROM message m ` +
          `JOIN session s ON m.session_id = s.id ` +
          `WHERE json_extract(m.data, '$.role') = 'assistant' ` +
          `AND s.directory = ? ` +
          `ORDER BY m.session_id, m.time_created ASC`;

        rows = db.prepare(sql).all(normalizedProjectPath) as Array<Record<string, unknown>>;
      } else {
        // Exclude sessions already in cache - use parameterized approach
        // bun:sqlite supports numbered params, build dynamic placeholders
        const placeholders = existingIds.map((_, i) => `?${i + 2}`).join(', ');
        const sql =
          `SELECT m.id, m.session_id, m.data, s.directory ` +
          `FROM message m ` +
          `JOIN session s ON m.session_id = s.id ` +
          `WHERE json_extract(m.data, '$.role') = 'assistant' ` +
          `AND s.directory = ?1 ` +
          `AND m.session_id NOT IN (${placeholders}) ` +
          `ORDER BY m.session_id, m.time_created ASC`;

        const stmt = db.prepare(sql);
        rows = stmt.all(normalizedProjectPath, ...existingIds) as Array<Record<string, unknown>>;
      }

      // Group messages by session and compute aggregates
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionGroups = new Map<string, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: Array<{ id: string; data: any }>;
        directory: string;
      }>();

      for (const row of rows) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = JSON.parse(row.data as string) as any;
          if (data.role !== 'assistant') continue;

          const sessionId = row.session_id as string;
          const messageId = row.id as string;
          const directory = (row.directory as string) ?? '';

          let group = sessionGroups.get(sessionId);
          if (!group) {
            group = { messages: [], directory };
            sessionGroups.set(sessionId, group);
          }
          group.messages.push({ id: messageId, data });
        } catch {
          // Skip rows with invalid JSON
        }
      }

      // Build cache entries for each new session and write them
      let newSessions = 0;
      for (const [sessionId, group] of sessionGroups) {
        const sessionData: SessionTokenData = {
          messages: new Map(),
          lastModelID: '',
          lastProviderID: '',
          lastMode: '',
          projectPath: path.normalize(group.directory),
        };

        for (const msg of group.messages) {
          const data = msg.data;
          const tkInput = Number(data.tokens?.input) || 0;
          const tkOutput = Number(data.tokens?.output) || 0;
          const tkReasoning = Number(data.tokens?.reasoning) || 0;
          const tkCacheRead = Number(data.tokens?.cache?.read) || 0;
          const tkCacheWrite = Number(data.tokens?.cache?.write) || 0;

          const tokenData = {
            cost: Number(data.cost) || 0,
            tokens: {
              input: tkInput,
              output: tkOutput,
              reasoning: tkReasoning,
              cacheRead: tkCacheRead,
              cacheWrite: tkCacheWrite,
              total: tkInput + tkOutput + tkCacheRead + tkCacheWrite,
            },
            modelID: (data.modelID as string) ?? '',
            providerID: (data.providerID as string) ?? '',
            mode: (data.mode as string) ?? '',
          };

          sessionData.messages.set(msg.id, tokenData);
          sessionData.lastModelID = tokenData.modelID;
          sessionData.lastProviderID = tokenData.providerID;
          sessionData.lastMode = tokenData.mode;
        }

        const entry = buildCacheEntry(sessionId, sessionData);
        if (entry) {
          writeCacheEntry(dataDir, entry);
          newSessions++;
        }
      }

      // Reload cache to get accurate totals
      const updatedCache = loadSessionCache(dataDir);
      const agg = aggregateProjectFromCache(updatedCache, projectPath);

      return {
        newSessions,
        totalSessions: updatedCache.size,
        totalTokens: agg.tokens,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    logger.error(`syncFromDB failed: ${err}`);
    return ZERO_RESULT;
  }
}
