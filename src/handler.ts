/**
 * Multi-channel event handler for notifications
 *
 * nodemailer is loaded lazily to avoid blocking oh-my-opencode during loading.
 * Only imports when actually needed (when creating senders).
 */
import type { NotificationConfig, EventPayload, EventType, TemplateConfig } from './types.js';
import { renderTemplate } from './template.js';

import type { EmailSender } from './email.js';

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
    body: 'Task completed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nMessage: {{message}}\nDuration: {{duration}}',
  },
  error: {
    subject: '[OpenCode] Task Error - {{projectName}}',
    body: 'Error at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nError: {{error}}',
  },
};

/**
 * Creates an event handler that dispatches notifications to all enabled channels.
 * Senders are created lazily on first handle() call to avoid importing nodemailer at plugin load time.
 */
export function createEventHandler(config: NotificationConfig): EventHandler {
  // Lazy sender cache - created on first use
  const senders: Map<string, EmailSender> = new Map();
  let sendersInitialized = false;

  return {
    handle: async (eventType: EventType, payload: EventPayload): Promise<void> => {
      // Lazy-create senders on first use to avoid nodemailer import at plugin load time
      if (!sendersInitialized) {
        sendersInitialized = true;
        for (let i = 0; i < config.channels.length; i++) {
          const channel = config.channels[i];
          if (channel.type === 'smtp' && channel.enabled !== false) {
            try {
              // Dynamic import to avoid blocking plugin loading
              const emailModule = await import('./email.js');
              const sender = await emailModule.createEmailSender(channel);
              if (sender) {
                const key = channel.name || `channel-${i}`;
                senders.set(key, sender);
              }
            } catch {
              // Silently skip channels that fail to initialize
            }
          }
        }
      }

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

        // Dispatch using cached sender
        const key = channel.name || `channel-${i}`;
        const sender = senders.get(key);
        if (sender) {
          await sender.send(subject, body);
        }
      }
    },

    close: async (): Promise<void> => {
      // Close all cached senders (cleanup SMTP connections)
      const closePromises = Array.from(senders.values()).map(sender => sender.close());
      await Promise.all(closePromises);
      senders.clear();
    },
  };
}
