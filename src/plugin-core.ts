/**
 * Plugin Core Module
 * Contains the NotificationPlugin function, plugin lifecycle,
 * and module-level state (flags, test helpers).
 *
 * Dependencies: token-aggregator, event-mapper
 * Lazy imports: cost.js (via dynamic import in function body)
 * Deferred imports: db-preload.js (via setTimeout + dynamic import)
 */
import { type Plugin, tool } from '@opencode-ai/plugin';
import type { Session } from '@opencode-ai/sdk';
import * as path from 'path';
import * as os from 'node:os';
import { loadConfig } from './config.js';
import { createEventHandler, type EventHandler } from './handler.js';
import { getDefaultTimezone } from './locales.js';
import type { EventPayload, SessionTokenData, TokenData, SessionCacheEntry } from './types.js';
import { DEFAULT_SESSION_TYPES } from './types.js';
import { logger, DEBUG_ENABLED } from './logger.js';
import { runAutoUpdate, getCurrentVersion } from './updater.js';
import { loadSessionCache, buildCacheEntry, writeCacheEntry } from './session-cache.js';
import { parseTokenFields, parseMessageCost } from './utils/token-parse.js';
import {
  projectAgg,
  resetProjectAgg,
  sumAllCompletedTokens,
  aggregateSubSessions,
  fillProjectData,
} from './token-aggregator.js';
import { eventToPayload } from './event-mapper.js';

/**
 * Guard flag to ensure auto-update only runs once per plugin load
 */
let hasCheckedUpdate = false;
let hasShownStartupToast = false;
let lastCacheWriteTime = 0;
let isTestEnvironment = false;

/**
 * Test-only: captured payloads for verification in tests.
 * Exposed via globalThis (not module export) to avoid OpenCode's getLegacyPlugins
 * iterating over non-plugin exports and causing duplicate plugin invocations.
 */
const __test_payloads: EventPayload[] = [];

/**
 * Test-only: reset module-level flags so toast tests can run independently.
 */
function __test_resetFlags(): void {
  hasCheckedUpdate = false;
  hasShownStartupToast = false;
  isTestEnvironment = true;
  lastCacheWriteTime = 0;
  __test_payloads.length = 0;
  resetProjectAgg();
}

// Expose test helpers via globalThis (safe for production - only used in tests)
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace globalThis {
  // eslint-disable-next-line no-var
  var __ul_opencode_event_test: {
    payloads: EventPayload[];
    resetFlags: () => void;
  };
}
globalThis.__ul_opencode_event_test = {
  payloads: __test_payloads,
  resetFlags: __test_resetFlags,
};

/**
 * Notification Plugin for OpenCode
 * Listens for session events and sends notifications via configured channels
 */
export const NotificationPlugin: Plugin = async (ctx) => {
  try {
    return await NotificationPluginImpl(ctx);
  } catch (error) {
    logger.error(`NotificationPlugin fatal error: ${error}`);
    return {};
  }
};

/**
 * Actual plugin implementation, wrapped by NotificationPlugin for top-level error safety.
 */
