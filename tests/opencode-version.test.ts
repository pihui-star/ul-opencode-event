import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { NotificationConfig, Channel, EventPayload, EventType } from '../src/types';

// Track sent messages for verification
interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

// Mock node:os module
mock.module('node:os', () => ({
  default: {
    hostname: () => 'test-hostname',
    type: () => 'TestOS',
    platform: () => 'test-platform',
    release: () => '1.0.0-test',
    arch: () => 'x64',
    userInfo: () => ({ username: 'testuser' }),
    uptime: () => 90061,
    networkInterfaces: () => ({}),
  },
  hostname: () => 'test-hostname',
  type: () => 'TestOS',
  platform: () => 'test-platform',
  release: () => '1.0.0-test',
  arch: () => 'x64',
  userInfo: () => ({ username: 'testuser' }),
  uptime: () => 90061,
  networkInterfaces: () => ({}),
}));

// Mock updater module
mock.module('../src/updater', () => ({
  getCurrentVersion: () => '0.1.52',
}));

// Mock email module
mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    if (channel.enabled === false) return null;
    if (channel.type !== 'smtp') return null;
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
      close: async () => {},
    };
  },
}));

// Import handler AFTER all mocks
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

describe('opencodeVersion variable', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
  });

  test('opencodeVersion defaults to empty string when not set', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Version Test',
          templates: {
            created: {
              subject: 'opencodeVersion=[{{opencodeVersion}}]',
              body: 'test',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    // Do NOT call setOpenCodeVersion
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('opencodeVersion=[]');
  });

  test('opencodeVersion is set via setOpenCodeVersion', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Version Test',
          templates: {
            created: {
              subject: 'opencodeVersion={{opencodeVersion}}',
              body: 'test',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    handler.setOpenCodeVersion('1.2.3');
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('opencodeVersion=1.2.3');
  });

  test('setOpenCodeVersion can be called multiple times to update', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Version Update Test',
          templates: {
            created: {
              subject: 'v={{opencodeVersion}}',
              body: 'test',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    handler.setOpenCodeVersion('1.0.0');
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('v=1.0.0');

    // Update version and send again
    sentMessages.length = 0;
    handler.setOpenCodeVersion('2.0.0-beta');
    await handler.handle('created', createPayload('created', { sessionId: 'session-456' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('v=2.0.0-beta');
  });

  test('opencodeVersion coexists with other system variables', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Mixed Test',
          templates: {
            idle: {
              subject: '{{pluginVersion}}-oc{{opencodeVersion}}',
              body: 'host={{hostname}} user={{username}} oc={{opencodeVersion}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    handler.setOpenCodeVersion('3.5.0');
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1m' }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('0.1.52-oc3.5.0');
    expect(sentMessages[0].text).toBe('host=test-hostname user=testuser oc=3.5.0');
  });
});
