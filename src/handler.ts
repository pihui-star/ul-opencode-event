/**
 * Multi-channel event handler for notifications
 */
import type { NotificationConfig, EventPayload, EventType, Channel, TemplateConfig } from './types.js';
import { renderTemplate } from './template.js';
import { createEmailSender, type EmailSender } from './email.js';

export interface EventHandler {
  handle: (eventType: EventType, payload: EventPayload) => Promise<void>;
  close: () => Promise<void>;
}

// Default templates when channel doesn't have custom templates
const defaultTemplates: Record<EventType, TemplateConfig> = {
  created: {
    subject: '[OpenCode] Task Started - {{projectName}}',
    body: 'Task started at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}',
  },
  idle: {
    subject: '[OpenCode] Task Completed - {{projectName}}',
    body: 'Task completed at {{timestamp}}\nDuration: {{duration}}\nMessage: {{message}}',
  },
  error: {
    subject: '[OpenCode] Task Error - {{projectName}}',
    body: 'Error at {{timestamp}}\nError: {{error}}',
  },
};

/**
 * Creates an event handler that dispatches notifications to all enabled channels
 * Senders are cached at initialization for connection reuse)
 */
export function createEventHandler(config: NotificationConfig): EventHandler {
  // Create and cache all senders at initialization (connection reuse)
  const senders: Map<string, EmailSender> = new Map();
  // map channel index to sender key for same order
  const channelIndexMap: Map<number, string> = new Map();

  for (let i = 0; i < config.channels.length; i++) {
    const channel = config.channels[i];
    const sender = createChannelSender(channel);
    if (sender) {
      const key = channel.name || `channel-${i}`;
      senders.set(key, sender);
      channelIndexMap.set(i, key);
    }
  }

  return {
    handle: async (eventType: EventType, payload: EventPayload): Promise<void> => {
      // Process each channel using cached senders
      for (let i = 0; i < config.channels.length; i++) {
        const channel = config.channels[i];

        // Check if this event type is enabled for the channel
        const eventEnabled = channel.events[eventType];
        if (eventEnabled === false) {
          continue;
        }

        // Get template (channel-specific or default)
        const template = channel.templates?.[eventType] ?? defaultTemplates[eventType];

        // prepare template variables from payload
        const variables = {
          eventType: payload.eventType,
          timestamp: payload.timestamp,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          message: payload.message,
          error: payload.error,
          duration: payload.duration,
        };

        // render templates
        const subject = template.subject ? renderTemplate(template.subject, variables) : '';
        const body = template.body ? renderTemplate(template.body, variables) : '';

        // dispatch using cached sender
        const key = channel.name || `channel-${i}`;
        const sender = senders.get(key);
        if (sender) {
          await sender.send(subject, body);
        }
      }
    },

    close: async (): Promise<void> => {
      // close all cached senders (cleanup SMTP connections)
      const closePromises = Array.from(senders.values()).map(sender => sender.close());
      await Promise.all(closePromises);
      senders.clear();
      channelIndexMap.clear();
    },
  };
}

/**
 * create a sender for the given channel type
 */
function createChannelSender(channel: Channel): EmailSender | null {
  switch (channel.type) {
    case 'smtp':
      return createEmailSender(channel);
    case 'feishu':
    case 'dingtalk':
      // skip unsupported channel types silently
      return null;
    default: {
      // log warning for unknown channel types
      const _exhaustiveCheck: never = channel.type;
      console.warn(`[EventHandler] unsupported channel type: ${_exhaustiveCheck}`);
      return null;
    }
  }
}
