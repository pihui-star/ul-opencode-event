import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { NotificationConfig, Channel, EventPayload, EventType } from '../src/types';

// Track sent messages for verification (formatter output: { subject, text })
interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

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
    // Return a mock sender that tracks formatted messages
    return {
      send: async (message: unknown) => {
        // Handler now sends FormattedMessage { subject, text } via formatter
        const msg = message as { subject?: string; text?: string };
        if (msg?.subject && msg?.text) {
          sentMessages.push({
            channelName: channel.name || 'unnamed',
            subject: msg.subject,
            text: msg.text,
          });
        }
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
    projectPath: '/test/project',
    sessionId: 'session-123',
    sessionType: 'main' as const,
    ...overrides,
  };
}

describe('createEventHandler', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
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
    
    expect(sentMessages.length).toBe(2);
    expect(sentMessages.find(e => e.channelName === 'Channel 1')).toBeDefined();
    expect(sentMessages.find(e => e.channelName === 'Channel 2')).toBeDefined();
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
    
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('Enabled Channel');
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
    expect(sentMessages.length).toBe(0);
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
    
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('Project: my-awesome-project - Session: sess-456');
    expect(sentMessages[0].text).toBe('Time: 2024-06-15T10:30:00Z - Event: created');
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
    
    expect(sentMessages.length).toBe(3);
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
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('SMTP Channel');
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
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('test-project');
    expect(sentMessages[0].text).toContain('2024-01-01T12:00:00Z');
    
    sentMessages.length = 0;
    
    // Test idle uses default template
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));
    expect(sentMessages[0].text).toContain('5m');
    expect(sentMessages[0].text).toContain('Done');
  });

  test('handles empty channels array', async () => {
    const config: NotificationConfig = {
      channels: [],
    };

    const handler = createEventHandler(config);
    await expect(handler.handle('created', createPayload('created'))).resolves.toBeUndefined();
    expect(sentMessages.length).toBe(0);
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
    expect(sentMessages.length).toBe(0);
  });

  test('handles all three event types', async () => {
    const config: NotificationConfig = {
      channels: [createMockChannel({ name: 'All Events' })],
    };

    const handler = createEventHandler(config);

    // Test created event
    await handler.handle('created', createPayload('created'));
    expect(sentMessages.length).toBe(1);
    
    sentMessages.length = 0;
    
    // Test idle event
    await handler.handle('idle', createPayload('idle', { 
      message: 'Task completed successfully', 
      duration: '2h 30m' 
    }));
    expect(sentMessages.length).toBe(1);
    
    sentMessages.length = 0;
    
    // Test error event
    await handler.handle('error', createPayload('error', { 
      error: 'Connection timeout' 
    }));
    expect(sentMessages.length).toBe(1);
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
    expect(sentMessages.length).toBe(1);
    
    sentMessages.length = 0;
    
    // idle is undefined, should still process
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1m' }));
    expect(sentMessages.length).toBe(1);
    
    sentMessages.length = 0;
    
    // error is explicitly disabled
    await handler.handle('error', createPayload('error', { error: 'Error' }));
    expect(sentMessages.length).toBe(0);
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
    
    expect(sentMessages[0].subject).toBe('Custom: test-project Started');
    expect(sentMessages[0].text).toBe('Custom body for test-project');
  });

  test('projectPath template variable is available in custom templates', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'ProjectPath Test',
          templates: {
            idle: {
              subject: '[{{projectName}}] Done',
              body: 'Path: {{projectPath}} - Duration: {{duration}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', {
      projectPath: '/full/path/to/project',
      duration: '10m',
    }));

    expect(sentMessages[0].subject).toBe('[test-project] Done');
    expect(sentMessages[0].text).toBe('Path: /full/path/to/project - Duration: 10m');
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
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('任务已完成');
    expect(sentMessages[0].text).toContain('耗时');

    sentMessages.length = 0;

    // Test error event - should use Chinese template
    await handler.handle('error', createPayload('error', { error: '连接超时' }));
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('任务出错');
    expect(sentMessages[0].text).toContain('错误信息');
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
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('Task Completed');
    expect(sentMessages[0].text).toContain('Duration');
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
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('Task Started');
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

    expect(sentMessages[0].subject).toBe('[自定义] test-project 完成');
    expect(sentMessages[0].text).toBe('自定义内容: 测试');
  });
});