async function NotificationPluginImpl(ctx: Parameters<Plugin>[0]): Promise<ReturnType<Plugin>> {
  // Reset incremental counter for this plugin instance (fresh start per instantiation)
  resetProjectAgg();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    logger.error(`Failed to initialize plugin config: ${error}`);
    setTimeout(() => {
      try {
        ctx.client.tui.showToast({
          body: {
            title: 'ul-opencode-event Config Error',
            message: `配置加载失败: ${String(error).substring(0, 100)}\n详见日志: ~/.local/share/opencode/ul-opencode-event.log`,
            variant: 'error',
            duration: 8000,
          },
        }).catch(() => {});
      } catch {}
      runAutoUpdate(ctx, true).catch((err: unknown) => {
        logger.error(`Auto-update check failed: ${err}`);
      });
    }, 0);
    return {};
  }
  
  if (config.channels.length === 0) {
    logger.warn('Plugin loaded but no enabled channels found');
    const version = getCurrentVersion();
    setTimeout(() => {
      try {
        ctx.client.tui.showToast({
          body: {
            title: `ul-opencode-event ${version ? `v${version}` : ''}`,
            message: '插件已加载但没有启用的通知通道\n请检查配置文件',
            variant: 'warning',
            duration: 5000,
          },
        }).catch(() => {});
      } catch {}
    }, 0);
    return {};
  }

  const { resolveCostConfig, formatCost } = await import('./cost.js');

  const eventHandler: EventHandler = createEventHandler(config);
  const sessionMap = new Map<string, Session>();
  const tokenDataMap = new Map<string, SessionTokenData>();
  const baseDir = process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode');

  // Preload token data from OpenCode database (plugin restart recovery)
  // Deferred via setTimeout so bun:sqlite import doesn't block plugin init
  setTimeout(() => {
    import('./db-preload.js').then(async ({ preloadTokenData }) => {
      await preloadTokenData(tokenDataMap, baseDir, 10, ctx.directory);
      // Initialize projectAgg base from preloaded data (matching projectPath only)
      const normalizedTarget = path.normalize(ctx.directory);
      for (const [, sessionData] of tokenDataMap) {
        if (sessionData.projectPath && path.normalize(sessionData.projectPath) === normalizedTarget) {
          const tokens = sumAllCompletedTokens(sessionData);
          const sessionCost = [...sessionData.messages.values()].reduce((sum, td) => sum + td.cost, 0);
          projectAgg.input += tokens.input;
          projectAgg.output += tokens.output;
          projectAgg.reasoning += tokens.reasoning;
          projectAgg.cacheRead += tokens.cacheRead;
          projectAgg.cacheWrite += tokens.cacheWrite;
          projectAgg.total += tokens.total;
          projectAgg.cost += sessionCost;
          projectAgg.requestCount += sessionData.messages.size;
        }
      }
    }).catch((err: unknown) => {
      logger.error(`Token data preload failed: ${err}`);
    });
  }, 0);

  // Load session token cache for accurate project-level aggregation (deferred)
  let sessionCache: Map<string, SessionCacheEntry> = new Map();
  setTimeout(() => {
    try {
      sessionCache = loadSessionCache(baseDir);
      // Supplement projectAgg base from sessionCache (dedup: exclude preload sessions)
      const normalizedTarget = path.normalize(ctx.directory);
      for (const [sessionId, entry] of sessionCache) {
        if (tokenDataMap.has(sessionId)) continue; // already counted by preload
        if (path.normalize(entry.projectPath) === normalizedTarget) {
          projectAgg.cost += entry.cost;
          projectAgg.input += entry.tokens.input;
          projectAgg.output += entry.tokens.output;
          projectAgg.reasoning += entry.tokens.reasoning;
          projectAgg.cacheRead += entry.tokens.cacheRead;
          projectAgg.cacheWrite += entry.tokens.cacheWrite;
          projectAgg.total += entry.tokens.total;
          projectAgg.requestCount += entry.requestCount || 0;
        }
      }
    } catch {
      // non-critical: plugin works without cached session data
    }
  }, 0);

  // Auto-register /ul-token-rebuild slash command
  try {
    const commandDir = path.join(os.homedir(), '.config', 'opencode', 'command');
    const commandFile = path.join(commandDir, 'ul-token-rebuild.md');
    // Use dynamic import for fs (async context, non-hot path)
    const cmdFs = (await import('node:fs')).default || (await import('node:fs'));
    if (!cmdFs.existsSync(commandFile)) {
      cmdFs.mkdirSync(commandDir, { recursive: true });
      cmdFs.writeFileSync(commandFile, [
        '---',
        'description: 从数据库重建 token 缓存，提升项目级聚合准确度',
        '---',
        '直接调用 ul-token-rebuild 工具，不要委派给其他 agent。执行后向用户报告同步结果。',
        '',
      ].join('\n'), 'utf-8');
    }
  } catch (cmdErr) {
    // Non-critical: command registration failure should not block plugin
    logger.warn(`Failed to register slash command: ${cmdErr}`);
  }

  if (DEBUG_ENABLED) {
    logger.debug(`Plugin initialized for ${ctx.directory} with ${config.channels.length} channels`);
  }

  return {
    event: async ({ event }) => {
      if (DEBUG_ENABLED) {
        const props = event.properties as Record<string, unknown>;
        const info = (props as { info?: { id?: string; title?: string } }).info;
        logger.debug(`[EVENT] type=${event.type}` +
          (info?.id ? ` session.id=${info.id}` : '') +
          (props.sessionID ? ` sessionID=${String(props.sessionID)}` : '') +
          (info?.title ? ` title="${info.title}"` : ' title=(empty/missing)'));
      }

      if (event.type === 'session.created') {
        sessionMap.set(event.properties.info.id, event.properties.info);

        // Extract OpenCode version from session info and pass to handler
        if (event.properties.info.version) {
          eventHandler.setOpenCodeVersion(event.properties.info.version);
        }

        // Backfill projectPath for sessions that already exist in tokenDataMap (from preloading)
        const existingSessionData = tokenDataMap.get(event.properties.info.id);
        if (existingSessionData && !existingSessionData.projectPath && event.properties.info.directory) {
          existingSessionData.projectPath = event.properties.info.directory;
          // Retroactively add preloaded session data to projectAgg (missed during preload init)
          if (path.normalize(event.properties.info.directory) === path.normalize(ctx.directory)) {
            const tokens = sumAllCompletedTokens(existingSessionData);
            const sessionCost = [...existingSessionData.messages.values()].reduce((sum, td) => sum + td.cost, 0);
            projectAgg.input += tokens.input;
            projectAgg.output += tokens.output;
            projectAgg.reasoning += tokens.reasoning;
            projectAgg.cacheRead += tokens.cacheRead;
            projectAgg.cacheWrite += tokens.cacheWrite;
            projectAgg.total += tokens.total;
            projectAgg.cost += sessionCost;
            projectAgg.requestCount += existingSessionData.messages.size;
          }
        }

        // Auto-update check (runs once, first main session only)
        if (!hasCheckedUpdate) {
          hasCheckedUpdate = true;
          const info = event.properties.info;
          const isCliMode = process.env.OPENCODE_CLI_RUN_MODE === 'true';
          const isSubSession = info.parentID !== undefined && info.parentID !== '';
          if (!isCliMode && !isSubSession) {
            setTimeout(() => {
              runAutoUpdate(ctx, config.auto_update ?? true).catch((err) => {
                logger.error(`Auto-update check failed: ${err}`);
              });
            }, 0);
          }
        }

        // Startup toast (version + channel count, once per process)
        if (!hasShownStartupToast) {
          hasShownStartupToast = true;
          const info = event.properties.info;
          const isCliMode = process.env.OPENCODE_CLI_RUN_MODE === 'true';
          const isSubSession = info.parentID !== undefined && info.parentID !== '';
          if (!isCliMode && !isSubSession) {
            setTimeout(() => {
              const version = getCurrentVersion();
              const channelCount = config.channels.length;
              const channelTypes = [...new Set(config.channels.map(c => c.type))].join(', ');
              const title = `ul-opencode-event ${version ? `v${version}` : ''}`;
              const message = `${channelCount} channel${channelCount !== 1 ? 's' : ''} loaded (${channelTypes})`;
              try {
                ctx.client.tui.showToast({
                  body: { title, message, variant: 'success', duration: 3000 },
                }).catch(() => {});
              } catch {}
            }, 0);
          }
        }
      } else if (event.type === 'session.updated') {
        sessionMap.set(event.properties.info.id, event.properties.info);
      } else if (event.type === 'message.updated') {
        // Handle assistant message token data accumulation
        const msgInfo = (event.properties as { info: Record<string, unknown> }).info;
        if (msgInfo?.role === 'assistant') {
          const sessionId = msgInfo.sessionID as string | undefined;
          const messageId = msgInfo.id as string | undefined;
          if (sessionId && messageId) {
            let sessionData = tokenDataMap.get(sessionId);
            if (!sessionData) {
              sessionData = {
                messages: new Map(),
                lastModelID: '',
                lastProviderID: '',
                lastMode: '',
                // Tag with project path from sessionMap or fallback to ctx.directory
                projectPath: sessionMap.get(sessionId)?.directory ?? ctx.directory,
              };
              tokenDataMap.set(sessionId, sessionData);
            }

            const sdkTokens = msgInfo.tokens as Parameters<typeof parseTokenFields>[0];
            const tokenData: TokenData = {
              cost: parseMessageCost(msgInfo as { cost?: number | null }),
              tokens: parseTokenFields(sdkTokens),
              modelID: (msgInfo.modelID as string) ?? '',
              providerID: (msgInfo.providerID as string) ?? '',
              mode: (msgInfo.mode as string) ?? '',
            };

            // Overwrite (not accumulate) for same message ID
            // Incremental projectAgg update: delta = new - old
            const oldTokenData = sessionData.messages.get(messageId);
            if (sessionData.projectPath && path.normalize(sessionData.projectPath) === path.normalize(ctx.directory)) {
              const deltaCost = tokenData.cost - (oldTokenData?.cost ?? 0);
              const deltaInput = tokenData.tokens.input - (oldTokenData?.tokens.input ?? 0);
              const deltaOutput = tokenData.tokens.output - (oldTokenData?.tokens.output ?? 0);
              const deltaReasoning = tokenData.tokens.reasoning - (oldTokenData?.tokens.reasoning ?? 0);
              const deltaCacheRead = tokenData.tokens.cacheRead - (oldTokenData?.tokens.cacheRead ?? 0);
              const deltaCacheWrite = tokenData.tokens.cacheWrite - (oldTokenData?.tokens.cacheWrite ?? 0);
              const deltaTotal = deltaInput + deltaOutput + deltaCacheRead + deltaCacheWrite;
              projectAgg.cost += deltaCost;
              projectAgg.input += deltaInput;
              projectAgg.output += deltaOutput;
              projectAgg.reasoning += deltaReasoning;
              projectAgg.cacheRead += deltaCacheRead;
              projectAgg.cacheWrite += deltaCacheWrite;
              projectAgg.total += deltaTotal;
              // New message (not overwrite) -> increment request count
              if (!oldTokenData) {
                projectAgg.requestCount += 1;
              }
            }
            sessionData.messages.set(messageId, tokenData);
            sessionData.lastModelID = tokenData.modelID;
            sessionData.lastProviderID = tokenData.providerID;
            sessionData.lastMode = tokenData.mode;
            if (!sessionData.projectPath) {
              sessionData.projectPath = sessionMap.get(sessionId)?.directory ?? ctx.directory;
              // Retroactively add all messages to projectAgg (handles preloaded sessions without directory)
              if (sessionData.projectPath && path.normalize(sessionData.projectPath) === path.normalize(ctx.directory)) {
                const allTokens = sumAllCompletedTokens(sessionData);
                const allCost = [...sessionData.messages.values()].reduce((sum, td) => sum + td.cost, 0);
                projectAgg.input += allTokens.input;
                projectAgg.output += allTokens.output;
                projectAgg.reasoning += allTokens.reasoning;
                projectAgg.cacheRead += allTokens.cacheRead;
                projectAgg.cacheWrite += allTokens.cacheWrite;
                projectAgg.total += allTokens.total;
                projectAgg.cost += allCost;
                projectAgg.requestCount += sessionData.messages.size;
              }
            }
          }
        }
        // message.updated does not produce a notification
        return;
      }

      let sessionInfo: Session | undefined;
      const props = event.properties as Record<string, unknown>;
      if (typeof props.sessionID === 'string') {
        sessionInfo = sessionMap.get(props.sessionID);
      } else if (event.type === 'session.created') {
        sessionInfo = (event.properties as { info: Session }).info;
      }

      const resolvedTimezone = config.timezone ?? getDefaultTimezone(config.language);
      if (DEBUG_ENABLED && sessionInfo) {
        logger.debug(`[RESOLVED] sessionInfo.id=${sessionInfo.id} title="${sessionInfo.title}" parentID=${sessionInfo.parentID ?? '(none)'}`);
      }
      if (DEBUG_ENABLED && !sessionInfo && typeof (event.properties as Record<string, unknown>).sessionID === 'string') {
        logger.debug(`[RESOLVED] MISS sessionID=${(event.properties as Record<string, unknown>).sessionID} - sessionMap has no entry`);
      }
      const resolvedProjectName = config.projectName || path.basename(ctx.directory) || 'unknown-project';
      const payload = eventToPayload(event, resolvedProjectName, sessionInfo, resolvedTimezone, ctx.directory, tokenDataMap, config.language, config.cost, resolveCostConfig, formatCost);
      
      if (!payload) {
        return;
      }

      // Aggregate sub-session token data into total fields
      aggregateSubSessions(payload, tokenDataMap, sessionMap, config.language, config.cost, resolveCostConfig, formatCost);

      // Aggregate project-level token data
      fillProjectData(payload, tokenDataMap, ctx.directory, config.language, config.cost, resolveCostConfig, formatCost, sessionCache);

      // Filter by session type whitelist (default: only 'main' sessions)
      const allowedTypes = config.includeSessionTypes ?? DEFAULT_SESSION_TYPES;
      if (!allowedTypes.includes(payload.sessionType)) {
        if (DEBUG_ENABLED) {
          logger.debug(`Skipping ${payload.sessionType} event ${payload.eventType} for session ${payload.sessionId}`);
        }
        return;
      }

      // Debug: warn when sessionMap miss produces 'unknown' (possible race condition)
      if (DEBUG_ENABLED && payload.sessionType === 'unknown' && typeof (event.properties as Record<string, unknown>).sessionID === 'string') {
        logger.warn(`sessionMap miss for sessionID=${(event.properties as Record<string, unknown>).sessionID}, treating as 'unknown'. Race condition?`);
      }

      if (DEBUG_ENABLED) {
        logger.debug(`Handling event ${payload.eventType} for session ${payload.sessionId}`);
      }

      // Test-only: capture payload for verification
      __test_payloads.push(payload);

      try {
        await eventHandler.handle(payload.eventType, payload);
      } catch (error) {
        logger.error(`Failed to handle event ${payload.eventType}: ${error}`);
      }

      // Cache write: persist session token data for project-level aggregation
      // Skip during tests to prevent cross-test filesystem pollution
      if (!isTestEnvironment) {
        try {
          const shouldWrite =
            payload.eventType === 'idle' ||
            payload.eventType === 'error' ||
            (payload.eventType === 'status' && Date.now() - lastCacheWriteTime >= 60000);

          if (shouldWrite) {
            const sessionId = payload.sessionId;
            const sessionData = tokenDataMap.get(sessionId);
            if (sessionData) {
              const entry = buildCacheEntry(sessionId, sessionData);
              if (entry) {
                writeCacheEntry(baseDir, entry);
                if (payload.eventType === 'status') {
                  lastCacheWriteTime = Date.now();
                }
              }
            }
          }
        } catch (cacheErr) {
          logger.error(`Cache write failed: ${cacheErr}`);
        }
      }


    },
    tool: {
      'ul-token-rebuild': tool({
        description: '从 OpenCode 数据库重建会话 token 缓存。扫描所有历史会话，将缺失的会话聚合数据写入缓存文件。用于首次安装、缓存丢失后恢复、或定期刷新项目级 token 聚合准确度。',
        args: {},
        execute: async (_args, _toolCtx) => {
          try {
            const { syncFromDB } = await import('./session-cache.js');
            const result = await syncFromDB(baseDir, _toolCtx.directory, sessionCache);
            // Refresh in-memory cache after successful sync
            sessionCache = loadSessionCache(baseDir);
            return `Token cache rebuild complete.\n- New sessions synced: ${result.newSessions}\n- Total cached sessions: ${result.totalSessions}\n- Total tokens: input=${result.totalTokens.input}, output=${result.totalTokens.output}, cacheRead=${result.totalTokens.cacheRead}, cacheWrite=${result.totalTokens.cacheWrite}`;
          } catch (err) {
            return `Token cache rebuild failed: ${err}`;
          }
        },
      }),
    },
  };
};

/**
 * PluginModule format for OpenCode 1.14+ compatibility.
 * The new plugin loader expects { id, server } object, not a bare function.
 */
export default {
  id: "@ulthon/ul-opencode-event",
  server: NotificationPlugin,
};
