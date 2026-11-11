/**
 * OpenCode v1 plugin implementation.
 *
 * The v1 loader (`readV1Plugin`) looks for `{ id, server }` on the default
 * export and calls `server(input)` to obtain the hook object. This module
 * provides that entry point for OpenCode 1.x installations.
 *
 * It reuses the shared channel stack (handler / formatters / locales) and the
 * shared event mapper (through the v1 -> v2 event adapter). Token accounting
 * uses the v1 native source: `message.updated` events.
 */
import type { Plugin as V1Plugin } from '@opencode-ai/plugin';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from '../config.js';
import { createEventHandler, type EventHandler } from '../handler.js';
import { getDefaultTimezone } from '../locales.js';
import type { EventPayload, SessionMeta, SessionTokenData, TokenData, SessionCacheEntry } from '../types.js';
import { DEFAULT_SESSION_TYPES } from '../types.js';
import { logger, DEBUG_ENABLED } from '../logger.js';
import { loadSessionCache, writeCacheEntry } from '../session-cache.js';
import { parseTokenFields, parseMessageCost } from '../utils/token-parse.js';
import { eventToPayload } from '../event-mapper.js';
import { adaptV1Event } from './v1-event-adapter.js';
import {
  fillTokenData,
  aggregateSubSessions,
  fillProjectData,
  seedProjectAgg,
  resetProjectAgg,
} from './token-aggregator-v1.js';
import { preloadTokenData } from './db-preload-v1.js';

/**
 * Build a session cache entry from the v1 per-message token data.
 */
function buildV1CacheEntry(
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
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) {
      input += t.input;
      output += t.output;
      reasoning += t.reasoning;
      cacheRead += t.cacheRead;
      cacheWrite += t.cacheWrite;
      cost += td.cost;
    }
  }

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
    requestCount: sessionData.messages.size,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * OpenCode 1.x plugin factory.
 */
export const createV1Plugin: V1Plugin = async (ctx) => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    logger.error(`Failed to initialize plugin config: ${error}`);
    return {};
  }

  if (config.channels.length === 0) {
    logger.warn('Plugin loaded but no enabled channels found');
    return {};
  }

  const { resolveCostConfig, formatCost } = await import('../cost.js');
  const eventHandler: EventHandler = createEventHandler(config);

  const directory: string = ctx.directory;
  const baseDir = process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode');
  const projectName = config.projectName || path.basename(directory) || 'unknown-project';
  const timezone = config.timezone ?? getDefaultTimezone(config.language);
  const allowedSessionTypes = config.includeSessionTypes ?? DEFAULT_SESSION_TYPES;

  const sessionMap = new Map<string, SessionMeta>();
  const tokenDataMap = new Map<string, SessionTokenData>();
  const sessionCache = loadSessionCache(baseDir);

  logger.info(`[ul-opencode-event] Plugin (v1) loaded for ${directory} with ${config.channels.length} channel(s)`);

  // Restore usage data from the OpenCode database (v1 schema)
  void (async () => {
    try {
      await preloadTokenData(tokenDataMap, baseDir, 50, directory);
      for (const [, data] of tokenDataMap) {
        if (!data.projectPath) continue;
        if (path.normalize(data.projectPath) !== path.normalize(directory)) continue;
        let cost = 0;
        for (const td of data.messages.values()) cost += td.cost;
        seedProjectAgg({
          cost,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
          requestCount: data.messages.size,
        });
      }
    } catch (err) {
      logger.debug(`[ul-opencode-event] v1 preload failed: ${err}`);
    }
  })();

  const trackSession = (sessionID: string, patch: Partial<SessionMeta>): void => {
    if (!sessionID) return;
    const current = sessionMap.get(sessionID) ?? { id: sessionID };
    sessionMap.set(sessionID, { ...current, ...patch });
  };

  return {
    event: async ({ event }) => {
      const raw = event as unknown as { type: string; properties?: Record<string, unknown> };
      const props = (raw.properties ?? {}) as Record<string, unknown>;

      logger.info(`[EVENT] type=${raw.type}`);

      // --- token accumulation (v1 native source) ---
      if (raw.type === 'message.updated') {
        const info = (props.info ?? {}) as Record<string, unknown>;
        if (info.role === 'assistant') {
          const sessionId = info.sessionID as string | undefined;
          const messageId = info.id as string | undefined;
          if (sessionId && messageId) {
            let sessionData = tokenDataMap.get(sessionId);
            if (!sessionData) {
              sessionData = {
                messages: new Map(),
                lastModelID: '',
                lastProviderID: '',
                lastMode: '',
                projectPath: sessionMap.get(sessionId)?.directory ?? directory,
              };
              tokenDataMap.set(sessionId, sessionData);
            }

            const tokens = parseTokenFields(info.tokens as never);
            const cost = parseMessageCost(info as { cost?: number | null });
            const tokenData: TokenData = {
              cost,
              tokens,
              modelID: (info.modelID as string) ?? '',
              providerID: (info.providerID as string) ?? '',
              mode: (info.mode as string) ?? '',
            };
            sessionData.messages.set(messageId, tokenData);
            sessionData.lastModelID = tokenData.modelID;
            sessionData.lastProviderID = tokenData.providerID;
            sessionData.lastMode = tokenData.mode;
            if (!sessionData.projectPath) {
              sessionData.projectPath = sessionMap.get(sessionId)?.directory ?? directory;
            }
          }
        }
        return;
      }

      // --- session metadata ---
      if (raw.type === 'session.created' || raw.type === 'session.updated') {
        const info = (props.info ?? {}) as {
          id?: string;
          title?: string;
          parentID?: string;
          directory?: string;
          version?: string;
          time?: { created?: number };
        };
        if (info.id) {
          trackSession(info.id, {
            title: info.title,
            parentID: info.parentID,
            directory: info.directory ?? directory,
            version: info.version,
            createdAt: info.time?.created,
          });
        }
      }

      // --- notification ---
      const adapted = adaptV1Event(raw);
      if (!adapted) return;

      // The session id lives in `info.id` for session.created/updated events,
      // so resolve the session through the adapted event instead of the raw one.
      const adaptedSessionId = typeof adapted.data.sessionID === 'string' ? adapted.data.sessionID : '';
      const sessionInfo = sessionMap.get(adaptedSessionId);
      const payload: EventPayload | null = eventToPayload(
        adapted,
        projectName,
        sessionInfo,
        timezone,
        directory,
      );
      if (!payload) return;

      fillTokenData(payload, tokenDataMap, config.language, config.cost, resolveCostConfig, formatCost);
      aggregateSubSessions(payload, tokenDataMap, sessionMap, config.language, config.cost, resolveCostConfig, formatCost);
      fillProjectData(payload, tokenDataMap, directory, config.language, config.cost, resolveCostConfig, formatCost);

      if (!allowedSessionTypes.includes(payload.sessionType)) {
        if (DEBUG_ENABLED) {
          logger.debug(`Skipping ${payload.sessionType} event ${payload.eventType} for session ${payload.sessionId}`);
        }
        return;
      }

      try {
        await eventHandler.handle(payload.eventType, payload);
      } catch (error) {
        logger.error(`Failed to handle event ${payload.eventType}: ${error}`);
      }

      if (payload.eventType === 'idle' || payload.eventType === 'error') {
        const sessionData = tokenDataMap.get(payload.sessionId);
        if (sessionData) {
          const entry = buildV1CacheEntry(payload.sessionId, sessionData);
          if (entry) writeCacheEntry(baseDir, entry);
        }
      }
    },
  };
};

resetProjectAgg();
