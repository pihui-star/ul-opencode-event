/**
 * SQLite preloader - restores token data from OpenCode database on plugin restart.
 * Reads recent assistant messages from opencode.db to repopulate tokenDataMap.
 */
import * as path from 'node:path';
import { logger, DEBUG_ENABLED } from '../logger.js';
import type { SessionTokenData, TokenData } from '../types.js';

export async function preloadTokenData(
  tokenDataMap: Map<string, SessionTokenData>,
  dataDir: string,
  limit = 10,
  projectPath?: string,
): Promise<void> {
  try {
    const { Database } = await import('bun:sqlite');
    const dbPath = path.join(dataDir, 'opencode.db');
    const db = new Database(dbPath, { readonly: true });
    try {
      // Original SQL (fallback for when project-filtered query fails)
      const originalSQL =
        `SELECT m.id, m.session_id, m.data ` +
        `FROM message m ` +
        `WHERE json_extract(m.data, '$.role') = 'assistant' ` +
        `AND m.session_id IN (` +
        `SELECT id FROM session ORDER BY time_updated DESC LIMIT ${limit}` +
        `) ` +
        `ORDER BY m.session_id, m.time_created ASC`;

      // Project-filtered SQL: filters sessions by directory and returns directory column
      const projectSQL =
        `SELECT m.id, m.session_id, m.data, s.directory ` +
        `FROM message m ` +
        `JOIN session s ON m.session_id = s.id ` +
        `WHERE json_extract(m.data, '$.role') = 'assistant' ` +
        `AND m.session_id IN (` +
        `SELECT id FROM session WHERE directory = ? ORDER BY time_updated DESC LIMIT ${limit}` +
        `) ` +
        `ORDER BY m.session_id, m.time_created ASC`;

      const normalizedProjectPath = projectPath ? path.normalize(projectPath) : undefined;

      let rows: Array<Record<string, unknown>>;

      if (normalizedProjectPath) {
        // Try project-filtered query first; fall back to original on schema mismatch
        try {
          const stmt = db.prepare(projectSQL);
          rows = stmt.all(normalizedProjectPath) as Array<Record<string, unknown>>;
        } catch {
          if (DEBUG_ENABLED) {
            logger.debug(`[db-preload] Project-filtered query failed, falling back to original SQL`);
          }
          rows = db.prepare(originalSQL).all() as Array<Record<string, unknown>>;
        }
      } else {
        rows = db.prepare(originalSQL).all() as Array<Record<string, unknown>>;
      }

      for (const row of rows) {
        try {
          const data = JSON.parse(row.data as string);
          if (data.role !== 'assistant') continue;

          const sessionId = row.session_id as string;
          const messageId = row.id as string;

          const tkInput = Number(data.tokens?.input) || 0;
          const tkOutput = Number(data.tokens?.output) || 0;
          const tkReasoning = Number(data.tokens?.reasoning) || 0;
          const tkCacheRead = Number(data.tokens?.cache?.read) || 0;
          const tkCacheWrite = Number(data.tokens?.cache?.write) || 0;

          const tokenData: TokenData = {
            cost: Number(data.cost) || 0,
            tokens: {
              input: tkInput,
              output: tkOutput,
              reasoning: tkReasoning,
              cacheRead: tkCacheRead,
              cacheWrite: tkCacheWrite,
              total: tkInput + tkOutput + tkCacheRead + tkCacheWrite,
            },
            modelID: data.modelID ?? '',
            providerID: data.providerID ?? '',
            mode: data.mode ?? '',
          };

          let sessionData = tokenDataMap.get(sessionId);
          if (!sessionData) {
            sessionData = {
              messages: new Map(),
              lastModelID: '',
              lastProviderID: '',
              lastMode: '',
            };
            tokenDataMap.set(sessionId, sessionData);
          }
          sessionData.messages.set(messageId, tokenData);
          sessionData.lastModelID = tokenData.modelID;
          sessionData.lastProviderID = tokenData.providerID;
          sessionData.lastMode = tokenData.mode;

          // Set projectPath from directory column (available with project-filtered SQL)
          const directory = row.directory as string | undefined;
          if (directory) {
            sessionData.projectPath = path.normalize(directory);
          }
        } catch {
          // Skip rows with invalid JSON
        }
      }

      if (DEBUG_ENABLED) {
        logger.debug(
          `[db-preload] Preloaded ${tokenDataMap.size} sessions from ${dbPath}`,
        );
      }
    } finally {
      db.close();
    }
  } catch (e) {
    if (DEBUG_ENABLED) {
      logger.debug(`[db-preload] Failed to preload token data: ${e}`);
    }
  }
}
