import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { NotificationConfig, Channel, EventPayload, EventType } from '../src/types';

// Track sent messages for verification
interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

// Mock node:os to control hostname and other system info
mock.module('node:os', () => ({
  default: {
    hostname: () => 'test-host',
    type: () => 'Linux',
    platform: () => 'linux',
    release: () => '5.15.0',
    arch: () => 'x64',
    userInfo: () => ({ username: 'testuser' }),
    uptime: () => 3600,
    networkInterfaces: () => ({
      lo: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }],
      eth0: [{ address: '192.168.1.100', internal: false, family: 'IPv4' }],
    }),
  },
  hostname: () => 'test-host',
  type: () => 'Linux',
  platform: () => 'linux',
  release: () => '5.15.0',
  arch: () => 'x64',
  userInfo: () => ({ username: 'testuser' }),
  uptime: () => 3600,
  networkInterfaces: () => ({
    lo: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }],
    eth0: [{ address: '192.168.1.100', internal: false, family: 'IPv4' }],
  }),
}));

// Mock updater to control pluginVersion
mock.module('../src/updater', () => ({
  getCurrentVersion: () => '1.0.0-test',
}));

// Mock email module
mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    if (channel.enabled === false || channel.type !== 'smtp') return null;
    if (!channel.recipients || channel.recipients.length === 0) return null;
    return {
      send: async (message: unknown) => {
        const msg = message as { subject?: string; text?: string };
        if (msg?.subject !== undefined && msg?.text !== undefined) {
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

// Mock dingtalk module
mock.module('../src/dingtalk', () => ({
  createDingTalkSender: async () => null,
  createDingTalkFormatter: () => ({
    format: (subject: string, body: string) => ({ subject, body }),
  }),
}));

// Mock feishu module
mock.module('../src/feishu', () => ({
  createFeishuSender: async () => null,
  createFeishuFormatter: () => ({
    format: (subject: string, body: string) => ({ subject, body }),
  }),
}));

// Mock file module
mock.module('../src/file', () => ({
  createFileSender: async () => null,
  createFileFormatter: () => ({
    format: (subject: string, body: string) => ({ subject, body }),
  }),
}));

// Mock recorder (avoid file I/O during tests)
mock.module('../src/recorder', () => ({
  recordEventVariables: () => {},
}));

// Mock logger
mock.module('../src/logger', () => ({
  logger: {
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: () => {},
  },
}));

// Import AFTER all mocks
import { createEventHandler } from '../src/handler';

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

describe('Custom Variables', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
  });

  test('basic custom variable values are available in templates', async () => {
    const config: NotificationConfig = {
      customVariables: {
        env: 'production',
        team: 'backend',
      },
      channels: [
        createMockChannel({
          name: 'Custom Var Test',
          templates: {
            idle: {
              subject: '[{{env}}] {{projectName}}',
              body: 'Team: {{team}}, Project: {{projectName}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('[production] test-project');
    expect(sentMessages[0].text).toBe('Team: backend, Project: test-project');
  });

  test('custom variables can reference built-in variables', async () => {
    const config: NotificationConfig = {
      customVariables: {
        serverLabel: '{{hostname}}-{{projectName}}',
        userTag: '{{username}}@{{hostname}}',
      },
      channels: [
        createMockChannel({
          name: 'Nested Ref Test',
          templates: {
            idle: {
              subject: '{{serverLabel}}',
              body: 'Tag: {{userTag}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('test-host-test-project');
    expect(sentMessages[0].text).toBe('Tag: testuser@test-host');
  });

  test('custom variables can override built-in variables', async () => {
    const config: NotificationConfig = {
      customVariables: {
        hostname: 'custom-host',
        username: 'custom-user',
      },
      channels: [
        createMockChannel({
          name: 'Override Test',
          templates: {
            idle: {
              subject: '{{hostname}}',
              body: 'User: {{username}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('custom-host');
    expect(sentMessages[0].text).toBe('User: custom-user');
  });

  test('referencing non-existent variable resolves to empty string', async () => {
    const config: NotificationConfig = {
      customVariables: {
        label: '{{nonExistentVar}}-test',
      },
      channels: [
        createMockChannel({
          name: 'Missing Var Test',
          templates: {
            idle: {
              subject: '{{label}}',
              body: 'done',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('-test');
  });

  test('no customVariables config does not break built-in variables', async () => {
    const config: NotificationConfig = {
      // No customVariables field
      channels: [
        createMockChannel({
          name: 'No Custom Vars Test',
          templates: {
            idle: {
              subject: '{{hostname}}-{{projectName}}',
              body: 'User: {{username}}, Version: {{pluginVersion}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('test-host-test-project');
    expect(sentMessages[0].text).toBe('User: testuser, Version: 1.0.0-test');
  });

  test('empty customVariables object does not break processing', async () => {
    const config: NotificationConfig = {
      customVariables: {},
      channels: [
        createMockChannel({
          name: 'Empty Custom Vars Test',
          templates: {
            idle: {
              subject: '{{hostname}}',
              body: 'OK',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '5m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('test-host');
  });

  test('custom variable referencing event payload variables resolves correctly', async () => {
    const config: NotificationConfig = {
      customVariables: {
        sessionInfo: '[{{sessionId}}] {{eventType}}',
      },
      channels: [
        createMockChannel({
          name: 'Event Ref Test',
          templates: {
            idle: {
              subject: '{{sessionInfo}}',
              body: 'done',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', {
      message: 'Done',
      duration: '5m',
      sessionId: 'sess-abc-999',
    }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('[sess-abc-999] idle');
  });
});
