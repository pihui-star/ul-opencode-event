/**
 * Notification Plugin Entry Point
 * Sends email notifications when session events occur
 */
import type { Plugin } from '@opencode-ai/plugin';
import type { Event, Session } from '@opencode-ai/sdk';
import { loadConfig } from './config.js';
import { createEventHandler, type EventHandler } from './handler.js';
import { getDefaultTimezone } from './locales.js';
import type { EventPayload, EventType } from './types.js';

const LOG_PREFIX = '[ul-opencode-event]';
const DEBUG_ENABLED = process.env.UL_OPENCODE_EVENT_DEBUG === '1' || process.env.UL_OPENCODE_EVENT_DEBUG === 'true';

/**
 * Convert SDK Event to internal EventPayload
 */
function eventToPayload(event: Event, projectName: string, sessionInfo?: Session, timezone?: string): EventPayload | null {
  const basePayload = {
    timestamp: formatTimestamp(new Date().toISOString(), timezone),
    projectName,
    sessionId: '',
  };

  switch (event.type) {
    case 'session.created':
      return {
        ...basePayload,
        eventType: 'created' as EventType,
        sessionId: event.properties.info.id,
      };
    case 'session.idle': {
      return {
        ...basePayload,
        eventType: 'idle' as EventType,
        sessionId: event.properties.sessionID,
        message: 'Task completed successfully',
        duration: sessionInfo ? formatDuration(Date.now() - sessionInfo.time.created) : undefined,
      };
    }
    case 'session.error': {
      const errorObj = event.properties.error;
      const sessionId = event.properties.sessionID;
      return {
        ...basePayload,
        eventType: 'error' as EventType,
        sessionId: sessionId ?? '',
        error: errorObj ? formatError(errorObj) : 'Unknown error',
      };
    }

    default: {
      // 处理 SDK Event 联合类型中未声明、但运行时可能收到的事件
      const rawType = event.type as string;
      const rawProps = event.properties as Record<string, unknown>;

      // question.asked -- AI 向用户提问（主要目标，默认开启）
      if (rawType === 'question.asked') {
        const questions = rawProps.questions as Array<Record<string, unknown>> | undefined;
        const firstQ = questions?.[0];
        return {
          ...basePayload,
          eventType: 'question' as EventType,
          sessionId: (rawProps.sessionID as string) || '',
          title: firstQ?.header ? String(firstQ.header) : undefined,
          questionText: firstQ?.question ? String(firstQ.question) : undefined,
          options: firstQ?.options ? JSON.stringify(firstQ.options) : undefined,
        };
      }

      // permission.updated -- 权限确认请求（默认开启）
      if (rawType === 'permission.updated') {
        const perm = rawProps as { sessionID?: string; title?: string; type?: string };
        return {
          ...basePayload,
          eventType: 'permission' as EventType,
          sessionId: perm.sessionID || '',
          title: perm.title,
          permissionType: perm.type,
        };
      }

      // session.status -- 会话状态变化（默认关闭）
      if (rawType === 'session.status') {
        const statusEvent = rawProps as { sessionID?: string; status?: { type?: string } };
        return {
          ...basePayload,
          eventType: 'status' as EventType,
          sessionId: statusEvent.sessionID || '',
          statusType: statusEvent.status?.type,
        };
      }

      // command.executed -- shell 命令执行完毕（默认关闭）
      if (rawType === 'command.executed') {
        const cmd = rawProps as { name?: string; arguments?: string; sessionID?: string };
        return {
          ...basePayload,
          eventType: 'command' as EventType,
          sessionId: cmd.sessionID || '',
          commandName: cmd.name,
          arguments: cmd.arguments,
        };
      }

      // file.edited -- 文件被编辑（默认关闭）
      if (rawType === 'file.edited') {
        const fileEvt = rawProps as { file?: string };
        return {
          ...basePayload,
          eventType: 'fileEdited' as EventType,
          filePath: fileEvt.file,
        };
      }

      // todo.updated -- Todo 列表更新（默认关闭）
      if (rawType === 'todo.updated') {
        const todoEvt = rawProps as { todos?: Array<{ content: string; status: string }> | undefined; sessionID?: string };
        const summary = todoEvt.todos
          ?.map(t => `[${t.status}] ${t.content}`).join('\n');
        return {
          ...basePayload,
          eventType: 'todo' as EventType,
          sessionId: todoEvt.sessionID || '',
          todoSummary: summary,
        };
      }

      return null;
    }
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
 * Notification Plugin for OpenCode
 * Listens for session events and sends notifications via configured channels
 */
export const NotificationPlugin: Plugin = async (ctx) => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to initialize plugin config`, error);
    return {};
  }
  
  if (config.channels.length === 0) {
    console.warn(`${LOG_PREFIX} Plugin loaded but no enabled channels found`);
    return {};
  }

  const eventHandler: EventHandler = createEventHandler(config);
  const sessionMap = new Map<string, Session>();
  if (DEBUG_ENABLED) {
    console.info(`${LOG_PREFIX} Plugin initialized for ${ctx.directory} with ${config.channels.length} channels`);
  }

  return {
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        sessionMap.set(event.properties.info.id, event.properties.info);
      }
      
      let sessionInfo: Session | undefined;
      const props = event.properties as Record<string, unknown>;
      if (typeof props.sessionID === 'string') {
        sessionInfo = sessionMap.get(props.sessionID);
      } else if (event.type === 'session.created') {
        sessionInfo = (event.properties as { info: Session }).info;
      }

      const resolvedTimezone = config.timezone ?? getDefaultTimezone(config.language);
      const payload = eventToPayload(event, ctx.directory, sessionInfo, resolvedTimezone);
      
      if (!payload) {
        return;
      }
      if (DEBUG_ENABLED) {
        console.info(`${LOG_PREFIX} Handling event ${payload.eventType} for session ${payload.sessionId}`);
      }
      try {
        await eventHandler.handle(payload.eventType, payload);
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to handle event ${payload.eventType}`, error);
      }
    },
  };
};

export default NotificationPlugin;
