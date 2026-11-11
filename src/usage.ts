/**
 * Usage Aggregation Module (OpenCode v2)
 *
 * Source of truth for token/cost numbers:
 * - Primary: the OpenCode database (`session_v2` table holds per-session
 *   cumulative cost/tokens; `session_message` holds assistant request counts).
 * - Fallback: live server events (`session.usage.updated` / `session.step.ended`)
 *   when the database is unavailable or lags behind.
 *
 * Three aggregation levels are produced:
 * - session : the session itself
 * - total   : the session + all of its descendants (sub-agent sessions)
 * - project : every session belonging to the project directory
 */
import * as path from 'node:path';
import { logger, DEBUG_ENABLED } from './logger.js';
import type { TokenBreakdown } from './types.js';

/** Aggregated usage for a set of sessions. */
export interface UsageTotals {
  /** Cumulative cost in USD */
  cost: number;
  /** Cumulative token breakdown */
  tokens: TokenBreakdown;
  /** Number of API requests (assistant messages) */
  requestCount: number;
}

/** Per-session usage row read from the database. */
export interface UsageRow extends UsageTotals {
  sessionId: string;
  parentID?: string;
  directory?: string;
}

/** Live usage tracked from server events. */
export interface LiveUsage {
  /** Authoritative cumulative values reported by `session.usage.updated` */
  absolute?: { cost: number; tokens: TokenBreakdown };
  /** Sum of per-step values reported by `session.step.ended` */
  stepCost: number;
  stepTokens: TokenBreakdown;
  /** Number of steps observed */
  stepCount: number;
}

export const ZERO_TOKENS: TokenBreakdown = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

export function zeroTotals(): UsageTotals {
  return { cost: 0, tokens: { ...ZERO_TOKENS }, requestCount: 0 };
}

export function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    cost: a.cost + b.cost,
    tokens: {
      input: a.tokens.input + b.tokens.input,
      output: a.tokens.output + b.tokens.output,
      reasoning: a.tokens.reasoning + b.tokens.reasoning,
      cacheRead: a.tokens.cacheRead + b.tokens.cacheRead,
      cacheWrite: a.tokens.cacheWrite + b.tokens.cacheWrite,
      total: a.tokens.total + b.tokens.total,
    },
    requestCount: a.requestCount + b.requestCount,
  };
}

/**
 * Read per-session usage for every session of a project directory.
 * Never throws - returns an empty map on any error.
 */
export async function readProjectUsage(dataDir: string, directory: string): Promise<Map<string, UsageRow>> {
  const rows = new Map<string, UsageRow>();
  try {
    const { Database } = await import('bun:sqlite');
    const dbPath = path.join(dataDir, 'opencode.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      const normalized = path.normalize(directory);
      for (const row of querySessionUsage(db, normalized)) {
        const usage = toUsageRow(row);
        rows.set(usage.sessionId, usage);
      }
    } finally {
      db.close();
    }
  } catch (err) {
    if (DEBUG_ENABLED) {
      logger.debug(`[usage] Failed to read usage from database: ${err}`);
    }
  }
  return rows;
}

interface DbRow {
  id: string;
  directory?: string | null;
  parent_id?: string | null;
  cost?: number | null;
  tokens_input?: number | null;
  tokens_output?: number | null;
  tokens_reasoning?: number | null;
  tokens_cache_read?: number | null;
  tokens_cache_write?: number | null;
  request_count?: number | null;
}

/**
 * Directory variants used for database lookups.
 *
 * OpenCode stores session directories with forward slashes
 * (`D:/workspace/project`) while the plugin receives native paths
 * (`D:\workspace\project`), so every spelling has to be matched.
 */
