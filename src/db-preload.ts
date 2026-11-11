/**
 * SQLite preloader - restores session usage data from the OpenCode database.
 *
 * OpenCode v2 stores per-session aggregates in the `session_v2` table:
 *   cost, tokens_input/output/reasoning, tokens_cache_read/write
 * and assistant request counts in the `session_message` table.
 *
 * Older OpenCode versions are supported as a fallback (`session` + `message`).
 */
import * as path from 'node:path';
import { logger, DEBUG_ENABLED } from './logger.js';
import type { SessionTokenData, TokenBreakdown } from './types.js';

/** Session usage snapshot read from the database. */
export interface DbSessionUsage {
  sessionId: string;
  projectPath?: string;
  title?: string;
  parentID?: string;
  createdAt?: number;
  cost: number;
  tokens: TokenBreakdown;
  requestCount: number;
}

const ZERO_TOKENS: TokenBreakdown = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

interface DbRow {
  id: string;
  directory?: string | null;
  title?: string | null;
  parent_id?: string | null;
  time_created?: number | null;
  cost?: number | null;
  tokens_input?: number | null;
  tokens_output?: number | null;
  tokens_reasoning?: number | null;
  tokens_cache_read?: number | null;
  tokens_cache_write?: number | null;
  request_count?: number | null;
}

function toUsage(row: DbRow): DbSessionUsage {
  const input = Number(row.tokens_input) || 0;
  const output = Number(row.tokens_output) || 0;
  const reasoning = Number(row.tokens_reasoning) || 0;
  const cacheRead = Number(row.tokens_cache_read) || 0;
  const cacheWrite = Number(row.tokens_cache_write) || 0;
  return {
    sessionId: row.id,
    projectPath: row.directory ?? undefined,
    title: row.title ?? undefined,
    parentID: row.parent_id ?? undefined,
    createdAt: row.time_created ?? undefined,
    cost: Number(row.cost) || 0,
    tokens: {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + cacheRead + cacheWrite,
    },
    requestCount: Number(row.request_count) || 0,
  };
}

/**
 * Read session usage snapshots from the OpenCode SQLite database.
 * Uses the v2 `session_v2` table when available, otherwise falls back to the
 * legacy `session` + `message` tables.
 *
 * Never throws - returns an empty array on any error.
 */
export async function readSessionsFromDb(
  dataDir: string,
  options: { projectPath?: string; limit?: number } = {},
): Promise<DbSessionUsage[]> {
  try {
    const { Database } = await import('bun:sqlite');
    const dbPath = path.join(dataDir, 'opencode.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      const limit = options.limit ?? 200;
      const normalizedProjectPath = options.projectPath ? path.normalize(options.projectPath) : undefined;

      const rows = querySessions(db, normalizedProjectPath, limit);
      return rows.map(toUsage);
    } finally {
      db.close();
    }
  } catch (e) {
    if (DEBUG_ENABLED) {
      logger.debug(`[db-preload] Failed to read session usage: ${e}`);
    }
    return [];
  }
}

/**
 * Directory variants used for database lookups.
 * OpenCode stores directories with forward slashes while the plugin receives
 * native paths, so every spelling has to be matched.
 */
function directoryVariants(directory: string): string[] {
  const normalized = path.normalize(directory);
  const variants = new Set<string>([directory, normalized]);
  variants.add(normalized.replace(/\\/g, '/'));
  variants.add(normalized.replace(/\//g, '\\'));
  return [...variants];
}

/**
 * Run the appropriate SELECT for the detected schema.
 */
function querySessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  normalizedProjectPath: string | undefined,
  limit: number,
): DbRow[] {
  const hasV2 = tableExists(db, 'session_v2');

  if (hasV2) {
    // v2: session aggregates + assistant message count
    const variants = normalizedProjectPath ? directoryVariants(normalizedProjectPath) : [];
    const where = variants.length > 0
      ? `WHERE s.directory IN (${variants.map((_, i) => `?${i + 1}`).join(', ')}) `
      : '';

    const sql =
      `SELECT s.id AS id, s.directory AS directory, s.title AS title, s.parent_id AS parent_id, ` +
      `s.time_created AS time_created, s.cost AS cost, ` +
      `s.tokens_input AS tokens_input, s.tokens_output AS tokens_output, ` +
      `s.tokens_reasoning AS tokens_reasoning, s.tokens_cache_read AS tokens_cache_read, ` +
      `s.tokens_cache_write AS tokens_cache_write, ` +
      `(SELECT COUNT(*) FROM session_message m WHERE m.session_id = s.id AND m.type = 'assistant') AS request_count ` +
      `FROM session_v2 s ` +
      where +
      `ORDER BY s.time_created DESC LIMIT ${Math.max(1, Math.floor(limit))}`;

    const stmt = db.prepare(sql);
    return (variants.length > 0 ? stmt.all(...variants) : stmt.all()) as DbRow[];
  }

  // Legacy (OpenCode 1.x): derive totals from assistant messages
  const variants = normalizedProjectPath ? directoryVariants(normalizedProjectPath) : [];
  const where = variants.length > 0
    ? `WHERE s.directory IN (${variants.map((_, i) => `?${i + 1}`).join(', ')}) `
    : '';

  const sql =
    `SELECT s.id AS id, s.directory AS directory, s.title AS title, s.parent_id AS parent_id, ` +
    `s.time_created AS time_created, ` +
    `COALESCE(SUM(json_extract(m.data, '$.cost')), 0) AS cost, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.input')), 0) AS tokens_input, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.output')), 0) AS tokens_output, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.reasoning')), 0) AS tokens_reasoning, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.cache.read')), 0) AS tokens_cache_read, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.cache.write')), 0) AS tokens_cache_write, ` +
    `COUNT(m.id) AS request_count ` +
    `FROM session s LEFT JOIN message m ON m.session_id = s.id ` +
    `AND json_extract(m.data, '$.role') = 'assistant' ` +
    where +
    `GROUP BY s.id ` +
    `ORDER BY s.time_created DESC LIMIT ${Math.max(1, Math.floor(limit))}`;

  const stmt = db.prepare(sql);
  return (variants.length > 0 ? stmt.all(...variants) : stmt.all()) as DbRow[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableExists(db: any, name: string): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Preload session usage data into tokenDataMap.
 * Each session is stored as a single synthetic message holding the cumulative
 * totals, so the existing aggregation logic keeps working unchanged.
 */
export async function preloadTokenData(
  tokenDataMap: Map<string, SessionTokenData>,
  dataDir: string,
  limit = 50,
  projectPath?: string,
): Promise<void> {
  const sessions = await readSessionsFromDb(dataDir, { projectPath, limit });
  if (sessions.length === 0) return;

  for (const usage of sessions) {
    const total = usage.tokens.total;
    const messageId = `${usage.sessionId}:aggregate`;
    tokenDataMap.set(usage.sessionId, {
      messages: new Map([
        [
          messageId,
          {
            cost: usage.cost,
            tokens: { ...usage.tokens },
            modelID: '',
            providerID: '',
            mode: '',
          },
        ],
      ]),
      lastModelID: '',
      lastProviderID: '',
      lastMode: '',
      projectPath: usage.projectPath ? path.normalize(usage.projectPath) : undefined,
      requestCount: usage.requestCount,
      cumulative: total > 0 || usage.cost > 0 ? { cost: usage.cost, tokens: { ...usage.tokens } } : undefined,
    });
  }

  if (DEBUG_ENABLED) {
    logger.debug(`[db-preload] Preloaded ${sessions.length} sessions from ${dataDir}`);
  }
}

export { ZERO_TOKENS };
