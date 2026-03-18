/**
 * Multi-channel event handler for notifications
 */
import type { NotificationConfig, EventPayload, EventType, Channel, TemplateConfig } from './types.js';
import { renderTemplate } from './template.js';
import { createEmailSender } from './email.js';

export interface EventHandler {
  handle: (eventType: EventType, payload: EventPayload) => Promise<void>;
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
 */
export function createEventHandler(config: NotificationConfig): EventHandler {
  return {
    handle: async (eventType: EventType, payload: EventPayload): Promise<void> => {
      // Process each channel
      for (const channel of config.channels) {
        // Skip disabled channels
        if (channel.enabled === false) {
          continue;
        }

        // Check if this event type is enabled for the channel
        const eventEnabled = channel.events[eventType];
        if (eventEnabled === false) {
          continue;
        }

        // Get template (channel-specific or default)
        const template = channel.templates?.[eventType] ?? defaultTemplates[eventType];
        
        // Prepare template variables from payload
        const variables = {
          eventType: payload.eventType,
          timestamp: payload.timestamp,
          projectName: payload.projectName,
          sessionId: payload.sessionId,
          message: payload.message,
          error: payload.error,
          duration: payload.duration,
        };

        // Render templates
        const subject = template.subject ? renderTemplate(template.subject, variables) : '';
        const body = template.body ? renderTemplate(template.body, variables) : '';

        // Dispatch based on channel type
        await dispatchToChannel(channel, subject, body);
      }
    },
  };
}

/**
 * Dispatch notification to the appropriate channel sender
 */
async function dispatchToChannel(channel: Channel, subject: string, body: string): Promise<void> {
  switch (channel.type) {
    case 'smtp': {
      const sender = createEmailSender(channel);
      if (sender) {
        await sender.send(subject, body);
      }
      break;
    }
    case 'feishu':
    case 'dingtalk':
      // Skip unsupported channel types silently
      break;
    default: {
      // Log warning for unknown channel types
      const _exhaustiveCheck: never = channel.type;
      console.warn(`[EventHandler] Unsupported channel type: ${_exhaustiveCheck}`);
    }
  }
}
