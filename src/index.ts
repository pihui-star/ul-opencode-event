/**
 * Notification Plugin Entry Point
 * Sends email notifications when session events occur
 */
import type { Plugin } from '@opencode-ai/plugin';
import type { Event, Session } from '@opencode-ai/sdk';
import { loadConfig } from './config.js';
import { createEventHandler, type EventHandler } from './handler.js';
import type { EventPayload, EventType } from './types.js';

const LOG_PREFIX = '[ul-opencode-event]';
const DEBUG_ENABLED = process.env.UL_OPENCODE_EVENT_DEBUG === '1' || process.env.UL_OPENCODE_EVENT_DEBUG === 'true';

/**
 * Convert SDK Event to internal EventPayload
 */
function eventToPayload(event: Event, projectName: string, sessionInfo?: Session): EventPayload | null {
  const basePayload = {
    timestamp: new Date().toISOString(),
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
    default:
      return null;
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

      const payload = eventToPayload(event, ctx.directory, sessionInfo);
      
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
