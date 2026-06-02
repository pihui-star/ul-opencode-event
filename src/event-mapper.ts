/**
 * Event Mapper Module
 * Converts SDK events to internal EventPayload format.
 * Handles all event type mapping and payload construction.
 *
 * Dependencies: token-aggregator (for fillTokenData)
 * No dependency on plugin-core or cost.js.
 */
import type { Event, Session } from '@opencode-ai/sdk';
import type { EventPayload, EventType, SessionType, SessionTokenData } from './types.js';
import { fillTokenData } from './token-aggregator.js';

/**
 * Resolve session type from SDK Session info.
 * - undefined/missing sessionInfo -> 'unknown' (race condition or file.edited)
 * - has parentID -> 'subagent' (child of main session)
 * - no parentID -> 'main' (primary user session)
 */
export function resolveSessionType(sessionInfo?: Session): SessionType {
  if (!sessionInfo) return 'unknown';
  if (sessionInfo.parentID !== undefined && sessionInfo.parentID !== '') return 'subagent';
  return 'main';
}

/**
 * Convert SDK Event to internal EventPayload
 */
export function eventToPayload(
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
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
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
export function formatTimestamp(isoString: string, timezone?: string): string {
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
export function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error) return String((error as { message: unknown }).message);
    return JSON.stringify(error);
  }
  return String(error);
}