function directoryVariants(directory: string): string[] {
  const normalized = path.normalize(directory);
  const variants = new Set<string>([directory, normalized]);
  variants.add(normalized.replace(/\\/g, '/'));
  variants.add(normalized.replace(/\//g, '\\'));
  return [...variants];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function querySessionUsage(db: any, normalizedDirectory: string): DbRow[] {
  const hasV2 = tableExists(db, 'session_v2');
  const variants = directoryVariants(normalizedDirectory);
  const placeholders = variants.map((_, i) => `?${i + 1}`).join(', ');

  if (hasV2) {
    const sql =
      `SELECT s.id AS id, s.directory AS directory, s.parent_id AS parent_id, ` +
      `s.cost AS cost, ` +
      `s.tokens_input AS tokens_input, s.tokens_output AS tokens_output, ` +
      `s.tokens_reasoning AS tokens_reasoning, s.tokens_cache_read AS tokens_cache_read, ` +
      `s.tokens_cache_write AS tokens_cache_write, ` +
      `(SELECT COUNT(*) FROM session_message m WHERE m.session_id = s.id AND m.type = 'assistant') AS request_count ` +
      `FROM session_v2 s WHERE s.directory IN (${placeholders})`;
    return db.prepare(sql).all(...variants) as DbRow[];
  }

  // Legacy OpenCode 1.x schema
  const sql =
    `SELECT s.id AS id, s.directory AS directory, s.parent_id AS parent_id, ` +
    `COALESCE(SUM(json_extract(m.data, '$.cost')), 0) AS cost, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.input')), 0) AS tokens_input, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.output')), 0) AS tokens_output, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.reasoning')), 0) AS tokens_reasoning, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.cache.read')), 0) AS tokens_cache_read, ` +
    `COALESCE(SUM(json_extract(m.data, '$.tokens.cache.write')), 0) AS tokens_cache_write, ` +
    `COUNT(m.id) AS request_count ` +
    `FROM session s LEFT JOIN message m ON m.session_id = s.id ` +
    `AND json_extract(m.data, '$.role') = 'assistant' ` +
    `WHERE s.directory IN (${placeholders}) GROUP BY s.id`;
  return db.prepare(sql).all(...variants) as DbRow[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableExists(db: any, name: string): boolean {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
  } catch {
    return false;
  }
}

/**
 * Convert a raw database row into a usage row.
 */
function toUsageRow(row: DbRow): UsageRow {
  const input = Number(row.tokens_input) || 0;
  const output = Number(row.tokens_output) || 0;
  const reasoning = Number(row.tokens_reasoning) || 0;
  const cacheRead = Number(row.tokens_cache_read) || 0;
  const cacheWrite = Number(row.tokens_cache_write) || 0;
  return {
    sessionId: row.id,
    parentID: row.parent_id ?? undefined,
    directory: row.directory ?? undefined,
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
 * Read the directory a session belongs to.
 * Used to resolve the project of an event that carries no location.
 */
export async function readSessionDirectory(dataDir: string, sessionID: string): Promise<string | undefined> {
  if (!sessionID) return undefined;
  try {
    const { Database } = await import('bun:sqlite');
    const dbPath = path.join(dataDir, 'opencode.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      const table = tableExists(db, 'session_v2') ? 'session_v2' : 'session';
      const row = db.prepare(`SELECT directory FROM ${table} WHERE id = ?`).get(sessionID) as
        | { directory?: string | null }
        | undefined;
      return row?.directory ?? undefined;
    } finally {
      db.close();
    }
  } catch (err) {
    if (DEBUG_ENABLED) {
      logger.debug(`[usage] Failed to read session directory: ${err}`);
    }
    return undefined;
  }
}

/**
 * Merge live event usage over database rows.
 * Live values win because the database can lag behind the running session.
 */
export function mergeLiveUsage(rows: Map<string, UsageRow>, live: Map<string, LiveUsage>): Map<string, UsageRow> {
  for (const [sessionId, usage] of live) {
    const row = rows.get(sessionId);
    const tokens = usage.absolute?.tokens ?? usage.stepTokens;
    const cost = usage.absolute?.cost ?? usage.stepCost;
    const requestCount = usage.stepCount > 0 ? usage.stepCount : (row?.requestCount ?? 0);

    if (row) {
      rows.set(sessionId, {
        ...row,
        cost,
        tokens: { ...tokens },
        requestCount,
      });
    } else {
      rows.set(sessionId, {
        sessionId,
        cost,
        tokens: { ...tokens },
        requestCount,
      });
    }
  }
  return rows;
}

/**
 * Compute the session / total / project usage snapshot.
 *
 * - session : usage of the given session
 * - total   : session + all descendants (recursively)
 * - project : every session of the project
 */
export function aggregateUsage(
  rows: Map<string, UsageRow>,
  sessionId: string,
): { session: UsageTotals; total: UsageTotals; project: UsageTotals } {
  const session = rows.get(sessionId);
  const sessionTotals = session
    ? { cost: session.cost, tokens: { ...session.tokens }, requestCount: session.requestCount }
    : zeroTotals();

  const descendants = collectDescendants(rows, sessionId);
  let total = sessionTotals;
  for (const id of descendants) {
    const row = rows.get(id);
    if (!row) continue;
    total = addTotals(total, { cost: row.cost, tokens: row.tokens, requestCount: row.requestCount });
  }

  let project = zeroTotals();
  for (const row of rows.values()) {
    project = addTotals(project, { cost: row.cost, tokens: row.tokens, requestCount: row.requestCount });
  }

  return { session: sessionTotals, total, project };
}

/**
 * Collect all descendant session IDs (children, grandchildren, ...).
 */
export function collectDescendants(rows: Map<string, UsageRow>, parentId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows.values()) {
    if (!row.parentID) continue;
    const list = childrenOf.get(row.parentID) ?? [];
    list.push(row.sessionId);
    childrenOf.set(row.parentID, list);
  }

  const result: string[] = [];
  const queue = [...(childrenOf.get(parentId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

/**
 * Create an empty live usage record.
 */
export function createLiveUsage(): LiveUsage {
  return {
    stepCost: 0,
    stepTokens: { ...ZERO_TOKENS },
    stepCount: 0,
  };
}
