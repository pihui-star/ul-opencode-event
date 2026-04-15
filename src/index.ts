/**
 * Notification Plugin Entry Point
 * Sends email notifications when session events occur
 */
import type { Plugin } from '@opencode-ai/plugin';
import type { Event, Session } from '@opencode-ai/sdk';
import * as path from 'path';
import { loadConfig } from './config.js';
import { createEventHandler, type EventHandler } from './handler.js';
import { getDefaultTimezone } from './locales.js';
import type { EventPayload, EventType, SessionType, SessionTokenData, TokenData, TokenBreakdown } from './types.js';
import { DEFAULT_SESSION_TYPES } from './types.js';
import { logger, DEBUG_ENABLED } from './logger.js';
import { runAutoUpdate, getCurrentVersion } from './updater.js';
// cost.js imported lazily inside NotificationPlugin to follow lazy-import convention

/**
 * Resolve session type from SDK Session info.
 * - undefined/missing sessionInfo → 'unknown' (race condition or file.edited)
 * - has parentID → 'subagent' (child of main session)
 * - no parentID → 'main' (primary user session)
 */
function resolveSessionType(sessionInfo?: Session): SessionType {
  if (!sessionInfo) return 'unknown';
  if (sessionInfo.parentID !== undefined && sessionInfo.parentID !== '') return 'subagent';
  return 'main';
}

/**
 * Aggregate token data for a session from its SessionTokenData.
 * Sums cost and all token fields across messages (each message.id counted once).
 */
function aggregateSessionTokens(sessionData: SessionTokenData): { cost: number; tokens: TokenBreakdown } {
  let cost = 0;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  for (const td of sessionData.messages.values()) {
    cost += td.cost;
    input += td.tokens.input;
    output += td.tokens.output;
    reasoning += td.tokens.reasoning;
    cacheRead += td.tokens.cacheRead;
    cacheWrite += td.tokens.cacheWrite;
  }

  return {
    cost,
    tokens: {
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total: input + output + reasoning + cacheRead + cacheWrite,
    },
  };
}

/**
 * Convert SDK Event to internal EventPayload
 */
