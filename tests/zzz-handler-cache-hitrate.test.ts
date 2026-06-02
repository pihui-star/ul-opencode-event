import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { TokenBreakdown, NotificationConfig, Channel, EventPayload, EventType } from '../src/types';

// ---------------------------------------------------------------------------
// Handler integration test: verify 3 cache hit rate variables in templates
// ---------------------------------------------------------------------------

describe('handler cache hit rate variables', () => {
  // Track sent messages for verification
  interface SentMessage {
    channelName: string;
    subject: string;
    text: string;
  }

  const sentMessages: SentMessage[] = [];

  // Mock node:os
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
    }),
  }));

  mock.module('../src/updater', () => ({
    getCurrentVersion: () => '1.0.0-test',
  }));

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

  mock.module('../src/dingtalk', () => ({
    createDingTalkSender: async () => null,
    createDingTalkFormatter: () => ({
      format: (subject: string, body: string) => ({ subject, body }),
    }),
  }));

  mock.module('../src/feishu', () => ({
    createFeishuSender: async () => null,
    createFeishuFormatter: () => ({
      format: (subject: string, body: string) => ({ subject, body }),
    }),
  }));

  mock.module('../src/file', () => ({
    createFileSender: async () => null,
    createFileFormatter: () => ({
      format: (subject: string, body: string) => ({ subject, body }),
    }),
  }));

  mock.module('../src/recorder', () => ({
    recordEventVariables: () => {},
  }));

  mock.module('../src/logger', () => ({
    logger: {
      info: () => {},
      error: () => {},
      debug: () => {},
      warn: () => {},
    },
  }));

  // Import handler AFTER all mocks
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- dynamic import for mock setup
  const { createEventHandler } = require('../src/handler') as typeof import('../src/handler');

  function createMockChannel(overrides: Partial<Channel> = {}): Channel {
    return {
      type: 'smtp',
      enabled: true,
      name: 'Cache Hit Rate Test',
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

  function makeTokenBreakdown(overrides: Partial<TokenBreakdown> = {}): TokenBreakdown {
    return {
      input: 100,
      output: 50,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 150,
      ...overrides,
    };
  }

  beforeEach(() => {
    sentMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
  });

  it('renders sessionCacheHitRate, totalCacheHitRate, projectCacheHitRate in templates', async () => {
    const sessionTokens = makeTokenBreakdown({ cacheRead: 800, total: 1000 });
    const totalTokens = makeTokenBreakdown({ cacheRead: 500, total: 2000 });
    const projectTokens = makeTokenBreakdown({ cacheRead: 3000, total: 5000 });

    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Cache Rate Integration',
          templates: {
            idle: {
              subject: 'cache-test',
              body: [
                'session={{sessionCacheHitRate}}',
                'total={{totalCacheHitRate}}',
                'project={{projectCacheHitRate}}',
              ].join('|'),
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', {
      message: 'Done',
      duration: '5m',
      sessionTokens,
      totalTokens,
      projectTokens,
    }));

    expect(sentMessages.length).toBe(1);
    const text = sentMessages[0].text;

    // session: 800/1000 = 80.0%
    expect(text).toContain('session=80.0%');
    // total: 500/2000 = 25.0%
    expect(text).toContain('total=25.0%');
    // project: 3000/5000 = 60.0%
    expect(text).toContain('project=60.0%');
  });
});
