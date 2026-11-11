import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, SessionType } from '../src/types';

// Keep the tests away from the real data directory.
const testDataDir = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'ul-opencode-event-v1-test-'),
);
process.env.OPENCODE_DATA_DIR = testDataDir;

interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    if (channel.enabled === false) return null;
    if (channel.type !== 'smtp') return null;
    if (!channel.recipients || channel.recipients.length === 0) return null;
    return {
      send: async (message: unknown) => {
        const msg = message as { subject?: string; text?: string };
        if (msg?.subject && msg?.text) {
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

let configMock: { channels: Channel[]; timezone?: string; includeSessionTypes?: SessionType[]; projectName?: string } | null = null;

mock.module('../src/config', () => ({
  loadConfig: () => {
    if (configMock) return configMock;
    return { channels: [] };
  },
}));

import { createV1Plugin } from '../src/v1/plugin-v1';

function createMockChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    type: 'smtp',
    enabled: true,
    name: 'V1 Channel',
    config: { host: 'smtp.test.com', port: 465, secure: true, auth: { user: 'test@test.com', pass: 'pass' } },
    recipients: ['receiver@test.com'],
    events: { created: true, idle: true, error: true },
    ...overrides,
  } as Channel;
}

/** Minimal OpenCode 1.x plugin context. */
function createV1Ctx(directory = '/v1/project') {
  return {
    project: { id: 'v1-project', worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL('http://localhost:3000'),
    client: {
      tui: {
        showToast: async () => {},
      },
    },
    $: {},
  } as never;
}

describe('v1 plugin compatibility layer', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    configMock = null;
  });

  afterEach(() => {
    sentMessages.length = 0;
    configMock = null;
  });

  test('returns hooks with an event handler', async () => {
    configMock = { channels: [createMockChannel()] };
    const hooks = await createV1Plugin(createV1Ctx());

    expect(hooks).toBeDefined();
    expect(typeof hooks.event).toBe('function');
  });

  test('returns empty hooks when no channel is configured', async () => {
    configMock = { channels: [] };
    const hooks = await createV1Plugin(createV1Ctx());
    expect(hooks).toEqual({});
  });

  test('v1 session.created event triggers a notification', async () => {
    configMock = { channels: [createMockChannel({ name: 'V1 Created' })] };
    const hooks = await createV1Plugin(createV1Ctx());

    await hooks.event!({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 'v1-session-1',
            title: 'V1 Session',
            directory: '/v1/project',
            version: '1.18.31',
            time: { created: Date.now() - 5000 },
          },
        },
      },
    } as never);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('Started');
    expect(sentMessages[0].text).toContain('V1 Session');
  });

  test('v1 message.updated + session.idle carry token usage', async () => {
    configMock = { channels: [createMockChannel({ name: 'V1 Idle' })] };
    const hooks = await createV1Plugin(createV1Ctx());

    await hooks.event!({
      event: {
        type: 'session.created',
        properties: {
          info: { id: 'v1-session-2', title: 'Token Session', directory: '/v1/project', time: { created: Date.now() - 5000 } },
        },
      },
    } as never);
    sentMessages.length = 0;

    await hooks.event!({
      event: {
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg-1',
            sessionID: 'v1-session-2',
            role: 'assistant',
            cost: 0.05,
            modelID: 'gpt-4o',
            providerID: 'openai',
            mode: 'build',
            tokens: { input: 100, output: 200, reasoning: 50, cache: { read: 30, write: 40 } },
          },
        },
      },
    } as never);

    expect(sentMessages.length).toBe(0);

    await hooks.event!({
      event: { type: 'session.idle', properties: { sessionID: 'v1-session-2' } },
    } as never);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('Completed');
    expect(sentMessages[0].text).toContain('370'); // 100 + 200 + 30 + 40
    expect(sentMessages[0].text).toContain('gpt-4o');
  });

  test('v1 session.error triggers an error notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'V1 Error' })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const hooks = await createV1Plugin(createV1Ctx());

    await hooks.event!({
      event: {
        type: 'session.error',
        properties: { sessionID: 'v1-session-3', error: { message: 'V1 boom' } },
      },
    } as never);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('Error');
    expect(sentMessages[0].text).toContain('V1 boom');
  });

  test('v1 question.asked maps to the question notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'V1 Question', events: { question: true } })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const hooks = await createV1Plugin(createV1Ctx());

    await hooks.event!({
      event: {
        type: 'question.asked',
        properties: {
          sessionID: 'v1-session-4',
          questions: [{ header: 'Framework', question: 'Which one?', options: ['A', 'B'] }],
        },
      },
    } as never);

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toContain('Question');
    expect(sentMessages[0].text).toContain('Framework');
    expect(sentMessages[0].text).toContain('Which one?');
  });
});