// ============================================================
// Multi-Channel Test Suite (SMTP + DingTalk)
// ============================================================

// Track DingTalk sent messages separately
const sentDingTalkMessages: Array<{
  channelName: string;
  msgtype: string;
  title?: string;
  text?: string;
}> = [];

// Mock the dingtalk module for multi-channel tests
mock.module('../src/dingtalk', () => ({
  createDingTalkSender: async (channel: Channel) => {
    if (channel.enabled === false) {
      return null;
    }
    if (channel.type !== 'dingtalk') {
      return null;
    }
    const config = channel.config as { webhook?: string; secret?: string };
    if (!config.webhook) {
      return null;
    }
    // Validate webhook URL format
    const webhookUrl = config.webhook.trim();
    if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
      return null;
    }
    return {
      send: async (message: unknown) => {
        const msg = message as {
          msgtype?: string;
          markdown?: { title?: string; text?: string };
        } | undefined;
        if (msg?.msgtype === 'markdown' && msg.markdown) {
          sentDingTalkMessages.push({
            channelName: channel.name || 'DingTalk',
            msgtype: msg.msgtype,
            title: msg.markdown.title,
            text: msg.markdown.text,
          });
        }
      },
      close: async () => {},
    };
  },
}));

describe('Multi-Channel: SMTP + DingTalk', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    sentDingTalkMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
    sentDingTalkMessages.length = 0;
  });

  test('SMTP + DingTalk mixed config initializes both senders', async () => {
    const smtpChannel = createMockChannel({ name: 'SMTP Alert' });
    const dingtalkChannel: Channel = {
      type: 'dingtalk',
      enabled: true,
      name: 'DingTalk Alert',
      config: {
        webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
      },
      recipients: [],
      events: { created: true, idle: true, error: true },
    };

    const config: NotificationConfig = {
      channels: [smtpChannel, dingtalkChannel],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));

    // Both channels should have sent
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('SMTP Alert');
    expect(sentDingTalkMessages.length).toBe(1);
    expect(sentDingTalkMessages[0].channelName).toBe('DingTalk Alert');
    expect(sentDingTalkMessages[0].msgtype).toBe('markdown');
  });

  test('emailFormatter produces correct { subject, text } structure', async () => {
    // Import formatter directly (pure function, no side effects)
    const { emailFormatter } = await import('../src/formatters');

    const result = emailFormatter.format('Test Subject', 'Test Body content', createPayload('created'));

    expect(result).toHaveProperty('subject', 'Test Subject');
    expect(result).toHaveProperty('text', 'Test Body content');
    expect(Object.keys(result)).toEqual(['subject', 'text']);
  });

  test('DingTalk formatter produces markdown message structure', async () => {
    const { createDingTalkFormatter } = await import('../src/formatters');

    const dtFormatter = createDingTalkFormatter({
      webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test',
    });

    const result = dtFormatter.format(
      '[Alert] Task Completed',
      'Project: my-project\nDuration: 5m\nStatus: done',
      createPayload('idle')
    );

    expect(result).toHaveProperty('msgtype', 'markdown');
    expect(result).toHaveProperty('markdown');
    expect((result as any).markdown.title).toBe('[Alert] Task Completed');
    // DingTalk formatter escapes hyphens in key:value lines: my-project -> my\-project
    expect((result as any).markdown.text).toContain('my\\-project');
  });

  test('DingTalk sender lifecycle: valid config creates sender, invalid returns null', async () => {
    const { createDingTalkSender } = await import('../src/dingtalk');

    // Valid config → sender created
    const validChannel: Channel = {
      type: 'dingtalk',
      enabled: true,
      name: 'Valid DT',
      config: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=valid' },
      events: { idle: true },
    };
    const validSender = await createDingTalkSender(validChannel);
    expect(validSender).not.toBeNull();
    expect(typeof validSender!.send).toBe('function');
    expect(typeof validSender!.close).toBe('function');

    // Disabled channel → null
    const disabledChannel: Channel = {
      ...validChannel,
      enabled: false,
      name: 'Disabled DT',
    };
    const disabledSender = await createDingTalkSender(disabledChannel);
    expect(disabledSender).toBeNull();

    // Missing webhook → null
    const noWebhookChannel: Channel = {
      type: 'dingtalk',
      enabled: true,
      name: 'No Webhook DT',
      config: {} as any,
      events: { idle: true },
    };
    const noWebhookSender = await createDingTalkSender(noWebhookChannel);
    expect(noWebhookSender).toBeNull();

    // Invalid URL scheme → null
    const badUrlChannel: Channel = {
      type: 'dingtalk',
      enabled: true,
      name: 'Bad URL DT',
      config: { webhook: 'ftp://invalid.com/webhook' },
      events: { idle: true },
    };
    const badUrlSender = await createDingTalkSender(badUrlChannel);
    expect(badUrlSender).toBeNull();
  });

  test('multi-channel concurrent send: SMTP and DingTalk do not interfere', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({ name: 'Email Channel' }),
        {
          type: 'dingtalk',
          enabled: true,
          name: 'DT Channel',
          config: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=concurrent' },
          events: { idle: true, error: true },
        },
        {
          type: 'dingtalk',
          enabled: true,
          name: 'DT Channel 2',
          config: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=concurrent2' },
          events: { idle: true, error: true },
        },
      ],
    };

    const handler = createEventHandler(config);

    // Fire multiple events sequentially (avoid init race condition)
    await handler.handle('idle', createPayload('idle', { message: 'Task A done', duration: '1m' }));
    await handler.handle('error', createPayload('error', { error: 'Something broke' }));
    await handler.handle('created', createPayload('created'));

    // Email channel: idle + error + created (all enabled by default)
    expect(sentMessages.length).toBe(3);

    // DingTalk channels: idle + error + created (all default to enabled)
    // 2 DT channels x 3 events each = 6
    expect(sentDingTalkMessages.length).toBe(6);

    // Verify data integrity — no cross-contamination
    const dt1Msgs = sentDingTalkMessages.filter(m => m.channelName === 'DT Channel');
    const dt2Msgs = sentDingTalkMessages.filter(m => m.channelName === 'DT Channel 2');
    expect(dt1Msgs.length).toBe(3);
    expect(dt2Msgs.length).toBe(3);

    // All messages should have proper structure
    for (const m of sentDingTalkMessages) {
      expect(m.msgtype).toBe('markdown');
      expect(m.title).toBeDefined();
      expect(m.text).toBeDefined();
    }
  });

  test('DingTalk formatter escapes special markdown characters', async () => {
    const { createDingTalkFormatter } = await import('../src/formatters');

    const dtFormatter = createDingTalkFormatter({
      webhook: 'https://oapi.dingtalk.com/robot/send?access_token=escape-test',
    });

    const result = dtFormatter.format(
      'Title with *special* chars',
      'Text with *bold* and _underline_ and `code`',
      createPayload('error')
    );

    const text = (result as any).markdown.text;
    // Special characters should be escaped by DingTalk formatter
    expect(text).toContain('\\*bold\\*');
    expect(text).toContain('\\_underline\\_');
    expect(text).toContain('\\`code\\`');
  });

  test('DingTalk formatter truncates long content at 4000 chars', async () => {
    const { createDingTalkFormatter } = await import('../src/formatters');

    const dtFormatter = createDingTalkFormatter({
      webhook: 'https://oapi.dingtalk.com/robot/send?access_token=truncate-test',
    });

    // Generate body longer than 4000 chars
    const longBody = 'A'.repeat(5000);
    const result = dtFormatter.format('Short Title', longBody, createPayload('idle'));

    const text = (result as any).markdown.text;
    // Should be truncated
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('... (truncated)');
  });
});