function eventToPayload(
  event: Event,
  projectName: string,
  sessionInfo: Session | undefined,
  timezone: string | undefined,
  projectPath: string | undefined,
  tokenDataMap: Map<string, SessionTokenData> | undefined,
  configLanguage: string | undefined,
  configCost: import('./types.js').CostConfig | undefined,
  resolveCostConfigFn: typeof import('./cost.js').resolveCostConfig,
  formatCostFn: typeof import('./cost.js').formatCost,
): EventPayload | null {
  const basePayload = {
    timestamp: formatTimestamp(new Date().toISOString(), timezone),
    projectName,
    projectPath,
    sessionId: '',
    sessionTitle: undefined,
  };

  switch (event.type) {
    case 'session.created':
      return {
        ...basePayload,
        eventType: 'created' as EventType,
        sessionId: event.properties.info.id,
        sessionTitle: event.properties.info.title,
        sessionType: resolveSessionType(event.properties.info),
        parentSessionId: event.properties.info.parentID ?? undefined,
      };
    case 'session.idle': {
      const idlePayload: EventPayload = {
        ...basePayload,
        eventType: 'idle' as EventType,
        sessionId: event.properties.sessionID,
        message: 'Task completed successfully',
        duration: sessionInfo ? formatDuration(Date.now() - sessionInfo.time.created) : undefined,
        sessionTitle: sessionInfo?.title,
        sessionType: resolveSessionType(sessionInfo),
        parentSessionId: sessionInfo?.parentID ?? undefined,
      };
      fillTokenData(idlePayload, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
      return idlePayload;
    }
    case 'session.error': {
      const errorObj = event.properties.error;
      const sessionId = event.properties.sessionID;
      const errorPayload: EventPayload = {
        ...basePayload,
        eventType: 'error' as EventType,
        sessionId: sessionId ?? '',
        error: errorObj ? formatError(errorObj) : 'Unknown error',
        sessionTitle: sessionInfo?.title,
        sessionType: resolveSessionType(sessionInfo),
        parentSessionId: sessionInfo?.parentID ?? undefined,
      };
      fillTokenData(errorPayload, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
      return errorPayload;
    }

    default: {
      // 处理 SDK Event 联合类型中未声明、但运行时可能收到的事件
      const rawType = event.type as string;
      const rawProps = event.properties as Record<string, unknown>;

      // question.asked -- AI 向用户提问（主要目标，默认开启）
      if (rawType === 'question.asked') {
        const questions = rawProps.questions as Array<Record<string, unknown>> | undefined;
        const firstQ = questions?.[0];
        const p: EventPayload = {
          ...basePayload,
          eventType: 'question' as EventType,
          sessionId: (rawProps.sessionID as string) || '',
          title: firstQ?.header ? String(firstQ.header) : undefined,
          questionText: firstQ?.question ? String(firstQ.question) : undefined,
          options: firstQ?.options ? JSON.stringify(firstQ.options) : undefined,
          sessionTitle: sessionInfo?.title,
          sessionType: resolveSessionType(sessionInfo),
          parentSessionId: sessionInfo?.parentID ?? undefined,
        };
        fillTokenData(p, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
        return p;
      }

      // permission.updated -- 权限确认请求（默认开启）
      if (rawType === 'permission.updated') {
        const perm = rawProps as { sessionID?: string; title?: string; type?: string };
        const p: EventPayload = {
          ...basePayload,
          eventType: 'permission' as EventType,
          sessionId: perm.sessionID || '',
          title: perm.title,
          permissionType: perm.type,
          sessionTitle: sessionInfo?.title,
          sessionType: resolveSessionType(sessionInfo),
          parentSessionId: sessionInfo?.parentID ?? undefined,
        };
        fillTokenData(p, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
        return p;
      }

      // session.status -- 会话状态变化（默认关闭）
      if (rawType === 'session.status') {
        const statusEvent = rawProps as { sessionID?: string; status?: { type?: string } };
        const p: EventPayload = {
          ...basePayload,
          eventType: 'status' as EventType,
          sessionId: statusEvent.sessionID || '',
          statusType: statusEvent.status?.type,
          sessionTitle: sessionInfo?.title,
          sessionType: resolveSessionType(sessionInfo),
          parentSessionId: sessionInfo?.parentID ?? undefined,
        };
        fillTokenData(p, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
        return p;
      }

      // command.executed -- shell 命令执行完毕（默认关闭）
      if (rawType === 'command.executed') {
        const cmd = rawProps as { name?: string; arguments?: string; sessionID?: string };
        const p: EventPayload = {
          ...basePayload,
          eventType: 'command' as EventType,
          sessionId: cmd.sessionID || '',
          commandName: cmd.name,
          arguments: cmd.arguments,
          sessionTitle: sessionInfo?.title,
          sessionType: resolveSessionType(sessionInfo),
          parentSessionId: sessionInfo?.parentID ?? undefined,
        };
        fillTokenData(p, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
        return p;
      }

      // file.edited -- 文件被编辑（默认关闭）
      if (rawType === 'file.edited') {
        const fileEvt = rawProps as { file?: string };
        const p: EventPayload = {
          ...basePayload,
          eventType: 'fileEdited' as EventType,
          filePath: fileEvt.file,
          sessionType: resolveSessionType(sessionInfo),
          parentSessionId: sessionInfo?.parentID ?? undefined,
        };
        fillTokenData(p, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
        return p;
      }

      // todo.updated -- Todo 列表更新（默认关闭）
      if (rawType === 'todo.updated') {
        const todoEvt = rawProps as { todos?: Array<{ content: string; status: string }> | undefined; sessionID?: string };
        const summary = todoEvt.todos
          ?.map(t => `[${t.status}] ${t.content}`).join('\n');
        const p: EventPayload = {
          ...basePayload,
          eventType: 'todo' as EventType,
          sessionId: todoEvt.sessionID || '',
          todoSummary: summary,
          sessionTitle: sessionInfo?.title,
          sessionType: resolveSessionType(sessionInfo),
          parentSessionId: sessionInfo?.parentID ?? undefined,
        };
        fillTokenData(p, tokenDataMap, configLanguage, configCost, resolveCostConfigFn, formatCostFn);
        return p;
      }

      return null;
    }
  }
}

/**
 * Fill token/cost data into an EventPayload from tokenDataMap.
 * Computes sessionCost and formatted strings.
 * Skips session.created events (no token data at creation time).
 */
function fillTokenData(
  payload: EventPayload,
  tokenDataMap?: Map<string, SessionTokenData>,
  configLanguage?: string,
  configCost?: import('./types.js').CostConfig,
  resolveCostConfigFn?: typeof import('./cost.js').resolveCostConfig,
  formatCostFn?: typeof import('./cost.js').formatCost,
): void {
  if (!tokenDataMap) return;
  if (payload.eventType === 'created') return;

  const sessionId = payload.sessionId;
  const sessionData = tokenDataMap.get(sessionId);
  if (!sessionData || sessionData.messages.size === 0) return;

  // Session-level aggregation
  const sessionAgg = aggregateSessionTokens(sessionData);
  payload.sessionCost = sessionAgg.cost;
  payload.sessionTokens = sessionAgg.tokens;
  payload.modelID = sessionData.lastModelID;
  payload.providerID = sessionData.lastProviderID;
  payload.mode = sessionData.lastMode;

  // Initially total = session only (sub-sessions added later by aggregateSubSessions)
  payload.totalCost = sessionAgg.cost;
  payload.totalTokens = { ...sessionAgg.tokens };

  // Cost formatting
  if (resolveCostConfigFn && formatCostFn) {
    const resolved = resolveCostConfigFn(configLanguage, configCost);
    payload.costFormatted = formatCostFn(sessionAgg.cost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
    payload.totalCostFormatted = payload.costFormatted;
    payload.currency = resolved.currency;
  }
}

/**
 * Aggregate sub-session token data into a payload's total fields.
 * Scans tokenDataMap for all sessions whose parentID matches the current session.
 */
function aggregateSubSessions(
  payload: EventPayload,
  tokenDataMap: Map<string, SessionTokenData>,
  sessionMap: Map<string, Session>,
  configLanguage?: string,
  configCost?: import('./types.js').CostConfig,
  resolveCostConfigFn?: typeof import('./cost.js').resolveCostConfig,
  formatCostFn?: typeof import('./cost.js').formatCost,
): void {
  const sessionId = payload.sessionId;
  if (payload.sessionCost === undefined) return;

  let totalCost = payload.sessionCost;
  const st = payload.sessionTokens!;
  let totalInput = st.input;
  let totalOutput = st.output;
  let totalReasoning = st.reasoning;
  let totalCacheRead = st.cacheRead;
  let totalCacheWrite = st.cacheWrite;

  for (const [sid, sData] of tokenDataMap) {
    if (sid === sessionId) continue;
    const sInfo = sessionMap.get(sid);
    if (sInfo?.parentID === sessionId) {
      const agg = aggregateSessionTokens(sData);
      totalCost += agg.cost;
      totalInput += agg.tokens.input;
      totalOutput += agg.tokens.output;
      totalReasoning += agg.tokens.reasoning;
      totalCacheRead += agg.tokens.cacheRead;
      totalCacheWrite += agg.tokens.cacheWrite;
    }
  }

  payload.totalCost = totalCost;
  payload.totalTokens = {
    input: totalInput,
    output: totalOutput,
    reasoning: totalReasoning,
    cacheRead: totalCacheRead,
    cacheWrite: totalCacheWrite,
    total: totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheWrite,
  };

  // Re-format totalCostFormatted with the aggregated total
  if (resolveCostConfigFn && formatCostFn) {
    const resolved = resolveCostConfigFn(configLanguage, configCost);
    payload.totalCostFormatted = formatCostFn(totalCost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format timestamp with optional timezone conversion.
 * When timezone is not configured, returns original ISO string (backward compatible).
 * When timezone is configured, returns localized time string using Intl.DateTimeFormat.
 * Invalid timezone strings gracefully fall back to UTC.
 */
function formatTimestamp(isoString: string, timezone?: string): string {
  if (!timezone) {
    return isoString;
  }
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Format error object to string
 */
function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error) return String((error as { message: unknown }).message);
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Guard flag to ensure auto-update only runs once per plugin load
 */
let hasCheckedUpdate = false;
let hasShownStartupToast = false;

/**
 * Test-only: captured payloads for verification in tests.
 * Cleared in __test_resetFlags().
 */
const __test_payloads: EventPayload[] = [];

/**
 * Notification Plugin for OpenCode
 * Listens for session events and sends notifications via configured channels
 */
export const NotificationPlugin: Plugin = async (ctx) => {
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
              };
              tokenDataMap.set(sessionId, sessionData);
            }

            const sdkTokens = msgInfo.tokens as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined;
            const tokenData: TokenData = {
              cost: (msgInfo.cost as number) ?? 0,
              tokens: {
                input: sdkTokens?.input ?? 0,
                output: sdkTokens?.output ?? 0,
                reasoning: sdkTokens?.reasoning ?? 0,
                cacheRead: sdkTokens?.cache?.read ?? 0,
                cacheWrite: sdkTokens?.cache?.write ?? 0,
                total: (sdkTokens?.input ?? 0) + (sdkTokens?.output ?? 0) + (sdkTokens?.reasoning ?? 0) + (sdkTokens?.cache?.read ?? 0) + (sdkTokens?.cache?.write ?? 0),
              },
              modelID: (msgInfo.modelID as string) ?? '',
              providerID: (msgInfo.providerID as string) ?? '',
              mode: (msgInfo.mode as string) ?? '',
            };

            // Overwrite (not accumulate) for same message ID
            sessionData.messages.set(messageId, tokenData);
            sessionData.lastModelID = tokenData.modelID;
            sessionData.lastProviderID = tokenData.providerID;
            sessionData.lastMode = tokenData.mode;
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

      // Clean up tokenDataMap after session.idle or session.error
      if (event.type === 'session.idle' || event.type === 'session.error') {
        const sid = (event.properties as Record<string, unknown>).sessionID as string | undefined;
        if (sid) {
          tokenDataMap.delete(sid);
        }
      }
    },
  };
};

export default NotificationPlugin;

/**
 * Test-only: reset module-level flags so toast tests can run independently.
 */
function __test_resetFlags(): void {
  hasCheckedUpdate = false;
  hasShownStartupToast = false;
  __test_payloads.length = 0;
}

/**
 * Test-only helpers namespace.
 * Exported as a plain object (not a function) so OpenCode's plugin loader
 * does not mistake it for a Plugin entry point and call it.
 */
export const __test = {
  payloads: __test_payloads,
  resetFlags: __test_resetFlags,
};
