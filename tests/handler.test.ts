import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { NotificationConfig, Channel, EventPayload, EventType } from '../src/types';

// Track sent emails for verification
interface SentEmail {
  channelName: string;
  subject: string;
  body: string;
}

const sentEmails: SentEmail[] = [];

// Mock the email module BEFORE importing handler
const emailMock = mock(() => ({
  send: mock(async (subject: string, body: string) => {
    sentEmails.push({ 
      channelName: 'mocked-channel', 
      subject, 
      body 
    });
  }),
}));

// Use mock.module to replace the email module
mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    // Return null for disabled channels
    if (channel.enabled === false) {
      return null;
    }
    // Return null for non-SMTP channels
    if (channel.type !== 'smtp') {
      return null;
    }
    // Return null if no recipients
    if (!channel.recipients || channel.recipients.length === 0) {
      return null;
    }
    // Return a mock sender that tracks emails
    return {
      send: async (subject: string, body: string) => {
        sentEmails.push({
          channelName: channel.name || 'unnamed',
          subject,
          body,
        });
      },
    };
  },
}));

// Import handler AFTER mocking email module
import { createEventHandler } from '../src/handler';

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
    projectName: 'test-project',
    sessionId: 'session-123',
    ...overrides,
  };
}

describe('createEventHandler', () => {
  beforeEach(() => {
    sentEmails.length = 0;
  });

  afterEach(() => {
    sentEmails.length = 0;
  });

  test('event triggers all enabled channels', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ name: 'Channel 1' }),
        createMockChannel({ name: 'Channel 2' }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));
    
    expect(sentEmails.length).toBe(2);
    expect(sentEmails.find(e => e.channelName === 'Channel 1')).toBeDefined();
    expect(sentEmails.find(e => e.channelName === 'Channel 2')).toBeDefined();
  });

  test('disabled channel does not receive notification', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ name: 'Disabled Channel', enabled: false }),
        createMockChannel({ name: 'Enabled Channel', enabled: true }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));
    
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].channelName).toBe('Enabled Channel');
  });

  test('channel with disabled event type does not send', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ 
          name: 'No Created Events',
          events: { created: false, idle: true, error: true }
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));
    
    // Should not send because created is disabled
    expect(sentEmails.length).toBe(0);
  });

  test('event data passed to template correctly', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Template Test',
          templates: {
            created: {
              subject: 'Project: {{projectName}} - Session: {{sessionId}}',
              body: 'Time: {{timestamp}} - Event: {{eventType}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    const payload = createPayload('created', {
      projectName: 'my-awesome-project',
      sessionId: 'sess-456',
      timestamp: '2024-06-15T10:30:00Z',
    });

    await handler.handle('created', payload);
    
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].subject).toBe('Project: my-awesome-project - Session: sess-456');
    expect(sentEmails[0].body).toBe('Time: 2024-06-15T10:30:00Z - Event: created');
  });

  test('multiple channels all receive notification', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ name: 'Primary' }),
        createMockChannel({ name: 'Secondary' }),
        createMockChannel({ name: 'Tertiary' }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { 
      message: 'Task done', 
      duration: '10m' 
    }));
    
    expect(sentEmails.length).toBe(3);
  });

  test('unsupported channel type is skipped silently', async () => {
    const feishuChannel: Channel = {
      type: 'feishu',
      enabled: true,
      name: 'Feishu Channel',
      config: { webhook: 'https://feishu.test.com/webhook' },
      events: { created: true, idle: true, error: true },
    };

    const dingtalkChannel: Channel = {
      type: 'dingtalk',
      enabled: true,
      name: 'DingTalk Channel',
      config: { webhook: 'https://dingtalk.test.com/webhook' },
      events: { created: true, idle: true, error: true },
    };

    const config: NotificationConfig = {
      channels: [
        feishuChannel,
        dingtalkChannel,
        createMockChannel({ name: 'SMTP Channel' }),
      ],
    };

    const handler = createEventHandler(config);
    
    // Should not throw when encountering unsupported channel types
    await expect(handler.handle('created', createPayload('created'))).resolves.toBeUndefined();
    
    // Only SMTP channel should have sent
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].channelName).toBe('SMTP Channel');
  });

  test('default templates are used when channel has no custom templates', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ 
          name: 'No Custom Templates',
          templates: undefined,
        }),
      ],
    };

    const handler = createEventHandler(config);
    
    // Test created uses default template
    await handler.handle('created', createPayload('created'));
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].subject).toContain('test-project');
    expect(sentEmails[0].body).toContain('2024-01-01T12:00:00Z');
    
    sentEmails.length = 0;
    
    // Test idle uses default template
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));
    expect(sentEmails[0].body).toContain('5m');
    expect(sentEmails[0].body).toContain('Done');
  });

  test('handles empty channels array', async () => {
    const config: NotificationConfig = {
      channels: [],
    };

    const handler = createEventHandler(config);
    await expect(handler.handle('created', createPayload('created'))).resolves.toBeUndefined();
    expect(sentEmails.length).toBe(0);
  });

  test('handles channel with no recipients gracefully', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ 
          name: 'No Recipients',
          recipients: [],
        }),
      ],
    };

    const handler = createEventHandler(config);
    await expect(handler.handle('created', createPayload('created'))).resolves.toBeUndefined();
    expect(sentEmails.length).toBe(0);
  });

  test('handles all three event types', async () => {
    const config: NotificationConfig = {
      channels: [createMockChannel({ name: 'All Events' })],
    };

    const handler = createEventHandler(config);

    // Test created event
    await handler.handle('created', createPayload('created'));
    expect(sentEmails.length).toBe(1);
    
    sentEmails.length = 0;
    
    // Test idle event
    await handler.handle('idle', createPayload('idle', { 
      message: 'Task completed successfully', 
      duration: '2h 30m' 
    }));
    expect(sentEmails.length).toBe(1);
    
    sentEmails.length = 0;
    
    // Test error event
    await handler.handle('error', createPayload('error', { 
      error: 'Connection timeout' 
    }));
    expect(sentEmails.length).toBe(1);
  });

  test('channel with partial event config sends enabled events only', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Partial Events',
          events: { 
            created: true, 
            // idle is undefined (should be treated as enabled)
            error: false 
          },
        }),
      ],
    };

    const handler = createEventHandler(config);

    // created is explicitly enabled
    await handler.handle('created', createPayload('created'));
    expect(sentEmails.length).toBe(1);
    
    sentEmails.length = 0;
    
    // idle is undefined, should still process
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1m' }));
    expect(sentEmails.length).toBe(1);
    
    sentEmails.length = 0;
    
    // error is explicitly disabled
    await handler.handle('error', createPayload('error', { error: 'Error' }));
    expect(sentEmails.length).toBe(0);
  });

  test('custom templates override defaults', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Custom Templates',
          templates: {
            created: {
              subject: 'Custom: {{projectName}} Started',
              body: 'Custom body for {{projectName}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));
    
    expect(sentEmails[0].subject).toBe('Custom: test-project Started');
    expect(sentEmails[0].body).toBe('Custom body for test-project');
  });

  // --- Multi-language template tests ---

  test('Chinese locale produces Chinese default templates', async () => {
    const config: NotificationConfig = {
      language: 'zh',
      channels: [
        createMockChannel({ name: 'Chinese Channel' }),
      ],
    };

    const handler = createEventHandler(config);

    // Test idle event - should use Chinese template
    await handler.handle('idle', createPayload('idle', { message: '完成', duration: '5m' }));
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].subject).toContain('任务已完成');
    expect(sentEmails[0].body).toContain('耗时');

    sentEmails.length = 0;

    // Test error event - should use Chinese template
    await handler.handle('error', createPayload('error', { error: '连接超时' }));
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].subject).toContain('任务出错');
    expect(sentEmails[0].body).toContain('错误信息');
  });

  test('English locale (default) produces English default templates', async () => {
    // Explicitly set English
    const config: NotificationConfig = {
      language: 'en',
      channels: [
        createMockChannel({ name: 'English Channel' }),
      ],
    };

    const handler = createEventHandler(config);

    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].subject).toContain('Task Completed');
    expect(sentEmails[0].body).toContain('Duration');
  });

  test('undefined language falls back to English', async () => {
    // No language field specified - should default to English
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ name: 'No Language Channel' }),
      ],
    };

    const handler = createEventHandler(config);

    await handler.handle('created', createPayload('created'));
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].subject).toContain('Task Started');
  });

  test('custom templates override locale defaults', async () => {
    const config: NotificationConfig = {
      language: 'zh',
      channels: [
        createMockChannel({
          name: 'Override Channel',
          templates: {
            idle: {
              subject: '[自定义] {{projectName}} 完成',
              body: '自定义内容: {{message}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: '测试' }));

    expect(sentEmails[0].subject).toBe('[自定义] test-project 完成');
    expect(sentEmails[0].body).toBe('自定义内容: 测试');
  });
});
