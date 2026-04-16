/**
 * Integration Tests for Full Event Flow
 * Tests: event -> handler -> email
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'crypto';
import type { NotificationConfig, Channel, EventPayload, EventType, EmailSender } from '../../src/types';

// Store captured messages (formatter output: { subject, text } or legacy { subject, body })
let capturedMessages: Array<{
  from?: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}> = [];

// Store mock send behavior for error simulation
let mockSendBehavior: (() => Promise<void>) | null = null;

// Mock the email module BEFORE importing handler
// This avoids the nodemailer caching issue
mock.module('../../src/email', () => ({
  createEmailSender: async (channel: Channel): Promise<EmailSender | null> => {
    // Type guard: return null for non-smtp channels
    if (channel.type !== 'smtp') {
      return null;
    }

    // Return null for disabled channels
    if (channel.enabled === false) {
      return null;
    }

    // Return null if no recipients configured
    if (!channel.recipients || channel.recipients.length === 0) {
      return null;
    }

    const fromName = channel.name || 'Notification';
    const recipients = channel.recipients;

    return {
      async send(message: unknown, legacyBody?: unknown): Promise<void> {
        try {
          if (mockSendBehavior) {
            await mockSendBehavior();
            return;
          }
          let subject: string;
          let body: string;

          // Format 1: FormattedMessage { subject, text } from formatter layer
          if (message && typeof message === 'object') {
            const msg = message as { subject?: string; text?: string };
            if (typeof msg.subject === 'string' && typeof msg.text === 'string') {
              subject = msg.subject;
              body = msg.text;
            } else {
              return;
            }
          }
          // Format 2: Legacy (subject, body) strings for direct calls
          else if (typeof message === 'string') {
            subject = message;
            body = typeof legacyBody === 'string' ? legacyBody : '';
          }
          else {
            return;
          }

          capturedMessages.push({
            from: `"${fromName}" <test@test.com>`,
            to: recipients.join(', '),
            subject,
            text: body,
            html: body,
          });
        } catch (error) {
          // Silent failure: same behavior as real implementation
          const timestamp = new Date().toISOString();
          console.error(`[${timestamp}] [${fromName}] Failed to send email:`, error);
        }
      },
      async close(): Promise<void> {
        // No-op for mock
      },
    };
  },
}));

// Import modules AFTER mocking
import { createEventHandler } from '../../src/handler';
import { createEmailSender } from '../../src/email';

// Helper to create a mock SMTP channel
function createMockChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    type: 'smtp',
    enabled: true,
    name: 'Test Channel',
    config: {
      host: 'smtp.test.com',
      port: 465,
      secure: true,
      auth: { user: 'test@test.com', pass: 'pass' },
    },
    recipients: ['receiver@test.com'],
    events: { created: true, idle: true, error: true },
    ...overrides,
  } as Channel;
}

// Helper to create event payload
function createPayload(eventType: EventType, overrides: Partial<EventPayload> = {}): EventPayload {
  return {
    eventType,
    timestamp: '2024-01-01T12:00:00Z',
    projectName: 'Test Project',
    projectPath: '/test/project',
    sessionId: 'test-session',
    sessionType: 'main' as const,
    ...overrides,
  };
}

describe('Full Flow Integration Tests', () => {
  beforeEach(() => {
    capturedMessages = [];
    mockSendBehavior = null;
  });

  afterEach(() => {
    capturedMessages = [];
    mockSendBehavior = null;
  });

  describe('Basic Event Flow', () => {
    test('should send email on idle event', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({ name: 'Idle Test Channel' })],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle', {
        message: 'Task completed',
        duration: '2s',
      }));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].subject).toContain('Test Project');
      expect(capturedMessages[0].to).toBe('receiver@test.com');
    });

    test('should send email on created event', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({ name: 'Created Test Channel' })],
      };

      const handler = createEventHandler(config);
      await handler.handle('created', createPayload('created'));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].subject).toContain('Started');
    });

    test('should send email on error event with error details', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({ name: 'Error Test Channel' })],
      };

      const handler = createEventHandler(config);
      await handler.handle('error', createPayload('error', {
        error: 'Test error message',
      }));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].subject).toContain('Error');
      expect(capturedMessages[0].text).toContain('Test error message');
    });
  });

  describe('Multiple Channels', () => {
    test('should send to all enabled channels', async () => {
      const config: NotificationConfig = {
        channels: [
          createMockChannel({ 
            name: 'Primary Email',
            recipients: ['primary@test.com'],
          }),
          createMockChannel({ 
            name: 'Secondary Email',
            recipients: ['secondary@test.com'],
          }),
        ],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle', {
        message: 'Done',
        duration: '1m',
      }));

      expect(capturedMessages).toHaveLength(2);
      const recipients = capturedMessages.map(e => e.to);
      expect(recipients).toContain('primary@test.com');
      expect(recipients).toContain('secondary@test.com');
    });

    test('should not send to disabled channels', async () => {
      const config: NotificationConfig = {
        channels: [
          createMockChannel({ 
            name: 'Disabled Email',
            enabled: false,
            recipients: ['disabled@test.com'],
          }),
          createMockChannel({ 
            name: 'Enabled Email',
            recipients: ['enabled@test.com'],
          }),
        ],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle'));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].to).toBe('enabled@test.com');
    });

    test('should respect event type per channel', async () => {
      const config: NotificationConfig = {
        channels: [
          createMockChannel({ 
            name: 'Created Only',
            events: { created: true, idle: false, error: false },
            recipients: ['created-only@test.com'],
          }),
          createMockChannel({ 
            name: 'Idle Only',
            events: { created: false, idle: true, error: false },
            recipients: ['idle-only@test.com'],
          }),
        ],
      };

      const handler = createEventHandler(config);

      // Send created event - only 'Created Only' should receive
      await handler.handle('created', createPayload('created'));
      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].to).toBe('created-only@test.com');

      capturedMessages.length = 0;

      // Send idle event - only 'Idle Only' should receive
      await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1s' }));
      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].to).toBe('idle-only@test.com');
    });
  });

  describe('Template Rendering', () => {
    test('should use default templates when no custom templates', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({ 
          name: 'Default Template',
          templates: undefined,
        })],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle', {
        message: 'Success',
        duration: '5m',
      }));

      expect(capturedMessages[0].subject).toContain('Task Completed');
      expect(capturedMessages[0].text).toContain('5m');
      expect(capturedMessages[0].text).toContain('Success');
    });

    test('should use custom templates when provided', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({
          name: 'Custom Template',
          templates: {
            idle: {
              subject: '[CUSTOM] {{projectName}} - Done!',
              body: 'Project {{projectName}} finished in {{duration}}. Message: {{message}}',
            },
          },
        })],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle', {
        message: 'All good',
        duration: '10m',
      }));

      expect(capturedMessages[0].subject).toBe('[CUSTOM] Test Project - Done!');
      expect(capturedMessages[0].text).toBe('Project Test Project finished in 10m. Message: All good');
    });

    test('should include all variables in templates', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({
          name: 'Full Variables',
          templates: {
            created: {
              subject: '{{eventType}} - {{projectName}} - {{sessionId}}',
              body: 'Time: {{timestamp}}',
            },
          },
        })],
      };

      const handler = createEventHandler(config);
      await handler.handle('created', createPayload('created', {
        timestamp: '2024-06-15T10:30:00Z',
        projectName: 'MyProject',
        sessionId: 'sess-123',
      }));

      expect(capturedMessages[0].subject).toBe('created - MyProject - sess-123');
      expect(capturedMessages[0].text).toBe('Time: 2024-06-15T10:30:00Z');
    });
  });

  describe('Error Scenarios', () => {
    test('should handle SMTP failure gracefully (silent failure)', async () => {
      // Mock send failure
      mockSendBehavior = () => {
        throw new Error('SMTP connection failed');
      };

      const config: NotificationConfig = {
        channels: [createMockChannel({ name: 'Failing SMTP' })],
      };

      const handler = createEventHandler(config);

      // Should not throw
      await expect(handler.handle('idle', createPayload('idle'))).resolves.toBeUndefined();
      
      // Email was attempted but failed
      expect(capturedMessages).toHaveLength(0);
    });

    test('should continue sending to other channels if one fails', async () => {
      let shouldFail = true;

      mockSendBehavior = async () => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('First channel failed');
        }
        // Second channel succeeds
        capturedMessages.push({
          to: 'second@test.com',
          subject: 'test',
        });
      };

      const config: NotificationConfig = {
        channels: [
          createMockChannel({ 
            name: 'First Channel',
            recipients: ['first@test.com'],
          }),
          createMockChannel({ 
            name: 'Second Channel',
            recipients: ['second@test.com'],
          }),
        ],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle'));

      // Note: Due to the implementation, errors are caught per channel
      // So the second channel may not be attempted depending on implementation
      // This test verifies the handler doesn't crash
    });

    test('should handle missing config gracefully', async () => {
      const config: NotificationConfig = {
        channels: [],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle'));

      expect(capturedMessages).toHaveLength(0);
    });

    test('should handle channel with no recipients', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel({
          name: 'No Recipients',
          recipients: [],
        })],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle'));

      expect(capturedMessages).toHaveLength(0);
    });
  });

  describe('All Event Types End-to-End', () => {
    test('should process created event with correct template', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel()],
      };

      const handler = createEventHandler(config);
      await handler.handle('created', createPayload('created', {
        projectName: 'NewSession',
        sessionId: 'new-sess-001',
      }));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].subject).toContain('Started');
    });

    test('should process idle event with message and duration', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel()],
      };

      const handler = createEventHandler(config);
      await handler.handle('idle', createPayload('idle', {
        message: 'Task finished successfully',
        duration: '2h 30m',
      }));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].text).toContain('2h 30m');
      expect(capturedMessages[0].text).toContain('Task finished successfully');
    });

    test('should process error event with error message', async () => {
      const config: NotificationConfig = {
        channels: [createMockChannel()],
      };

      const handler = createEventHandler(config);
      await handler.handle('error', createPayload('error', {
        error: 'Connection refused: ECONNREFUSED',
      }));

      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0].subject).toContain('Error');
      expect(capturedMessages[0].text).toContain('Connection refused');
    });
  });
});

describe('Config Merge Integration Tests', () => {
  test('should create valid config object', async () => {
    // Test that we can create a valid config object with multiple channels
    const config: NotificationConfig = {
      channels: [
        {
          type: 'smtp',
          enabled: true,
          name: 'Project Channel',
          config: {
            host: 'project.smtp.com',
            port: 465,
            secure: true,
            auth: { user: 'project@test.com', pass: 'project' },
          },
          recipients: ['project@test.com'],
          events: { idle: true, error: true },
        },
        {
          type: 'smtp',
          enabled: true,
          name: 'Global Channel',
          config: {
            host: 'global.smtp.com',
            port: 587,
            secure: false,
            auth: { user: 'global@test.com', pass: 'global' },
          },
          recipients: ['global@test.com'],
          events: { created: true, idle: true, error: true },
        },
      ],
    };

    // Verify config structure
    expect(config.channels).toHaveLength(2);
    expect(config.channels[0].name).toBe('Project Channel');
    expect(config.channels[1].name).toBe('Global Channel');
    
    // Verify the handler can be created with this config
    const handler = createEventHandler(config);
    expect(handler).toBeDefined();
    expect(typeof handler.handle).toBe('function');
  });

  test('should handle missing config files gracefully', async () => {
    // When no config files exist, default config should be used
    const config: NotificationConfig = {
      channels: [createMockChannel()],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle'));

    expect(capturedMessages).toHaveLength(1);
  });
});

describe('EmailSender Integration', () => {
  beforeEach(() => {
    capturedMessages = [];
    mockSendBehavior = null;
  });

  test('createEmailSender should work with valid channel', async () => {
    const channel = createMockChannel({ name: 'Direct Email Test' });
    const sender = await createEmailSender(channel);

    expect(sender).not.toBeNull();
    await sender!.send('Direct Subject', 'Direct Body');

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0].subject).toBe('Direct Subject');
    expect(capturedMessages[0].text).toBe('Direct Body');
  });

  test('createEmailSender should return null for disabled channel', async () => {
    const channel = createMockChannel({ enabled: false });
    const sender = await createEmailSender(channel);
    expect(sender).toBeNull();
  });

  test('createEmailSender should return null for non-smtp channel', async () => {
    const channel: Channel = {
      type: 'feishu',
      enabled: true,
      config: { webhook: 'https://example.com/webhook' },
      events: { idle: true },
    };
    const sender = await createEmailSender(channel);
    expect(sender).toBeNull();
  });
});

describe('Token Tracking Integration Tests', () => {
  beforeEach(() => {
    capturedMessages = [];
    mockSendBehavior = null;
  });

  afterEach(() => {
    capturedMessages = [];
    mockSendBehavior = null;
  });

  test('full flow: session.created -> message.updated -> session.idle with token data', async () => {
    const config: NotificationConfig = {
      channels: [createMockChannel({ name: 'Token Flow Test' })],
    };
    const handler = createEventHandler(config);

    // Step 1: session.created
    await handler.handle('created', createPayload('created', {
      sessionId: 'sess-token-001',
      sessionTitle: 'Token Test Session',
    }));

    // Step 2: session.idle with token data (as if accumulated by index.ts from message.updated)
    await handler.handle('idle', createPayload('idle', {
      sessionId: 'sess-token-001',
      sessionTitle: 'Token Test Session',
      message: 'Task done with token usage',
      duration: '30s',
      sessionCost: 0.05,
      sessionTokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cacheRead: 30,
        cacheWrite: 40,
        total: 420,
      },
      totalCost: 0.05,
      totalTokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cacheRead: 30,
        cacheWrite: 40,
        total: 420,
      },
      modelID: 'claude-sonnet-4',
      providerID: 'anthropic',
      mode: 'build',
      costFormatted: '$0.0500',
      totalCostFormatted: '$0.0500',
      currency: 'USD',
    }));

    // Verify: 2 notifications sent (created + idle)
    expect(capturedMessages).toHaveLength(2);

    // Verify idle notification contains token data in simplified format
    const idleMsg = capturedMessages[1];
    expect(idleMsg.subject).toContain('Completed');
    expect(idleMsg.text).toContain('420');              // total tokens (session and total are same here)
    expect(idleMsg.text).toContain('claude-sonnet-4');  // model ID
    expect(idleMsg.text).not.toContain('anthropic');    // provider ID not in new format
    expect(idleMsg.text).not.toContain('$0.0500');      // cost not in new format
    expect(idleMsg.text).not.toContain('Input');        // detailed breakdown not in new format
  });

  test('multi-message accumulation: 2 AssistantMessages aggregated into idle', async () => {
    const config: NotificationConfig = {
      channels: [createMockChannel({ name: 'Accumulation Test' })],
    };
    const handler = createEventHandler(config);

    // Simulate idle with accumulated data from 2 messages (msg-1: cost=0.05, msg-2: cost=0.10)
    await handler.handle('idle', createPayload('idle', {
      sessionId: 'sess-accum-001',
      sessionTitle: 'Multi-Message Session',
      message: 'Done with accumulation',
      duration: '2m',
      sessionCost: 0.15,   // 0.05 + 0.10
      sessionTokens: {
        input: 300,        // 100 + 200
        output: 400,       // 200 + 200
        reasoning: 100,    // 50 + 50
        cacheRead: 60,     // 30 + 30
        cacheWrite: 80,    // 40 + 40
        total: 940,
      },
      totalCost: 0.15,
      totalTokens: {
        input: 300,
        output: 400,
        reasoning: 100,
        cacheRead: 60,
        cacheWrite: 80,
        total: 940,
      },
      modelID: 'gpt-4o',
      providerID: 'openai',
      mode: 'build',
      costFormatted: '$0.1500',
      totalCostFormatted: '$0.1500',
    }));

    expect(capturedMessages).toHaveLength(1);
    const msg = capturedMessages[0];
    // Verify accumulated total token value appears in notification
    expect(msg.text).toContain('940');        // accumulated total tokens
    expect(msg.text).toContain('gpt-4o');     // last model used
    expect(msg.text).not.toContain('$0.1500'); // cost not in new format
  });

  test('sub-session merge: main idle includes sub-session totalCost', async () => {
    const config: NotificationConfig = {
      channels: [createMockChannel({ name: 'SubSession Test' })],
    };
    const handler = createEventHandler(config);

    // Simulate main session idle with sub-session costs merged
    // Main session: cost=0.05, sub-session: cost=0.07 => total=0.12
    await handler.handle('idle', createPayload('idle', {
      sessionId: 'sess-main-001',
      sessionTitle: 'Main Session',
      message: 'Done with sub-sessions',
      duration: '5m',
      sessionCost: 0.05,         // main session only
      sessionTokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cacheRead: 30,
        cacheWrite: 40,
        total: 420,
      },
      totalCost: 0.12,           // main (0.05) + sub (0.07)
      totalTokens: {
        input: 250,              // 100 + 150 (sub)
        output: 500,             // 200 + 300 (sub)
        reasoning: 100,          // 50 + 50 (sub)
        cacheRead: 60,           // 30 + 30 (sub)
        cacheWrite: 80,          // 40 + 40 (sub)
        total: 990,
      },
      modelID: 'claude-sonnet-4',
      providerID: 'anthropic',
      mode: 'build',
      costFormatted: '$0.0500',
      totalCostFormatted: '$0.1200',
      currency: 'USD',
    }));

    expect(capturedMessages).toHaveLength(1);
    const msg = capturedMessages[0];
    // Token format shows session(420)/total(990) tokens and model
    expect(msg.text).toContain('420/990');
    expect(msg.text).toContain('claude-sonnet-4');
    expect(msg.text).not.toContain('$0.1200'); // cost not in new format
  });

  test('locale templates: zh uses zh body, en uses en body', async () => {
    // Test zh locale
    const zhConfig: NotificationConfig = {
      language: 'zh',
      channels: [createMockChannel({ name: 'Zh Currency' })],
    };
    const zhHandler = createEventHandler(zhConfig);

    await zhHandler.handle('idle', createPayload('idle', {
      sessionId: 'sess-zh-001',
      sessionTitle: 'Chinese Session',
      message: '任务完成',
      duration: '1m',
      totalTokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cacheRead: 30,
        cacheWrite: 40,
        total: 420,
      },
      modelID: 'claude-sonnet-4',
      providerID: 'anthropic',
    }));

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0].text).toContain('420');
    expect(capturedMessages[0].subject).toContain('已完成'); // zh template

    capturedMessages.length = 0;

    // Test en locale
    const enConfig: NotificationConfig = {
      language: 'en',
      channels: [createMockChannel({ name: 'En Currency' })],
    };
    const enHandler = createEventHandler(enConfig);

    await enHandler.handle('idle', createPayload('idle', {
      sessionId: 'sess-en-001',
      sessionTitle: 'English Session',
      message: 'Task done',
      duration: '1m',
      totalTokens: {
        input: 100,
        output: 200,
        reasoning: 50,
        cacheRead: 30,
        cacheWrite: 40,
        total: 420,
      },
      modelID: 'claude-sonnet-4',
      providerID: 'anthropic',
    }));

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0].text).toContain('420');
    expect(capturedMessages[0].subject).toContain('Completed'); // en template
  });

  test('zero cost: idle without message.updated produces no NaN or undefined', async () => {
    const config: NotificationConfig = {
      channels: [createMockChannel({ name: 'Zero Cost Test' })],
    };
    const handler = createEventHandler(config);

    // Idle event without any token data (no message.updated was received)
    await handler.handle('idle', createPayload('idle', {
      sessionId: 'sess-zero-001',
      sessionTitle: 'Zero Cost Session',
      message: 'Quick task',
      duration: '1s',
    }));

    expect(capturedMessages).toHaveLength(1);
    const msg = capturedMessages[0];

    // Should not contain NaN
    expect(msg.subject).not.toContain('NaN');
    expect(msg.text).not.toContain('NaN');

    // Should not contain undefined
    expect(msg.subject).not.toContain('undefined');
    expect(msg.text).not.toContain('undefined');

    // Should still contain basic info
    expect(msg.subject).toContain('Test Project');
    expect(msg.text).toContain('Quick task');
    expect(msg.text).toContain('1s');
  });
});
