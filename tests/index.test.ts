import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, EventPayload, EventType } from '../src/types';

// Track sent emails for verification
interface SentEmail {
  channelName: string;
  subject: string;
  body: string;
}

const sentEmails: SentEmail[] = [];

// Mock the email module
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

// Mock the config module to provide test configuration
let configMock: { channels: Channel[] } | null = null;

mock.module('../src/config', () => ({
  loadConfig: () => {
    if (configMock) {
      return { channels: configMock.channels };
    }
    return { channels: [] };
  },
}));

// Import after mocking
import { NotificationPlugin } from '../src/index';

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

// Helper to create a mock event
function createMockEvent(type: string, properties: Record<string, unknown>): { type: string; properties: Record<string, unknown> } {
  return { type, properties };
}

describe('NotificationPlugin', () => {
  beforeEach(() => {
    sentEmails.length = 0;
    configMock = null;
  });

  afterEach(() => {
    sentEmails.length = 0;
    configMock = null;
  });

  test('plugin loads without error', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/test/directory',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);
    expect(hooks).toBeDefined();
    expect(hooks.event).toBeDefined();
  });

  test('plugin returns empty hooks when no channels configured', async () => {
    configMock = { channels: [] };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/test/directory',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);
    expect(hooks).toEqual({});
  });

  test('session.created event triggers full notification flow', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Created Test' })],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/my-project',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);
    
    // Create session.created event
    const sessionInfo = {
      id: 'session-123',
      projectID: 'test-project',
      directory: '/test/directory',
      title: 'Test Session',
      version: '1.0',
      time: { created: Date.now(), updated: Date.now() },
    };

    const event = createMockEvent('session.created', { info: sessionInfo });
    await hooks.event!({ event: event as any });

    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].channelName).toBe('Created Test');
    expect(sentEmails[0].subject).toContain('[OpenCode]');
    expect(sentEmails[0].subject).toContain('Started');
    expect(sentEmails[0].body).toContain('/my-project');
  });

  test('session.idle event triggers full notification flow', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Idle Test' })],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/my-project',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);

    // First create a session
    const sessionInfo = {
      id: 'session-456',
      projectID: 'test-project',
      directory: '/test/directory',
      title: 'Test Session',
      version: '1.0',
      time: { created: Date.now() - 60000, updated: Date.now() },
    };

    const createdEvent = createMockEvent('session.created', { info: sessionInfo });
    await hooks.event!({ event: createdEvent as any });

    // Clear sent emails before idle
    sentEmails.length = 0;

    // Now trigger idle event
    const idleEvent = createMockEvent('session.idle', { sessionID: 'session-456' });
    await hooks.event!({ event: idleEvent as any });

    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].channelName).toBe('Idle Test');
    expect(sentEmails[0].subject).toContain('Completed');
    expect(sentEmails[0].body).toContain('Task completed successfully');
  });

  test('session.error event triggers full notification flow', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Error Test' })],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/my-project',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);

    // Trigger error event
    const errorEvent = createMockEvent('session.error', {
      sessionID: 'session-789',
      error: { message: 'Test error occurred' },
    });
    await hooks.event!({ event: errorEvent as any });

    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].channelName).toBe('Error Test');
    expect(sentEmails[0].subject).toContain('Error');
    expect(sentEmails[0].body).toContain('Test error occurred');
  });

  test('unhandled event types are skipped', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/my-project',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);

    // Trigger an unhandled event type
    const unhandledEvent = createMockEvent('file.edited', { file: '/test/file.ts' });
    await hooks.event!({ event: unhandledEvent as any });

    // Should not send any emails
    expect(sentEmails.length).toBe(0);
  });

  test('multiple channels all receive notifications', async () => {
    configMock = {
      channels: [
        createMockChannel({ name: 'Primary' }),
        createMockChannel({ name: 'Secondary' }),
      ],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/my-project',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);

    const sessionInfo = {
      id: 'session-999',
      projectID: 'test-project',
      directory: '/test/directory',
      title: 'Test Session',
      version: '1.0',
      time: { created: Date.now(), updated: Date.now() },
    };

    const event = createMockEvent('session.created', { info: sessionInfo });
    await hooks.event!({ event: event as any });

    expect(sentEmails.length).toBe(2);
    expect(sentEmails[0].channelName).toBe('Primary');
    expect(sentEmails[1].channelName).toBe('Secondary');
  });

  test('session info is tracked for duration calculation', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Duration Test' })],
    };

    const ctx = {
      project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
      directory: '/my-project',
      worktree: '/test/worktree',
      serverUrl: new URL('http://localhost:3000'),
      client: {} as any,
      $: {} as any,
    };

    const hooks = await NotificationPlugin(ctx);

    // Create session with a known creation time
    const createdTime = Date.now() - 120000; // 2 minutes ago
    const sessionInfo = {
      id: 'session-duration',
      projectID: 'test-project',
      directory: '/test/directory',
      title: 'Test Session',
      version: '1.0',
      time: { created: createdTime, updated: Date.now() },
    };

    const createdEvent = createMockEvent('session.created', { info: sessionInfo });
    await hooks.event!({ event: createdEvent as any });

    // Clear and trigger idle
    sentEmails.length = 0;

    const idleEvent = createMockEvent('session.idle', { sessionID: 'session-duration' });
    await hooks.event!({ event: idleEvent as any });

    expect(sentEmails.length).toBe(1);
    // Should include duration in the body
    expect(sentEmails[0].body).toMatch(/\d+m/);
  });
});
