import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, EventPayload, EventType, SessionType } from '../src/types';

// Track sent messages for verification (formatter output: { subject, text })
interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

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

// Mock the config module to provide test configuration
let configMock: { channels: Channel[]; timezone?: string; includeSessionTypes?: SessionType[]; projectName?: string; cost?: any } | null = null;

// Mock the updater module to prevent network calls and control version
mock.module('../src/updater', () => ({
  getCurrentVersion: () => '1.0.0',
  runAutoUpdate: () => Promise.resolve(),
}));

mock.module('../src/config', () => ({
  loadConfig: () => {
    if (configMock) {
      return {
        channels: configMock.channels,
        timezone: configMock.timezone,
        includeSessionTypes: configMock.includeSessionTypes,
        projectName: configMock.projectName,
        cost: configMock.cost,
      };
    }
    return { channels: [] };
  },
}));

// Import after mocking
import { NotificationPlugin } from '../src/index';

/** Access test helpers via globalThis (avoid module export to prevent OpenCode double-loading) */
function getTestHelpers() {
  return globalThis.__ul_opencode_event_test!;
}

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
    sentMessages.length = 0;
    configMock = null;
    getTestHelpers().payloads.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
    configMock = null;
    getTestHelpers().payloads.length = 0;
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

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('Created Test');
    expect(sentMessages[0].subject).toContain('[my-project]');
    expect(sentMessages[0].subject).toContain('Started');
    expect(sentMessages[0].text).toContain('Test Session');
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
    sentMessages.length = 0;

    // Now trigger idle event
    const idleEvent = createMockEvent('session.idle', { sessionID: 'session-456' });
    await hooks.event!({ event: idleEvent as any });

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('Idle Test');
    expect(sentMessages[0].subject).toContain('Completed');
    expect(sentMessages[0].text).toContain('Task completed successfully');
    expect(sentMessages[0].text).toContain('Test Session');
  });

  test('session.error event triggers full notification flow', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Error Test' })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
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

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('Error Test');
    expect(sentMessages[0].subject).toContain('Error');
    expect(sentMessages[0].text).toContain('Test error occurred');
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

    // Trigger a truly unhandled event type (not in our 7 new events + 3 original)
    const unhandledEvent = createMockEvent('some.unknown.event', { foo: 'bar' });
    await hooks.event!({ event: unhandledEvent as any });

    // Should not send any emails
    expect(sentMessages.length).toBe(0);
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

    expect(sentMessages.length).toBe(2);
    expect(sentMessages[0].channelName).toBe('Primary');
    expect(sentMessages[1].channelName).toBe('Secondary');
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
    sentMessages.length = 0;

    const idleEvent = createMockEvent('session.idle', { sessionID: 'session-duration' });
    await hooks.event!({ event: idleEvent as any });

    expect(sentMessages.length).toBe(1);
    // Should include duration in the body
    expect(sentMessages[0].text).toMatch(/\d+m/);
  });

  // ============================================================
  // formatTimestamp 测试组 (通过集成测试间接验证)
  // ============================================================
  describe('formatTimestamp - timezone conversion', () => {
    test('converts UTC to Shanghai time (Asia/Shanghai)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'TZ Test' })],
        timezone: 'Asia/Shanghai',
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
        id: 'session-tz',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Test Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      // Shanghai timezone output: en-CA locale produces "YYYY-MM-DD, HH:mm:ss" format
      // The comma between date and time confirms timezone conversion (ISO uses 'T')
      expect(sentMessages[0].text).toMatch(/\d{4}-\d{2}-\d{2}, \d{2}:\d{2}:\d{2}/);
    });

    test('timestamp remains ISO format when no timezone configured (backward compatible)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'No TZ Test' })],
        // timezone intentionally omitted
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
        id: 'session-notz',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Test Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      // Without timezone, timestamp stays as ISO string with 'T' separator
      expect(sentMessages[0].text).toContain('T');
    });

    test('invalid timezone falls back gracefully without crashing', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Bad TZ Test' })],
        timezone: 'Invalid/Timezone/Value',
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
        id: 'session-badtz',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Test Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      // Should NOT throw - invalid timezone gracefully falls back to ISO string
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      // Fallback to original ISO format
      expect(sentMessages[0].text).toContain('T');
    });

    test('UTC timezone produces valid formatted timestamp', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'UTC TZ Test' })],
        timezone: 'UTC',
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
        id: 'session-utc',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Test Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      // UTC format: YYYY-MM-DD, HH:mm:ss (en-CA locale with comma separator)
      expect(sentMessages[0].text).toMatch(/\d{4}-\d{2}-\d{2}, \d{2}:\d{2}:\d{2}/);
    });
  });

  // ============================================================
  // question.asked 事件测试组
  // ============================================================
  describe('question.asked event', () => {
    test('triggers notification with correct content (title, questionText, options)', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Question Test',
          events: { question: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/question-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create a session first so sessionInfo (with title) is available
      const sessionInfo = {
        id: 'q-session-1',
        projectID: 'test-project',
        directory: '/question-project',
        title: 'Test Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };
      const createdEvent = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: createdEvent as any });

      // Clear sent emails from session.created
      sentMessages.length = 0;

      const event = createMockEvent('question.asked', {
        sessionID: 'q-session-1',
        questions: [
          {
            header: 'Framework Choice',
            question: 'Which framework do you prefer?',
            options: [{ label: 'React' }, { label: 'Vue' }, { label: 'Svelte' }],
          },
        ],
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Question');
      expect(sentMessages[0].text).toContain('Framework Choice');
      expect(sentMessages[0].text).toContain('Which framework do you prefer?');
      expect(sentMessages[0].text).toContain('Test Session');
    });

    test('handles empty questions array gracefully', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Empty Question Test',
          events: { question: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/question-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('question.asked', {
        sessionID: 'q-session-2',
        questions: [],
      });
      // Should not crash - title and questionText will be undefined (rendered as empty)
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Question');
    });
  });

  // ============================================================
  // permission.updated 事件测试组
  // ============================================================
  describe('permission.updated event', () => {
    test('triggers notification with title and permissionType', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Permission Test',
          events: { permission: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/perm-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('permission.updated', {
        sessionID: 'p-session-1',
        title: 'Bash: npm install',
        type: 'bash',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Permission');
      expect(sentMessages[0].text).toContain('Bash: npm install');
      expect(sentMessages[0].text).toContain('bash');
    });

    test('handles missing type field gracefully', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'No Type Permission Test',
          events: { permission: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/perm-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('permission.updated', {
        sessionID: 'p-session-2',
        title: 'Some operation without type',
        // type field intentionally omitted
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Some operation without type');
      // permissionType renders as empty when undefined
      expect(sentMessages[0].text).toContain('()');
    });
  });

  // ============================================================
  // session.status 事件测试组
  // ============================================================
  describe('session.status event', () => {
    test('triggers notification with busy status', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Status Test',
          events: { status: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/status-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('session.status', {
        sessionID: 'st-session-1',
        status: { type: 'busy' },
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Status Change');
      expect(sentMessages[0].text).toContain('busy');
    });

    test('handles missing status object gracefully', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'No Status Test',
          events: { status: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/status-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('session.status', {
        sessionID: 'st-session-2',
        // status object intentionally omitted
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Status Change');
      // statusType renders as empty string
    });
  });

  // ============================================================
  // command.executed 事件测试组
  // ============================================================
  describe('command.executed event', () => {
    test('sends notification with command name and arguments', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Command Test',
          events: { command: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/cmd-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('command.executed', {
        name: 'npm',
        arguments: 'install --save-dev typescript',
        sessionID: 'cmd-session-1',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Command Executed');
      expect(sentMessages[0].text).toContain('npm');
      expect(sentMessages[0].text).toContain('install --save-dev typescript');
    });

    test('handles command with only name, no arguments', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'No Args Command Test',
          events: { command: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/cmd-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('command.executed', {
        name: 'git',
        // arguments field intentionally omitted
        sessionID: 'cmd-session-2',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('git');
    });
  });

  // ============================================================
  // file.edited 事件测试组
  // ============================================================
  describe('file.edited event', () => {
    test('sends notification with file path', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'File Edit Test',
          events: { fileEdited: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/file-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('file.edited', {
        file: 'src/index.ts',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('File Edited');
      expect(sentMessages[0].text).toContain('src/index.ts');
    });

    test('handles missing file field gracefully', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'No File Test',
          events: { fileEdited: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/file-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('file.edited', {
        // file field intentionally omitted
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('File Edited');
      // filePath renders as empty
    });
  });

  // ============================================================
  // todo.updated 事件测试组
  // ============================================================
  describe('todo.updated event', () => {
    test('sends notification with todo summary in [status] format', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Todo Test',
          events: { todo: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/todo-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('todo.updated', {
        sessionID: 'todo-session-1',
        todos: [
          { content: 'Fix critical bug', status: 'completed' },
          { content: 'Add new feature', status: 'in_progress' },
          { content: 'Write documentation', status: 'pending' },
        ],
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Todos Updated');
      expect(sentMessages[0].text).toContain('[completed] Fix critical bug');
      expect(sentMessages[0].text).toContain('[in_progress] Add new feature');
      expect(sentMessages[0].text).toContain('[pending] Write documentation');
    });

    test('handles empty todos array gracefully', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Empty Todo Test',
          events: { todo: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/todo-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('todo.updated', {
        sessionID: 'todo-session-2',
        todos: [],
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('Todos Updated');
      // todoSummary is empty string for empty array
    });
  });

  // ============================================================
  // 扩展事件默认关闭测试组
  // ============================================================
  describe('extended events disabled by default', () => {
    test('status/command/fileEdited/todo do not send when explicitly disabled', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Disabled Extended Test',
          events: {
            idle: true,
            error: true,
            status: false,
            command: false,
            fileEdited: false,
            todo: false,
          },
        })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/disabled-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Trigger each extended event - none should send email
      await hooks.event!({ event: createMockEvent('session.status', { sessionID: 's1', status: { type: 'busy' } }) as any });
      await hooks.event!({ event: createMockEvent('command.executed', { name: 'npm', arguments: 'install' }) as any });
      await hooks.event!({ event: createMockEvent('file.edited', { file: 'src/test.ts' }) as any });
      await hooks.event!({ event: createMockEvent('todo.updated', { sessionID: 't1', todos: [{ content: 'Test', status: 'pending' }] }) as any });

      expect(sentMessages.length).toBe(0);
    });
  });

  // ============================================================
  // 跨功能集成测试
  // ============================================================
  describe('cross-feature integration', () => {
    test('timezone configuration applies to all event types consistently', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Integration Test',
          events: {
            question: true,
            permission: true,
            status: true,
            command: true,
            fileEdited: true,
            todo: true,
          },
        })],
        timezone: 'Asia/Shanghai',
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'integ-project', worktree: '/integ/path', time: { created: Date.now() } },
        directory: '/integ-project',
        worktree: '/integ/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Trigger multiple event types
      await hooks.event!({ event: createMockEvent('question.asked', {
        sessionID: 'i1',
        questions: [{ header: 'Q?', question: 'Why?', options: [] }],
      }) as any });

      await hooks.event!({ event: createMockEvent('permission.updated', {
        sessionID: 'i2',
        title: 'Perm test',
        type: 'edit',
      }) as any });

      await hooks.event!({ event: createMockEvent('session.status', {
        sessionID: 'i3',
        status: { type: 'retry' },
      }) as any });

      await hooks.event!({ event: createMockEvent('command.executed', {
        name: 'cat',
        arguments: 'README.md',
        sessionID: 'i4',
      }) as any });

      await hooks.event!({ event: createMockEvent('file.edited', {
        file: 'src/handler.ts',
      }) as any });

      await hooks.event!({ event: createMockEvent('todo.updated', {
        sessionID: 'i5',
        todos: [{ content: 'Done', status: 'completed' }],
      }) as any });

      // All 6 events should produce emails
      expect(sentMessages.length).toBe(6);

      // Every email body should have Shanghai-formatted timestamp
      for (const email of sentMessages) {
        // Localized format: YYYY-MM-DD, HH:mm:ss (comma = Intl.DateTimeFormat, not ISO 'T')
        expect(email.text).toMatch(/\d{4}-\d{2}-\d{2}, \d{2}:\d{2}:\d{2}/);
      }
    });

    test('multiple event types can be triggered sequentially without interference', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Sequential Test',
          events: { question: true, permission: true, status: true, command: true, fileEdited: true, todo: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'seq-project', worktree: '/seq/path', time: { created: Date.now() } },
        directory: '/seq-project',
        worktree: '/seq/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Fire events sequentially - each should produce independent email
      await hooks.event!({ event: createMockEvent('question.asked', { sessionID: 'sq1', questions: [{ header: 'Q1', question: 'A?', options: [] }] }) as any });
      expect(sentMessages.length).toBe(1);

      await hooks.event!({ event: createMockEvent('permission.updated', { sessionID: 'sq2', title: 'P1', type: 'bash' }) as any });
      expect(sentMessages.length).toBe(2);

      await hooks.event!({ event: createMockEvent('command.executed', { name: 'ls', sessionID: 'sq3' }) as any });
      expect(sentMessages.length).toBe(3);

      await hooks.event!({ event: createMockEvent('file.edited', { file: 'a.ts' }) as any });
      expect(sentMessages.length).toBe(4);

      await hooks.event!({ event: createMockEvent('todo.updated', { sessionID: 'sq5', todos: [{ content: 'X', status: 'done' }] }) as any });
      expect(sentMessages.length).toBe(5);

      // Verify each email has correct subject
      expect(sentMessages[0].subject).toContain('Question');
      expect(sentMessages[1].subject).toContain('Permission');
      expect(sentMessages[2].subject).toContain('Command');
      expect(sentMessages[3].subject).toContain('File Edited');
      expect(sentMessages[4].subject).toContain('Todos Updated');
    });
  });

  // ============================================================
  // 补充边界测试（满足 >= 25 新增测试要求）
  // ============================================================
  describe('additional edge cases', () => {
    test('formatTimestamp with America/New_York timezone produces valid offset', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'NY TZ Test' })],
        timezone: 'America/New_York',
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/ny-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-ny',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Test Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      // NY timezone should also produce localized format with comma
      expect(sentMessages[0].text).toMatch(/\d{4}-\d{2}-\d{2}, \d{2}:\d{2}:\d{2}/);
    });

    test('question.asked with multiple questions uses first one', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Multi-Q Test',
          events: { question: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/q-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('question.asked', {
        sessionID: 'mq-session',
        questions: [
          { header: 'First Q', question: 'First answer?', options: [] },
          { header: 'Second Q', question: 'Second answer?', options: [] },
          { header: 'Third Q', question: 'Third answer?', options: [] },
        ],
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      // Should only use first question
      expect(sentMessages[0].text).toContain('First Q');
      expect(sentMessages[0].text).toContain('First answer?');
      // Should NOT contain second/third question content
      expect(sentMessages[0].text).not.toContain('Second Q');
    });

    test('permission.updated with edit type renders correctly', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Edit Perm Test',
          events: { permission: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/perm-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('permission.updated', {
        sessionID: 'ep-session',
        title: 'Edit: src/index.ts',
        type: 'edit',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Edit: src/index.ts');
      expect(sentMessages[0].text).toContain('edit');
    });

    test('session.status with retry status type', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Retry Status Test',
          events: { status: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/status-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('session.status', {
        sessionID: 'rs-session',
        status: { type: 'retry' },
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('retry');
    });

    test('command.executed with empty string arguments', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Empty Args Cmd Test',
          events: { command: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/cmd-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('command.executed', {
        name: 'echo',
        arguments: '',
        sessionID: 'ea-session',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('echo');
    });

    test('file.edited with nested file path', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Nested File Test',
          events: { fileEdited: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/file-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('file.edited', {
        file: 'src/components/deep/nested/file.tsx',
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('src/components/deep/nested/file.tsx');
    });

    test('todo.updated with single item produces correct summary format', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Single Todo Test',
          events: { todo: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/todo-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const event = createMockEvent('todo.updated', {
        sessionID: 'st-session',
        todos: [{ content: 'Only one task', status: 'in_progress' }],
      });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('[in_progress] Only one task');
      // Single item should not contain triple newline (only \n\n before Token line is expected)
      expect(sentMessages[0].text).not.toContain('\n\n\n');
    });
  });

  // ============================================================
  // session type filtering 测试组 (基于 sessionType 三态 API)
  // ============================================================
  describe('session type filtering', () => {
    test('main session events notify when whitelist includes main (default)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Main Session Test' })],
        // includeSessionTypes intentionally omitted → defaults to ['main']
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/main-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Main session: no parentID → sessionType='main'
      const sessionInfo = {
        id: 'session-main-001',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Main Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
    });

    test('sub-agent (parentID) events are filtered by default whitelist ["main"]', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'SubAgent Default Test' })],
        // includeSessionTypes omitted → defaults to ['main'] → subagent filtered
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/sub-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Sub-agent session: has parentID → sessionType='subagent'
      const sessionInfo = {
        id: 'session-sub-001',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub-Agent Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'ses_parent_001',
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(0);
    });

    test('includeSessionTypes: ["main", "subagent"] allows sub-agent notifications', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'SubAgent Enabled Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/sub-enabled-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-sub-002',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub-Agent Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'ses_parent_002',
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
    });

    test('includeSessionTypes: ["main"] explicitly filters sub-agent notifications', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'SubAgent Disabled Test' })],
        includeSessionTypes: ['main'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/sub-disabled-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-sub-003',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub-Agent Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'ses_parent_003',
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(0);
    });

    test('idle events for sub-agents are filtered by default whitelist', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Idle SubAgent Test' })],
        // defaults to ['main']
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/idle-sub-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-idle-sub',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub-Agent Idle Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
        parentID: 'ses_parent_idle',
      };

      const createdEvent = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: createdEvent as any });

      sentMessages.length = 0;
      const idleEvent = createMockEvent('session.idle', { sessionID: 'session-idle-sub' });
      await hooks.event!({ event: idleEvent as any });

      expect(sentMessages.length).toBe(0);
    });

    test('error events for sub-agents are filtered by default whitelist', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Error SubAgent Test' })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/error-sub-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-error-sub',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub-Agent Error Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'ses_parent_error',
      };
      const createdEvent = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: createdEvent as any });

      sentMessages.length = 0;
      const errorEvent = createMockEvent('session.error', {
        sessionID: 'session-error-sub',
        error: { message: 'Sub-agent error occurred' },
      });
      await hooks.event!({ event: errorEvent as any });

      expect(sentMessages.length).toBe(0);
    });

    test('question events for sub-agents are filtered by default whitelist', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Question SubAgent Test',
          events: { question: true },
        })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/question-sub-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-question-sub',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub-Agent Question Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'ses_parent_question',
      };
      const createdEvent = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: createdEvent as any });

      sentMessages.length = 0;
      const questionEvent = createMockEvent('question.asked', {
        sessionID: 'session-question-sub',
        questions: [{ header: 'Sub Question', question: 'What to do?', options: [] }],
      });
      await hooks.event!({ event: questionEvent as any });

      expect(sentMessages.length).toBe(0);
    });

    test('multiple channels all filter sub-agent events by default whitelist', async () => {
      configMock = {
        channels: [
          createMockChannel({ name: 'Primary SA' }),
          createMockChannel({ name: 'Secondary SA' }),
        ],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/multi-sa-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-multi-sa',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Multi-Channel Sub-Agent',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'ses_parent_multi',
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(0);
    });
  });

  // ============================================================
  // session type - unknown state 测试组
  // ============================================================
  describe('session type - unknown state', () => {
    test('sessionMap miss returns sessionType=unknown', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Unknown Miss Test',
          events: { idle: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/unknown-miss-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Send idle event WITHOUT first registering session.created → sessionMap miss
      const idleEvent = createMockEvent('session.idle', { sessionID: 'session-never-created' });
      await hooks.event!({ event: idleEvent as any });

      // Should send email because we whitelisted 'unknown'
      expect(sentMessages.length).toBe(1);
      // Verify the email body contains unknown-type content
      expect(sentMessages[0].text).toContain('Task completed successfully');
    });

    test('unknown events filtered by default whitelist ["main"]', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Unknown Filtered Test',
          events: { idle: true },
        })],
        // defaults to ['main'] — does NOT include 'unknown'
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/unknown-filtered-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Send idle without prior session.created → sessionMap miss → unknown
      const idleEvent = createMockEvent('session.idle', { sessionID: 'orphan-session' });
      await hooks.event!({ event: idleEvent as any });

      // Should be filtered: unknown not in default ['main'] whitelist
      expect(sentMessages.length).toBe(0);
    });

    test('unknown events allowed when whitelisted', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Unknown Allowed Test',
          events: { error: true },
        })],
        includeSessionTypes: ['main', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/unknown-allowed-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Send error without prior session.created → sessionMap miss → unknown → allowed
      const errorEvent = createMockEvent('session.error', {
        sessionID: 'orphan-error-session',
        error: { message: 'Orphan error' },
      });
      await hooks.event!({ event: errorEvent as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Orphan error');
    });

    test('file.edited produces sessionType=unknown (no sessionID)', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'File Unknown Test',
          events: { fileEdited: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/file-unknown-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // file.edited has no sessionID → sessionInfo=undefined → resolveSessionType returns 'unknown'
      const fileEvent = createMockEvent('file.edited', { file: 'src/unknown.ts' });
      await hooks.event!({ event: fileEvent as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('src/unknown.ts');
    });
  });

  // ============================================================
  // race condition - event before session.created 测试组
  // ============================================================
  describe('race condition - event before session.created', () => {
    test('non-created event before created returns unknown, then corrects after created', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Race Condition Test',
          events: { idle: true },
        })],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/race-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Step 1: Send idle BEFORE session.created → sessionMap miss → sessionType='unknown'
      const idleBeforeCreated = createMockEvent('session.idle', { sessionID: 'race-session-01' });
      await hooks.event!({ event: idleBeforeCreated as any });

      // Should still send (unknown is whitelisted) but as unknown type
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Task completed successfully');

      // Step 2: Register session.created (fills sessionMap)
      sentMessages.length = 0;
      const sessionInfo = {
        id: 'race-session-01',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Race Session',
        version: '1.0',
        time: { created: Date.now() - 120000, updated: Date.now() },
      };
      const createdEvent = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: createdEvent as any });

      // Step 3: Send idle again for same sessionID → sessionMap hit → sessionType='main'
      sentMessages.length = 0;
      const idleAfterCreated = createMockEvent('session.idle', { sessionID: 'race-session-01' });
      await hooks.event!({ event: idleAfterCreated as any });

      // Now correctly resolves as 'main' session
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Task completed successfully');
    });
  });

  // ============================================================
  // session type whitelist matrix 测试组
  // ============================================================
  describe('session type whitelist matrix', () => {
    const matrix: Array<{
      sessionType: SessionType;
      whitelist: SessionType[];
      expected: 'pass' | 'filtered';
      setup: (sessionId: string) => { event: { type: string; properties: Record<string, unknown> }; registerCreated?: boolean; sessionInfo?: Record<string, unknown> };
    }> = [
      {
        sessionType: 'main',
        whitelist: ['main'],
        expected: 'pass',
        setup: (sid) => ({
          event: createMockEvent('session.created', {
            info: { id: sid, projectID: 'p', directory: '/d', title: 'T', version: '1.0', time: { created: Date.now(), updated: Date.now() } },
          }),
          registerCreated: false,
        }),
      },
      {
        sessionType: 'subagent',
        whitelist: ['main'],
        expected: 'filtered',
        setup: (sid) => ({
          event: createMockEvent('session.created', {
            info: { id: sid, projectID: 'p', directory: '/d', title: 'T', version: '1.0', time: { created: Date.now(), updated: Date.now() }, parentID: 'parent-01' },
          }),
          registerCreated: false,
        }),
      },
      {
        sessionType: 'unknown',
        whitelist: ['main'],
        expected: 'filtered',
        setup: (_sid) => ({
          event: createMockEvent('session.idle', { sessionID: 'orphan-matrix-01' }),
          registerCreated: false,
        }),
      },
      {
        sessionType: 'main',
        whitelist: ['main', 'subagent'],
        expected: 'pass',
        setup: (sid) => ({
          event: createMockEvent('session.created', {
            info: { id: sid, projectID: 'p', directory: '/d', title: 'T', version: '1.0', time: { created: Date.now(), updated: Date.now() } },
          }),
          registerCreated: false,
        }),
      },
      {
        sessionType: 'subagent',
        whitelist: ['main', 'subagent'],
        expected: 'pass',
        setup: (sid) => ({
          event: createMockEvent('session.created', {
            info: { id: sid, projectID: 'p', directory: '/d', title: 'T', version: '1.0', time: { created: Date.now(), updated: Date.now() }, parentID: 'parent-02' },
          }),
          registerCreated: false,
        }),
      },
      {
        sessionType: 'unknown',
        whitelist: ['main', 'subagent', 'unknown'],
        expected: 'pass',
        setup: (_sid) => ({
          event: createMockEvent('session.idle', { sessionID: 'orphan-matrix-02' }),
          registerCreated: false,
        }),
      },
    ];

    for (const { sessionType, whitelist, expected, setup } of matrix) {
      test(`sessionType=${sessionType} with whitelist=[${whitelist}] should ${expected}`, async () => {
        configMock = {
          channels: [createMockChannel({
            name: `Matrix ${sessionType}-${whitelist.join(',')}`,
            events: { created: true, idle: true },
          })],
          includeSessionTypes: whitelist,
        };

        const ctx = {
          project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
          directory: `/matrix-${sessionType}`,
          worktree: '/test/worktree',
          serverUrl: new URL('http://localhost:3000'),
          client: {} as any,
          $: {} as any,
        };

        const hooks = await NotificationPlugin(ctx);
        const sessionId = `matrix-${sessionType}-${Date.now()}`;
        const { event } = setup(sessionId);

        await hooks.event!({ event: event as any });

        if (expected === 'pass') {
          expect(sentMessages.length).toBeGreaterThanOrEqual(1);
        } else {
          expect(sentMessages.length).toBe(0);
        }
      });
    }
  });

  // ============================================================
  // projectName config 测试组
  // ============================================================
  describe('projectName config', () => {
    test('uses config.projectName in subject when set', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'ProjectName Test' })],
        projectName: 'MyCustomName',
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/actual/project/dir',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-pn-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'PN Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('[MyCustomName]');
      expect(sentMessages[0].subject).toContain('Started');
    });

    test('falls back to path.basename(ctx.directory) when projectName not configured', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Fallback Name Test' })],
        // projectName intentionally omitted
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/fallback-project-dir',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'session-fb-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Fallback Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].subject).toContain('[fallback-project-dir]');
      expect(sentMessages[0].subject).toContain('Started');
    });
  });

  // ============================================================
  // session.updated event 测试组
  // ============================================================
  describe('session.updated event', () => {
    test('session.updated refreshes title - idle carries new title', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Updated Title Test',
          events: { idle: true },
        })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/updated-title-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);
      const sessionId = 'updated-title-session-01';

      // Step 1: session.created with old title
      const createdEvent = createMockEvent('session.created', {
        info: {
          id: sessionId,
          projectID: 'p1',
          directory: '/d1',
          title: 'Old Title',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      });
      await hooks.event!({ event: createdEvent as any });
      sentMessages.length = 0; // clear created notification

      // Step 2: session.updated with new title (same session ID)
      const updatedEvent = createMockEvent('session.updated', {
        info: {
          id: sessionId,
          projectID: 'p1',
          directory: '/d1',
          title: 'New Title',
          version: '1.1',
          time: { created: Date.now() - 1000, updated: Date.now() },
        },
      });
      await hooks.event!({ event: updatedEvent as any });

      // Step 3: session.idle - should carry the refreshed title
      const idleEvent = createMockEvent('session.idle', { sessionID: sessionId });
      await hooks.event!({ event: idleEvent as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('New Title');
      expect(sentMessages[0].text).not.toContain('Old Title');
    });

    test('session.updated does not produce any notification', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Updated No Notify Test',
          events: { idle: true },
        })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/updated-no-notify-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Only trigger session.updated, no created/idle
      const updatedEvent = createMockEvent('session.updated', {
        info: {
          id: 'updated-no-notify-session-01',
          projectID: 'p1',
          directory: '/d1',
          title: 'Just Updated',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      });
      await hooks.event!({ event: updatedEvent as any });

      expect(sentMessages.length).toBe(0);
    });

    test('session.updated before session.created - created overwrites', async () => {
      configMock = {
        channels: [createMockChannel({
          name: 'Updated Before Created Test',
          events: { idle: true },
        })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/updated-before-created-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);
      const sessionId = 'updated-before-created-session-01';

      // Step 1: session.updated arrives BEFORE session.created
      const updatedEvent = createMockEvent('session.updated', {
        info: {
          id: sessionId,
          projectID: 'p1',
          directory: '/d1',
          title: 'Pre-created Title',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      });
      await hooks.event!({ event: updatedEvent as any });

      // Step 2: session.created overwrites with official title
      const createdEvent = createMockEvent('session.created', {
        info: {
          id: sessionId,
          projectID: 'p1',
          directory: '/d1',
          title: 'Official Title',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      });
      await hooks.event!({ event: createdEvent as any });
      sentMessages.length = 0; // clear created notification

      // Step 3: session.idle should contain "Official Title" (created wins)
      const idleEvent = createMockEvent('session.idle', { sessionID: sessionId });
      await hooks.event!({ event: idleEvent as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('Official Title');
      expect(sentMessages[0].text).not.toContain('Pre-created Title');
    });

    test('session.updated preserves sub-agent parentID for filtering', async () => {
      // Part A: default whitelist ['main'] filters out subagent
      configMock = {
        channels: [createMockChannel({
          name: 'Updated Subagent Filter Test',
          events: { idle: true },
        })],
        includeSessionTypes: ['main'], // default, subagent NOT included
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/updated-subagent-filter-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);
      const sessionId = 'updated-subagent-session-01';

      // session.created with parentID (sub-agent)
      const createdEvent = createMockEvent('session.created', {
        info: {
          id: sessionId,
          projectID: 'p1',
          directory: '/d1',
          title: 'SubAgent Task',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
          parentID: 'parent-main-01',
        },
      });
      await hooks.event!({ event: createdEvent as any });
      sentMessages.length = 0;

      // session.updated still has parentID
      const updatedEvent = createMockEvent('session.updated', {
        info: {
          id: sessionId,
          projectID: 'p1',
          directory: '/d1',
          title: 'SubAgent Task Updated',
          version: '1.1',
          time: { created: Date.now(), updated: Date.now() },
          parentID: 'parent-main-01',
        },
      });
      await hooks.event!({ event: updatedEvent as any });

      // session.idle → filtered by whitelist (subagent not in ['main'])
      const idleEvent = createMockEvent('session.idle', { sessionID: sessionId });
      await hooks.event!({ event: idleEvent as any });

      expect(sentMessages.length).toBe(0);

      // Bonus: with includeSessionTypes including subagent, notification should arrive
      sentMessages.length = 0;
      configMock = {
        channels: [createMockChannel({
          name: 'Updated Subagent Allowed Test',
          events: { idle: true },
        })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const hooks2 = await NotificationPlugin(ctx);

      const createdEvent2 = createMockEvent('session.created', {
        info: {
          id: 'updated-subagent-session-02',
          projectID: 'p1',
          directory: '/d1',
          title: 'SubAgent Task 2',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
          parentID: 'parent-main-02',
        },
      });
      await hooks2.event!({ event: createdEvent2 as any });
      sentMessages.length = 0;

      const updatedEvent2 = createMockEvent('session.updated', {
        info: {
          id: 'updated-subagent-session-02',
          projectID: 'p1',
          directory: '/d1',
          title: 'SubAgent Task 2 Updated',
          version: '1.1',
          time: { created: Date.now(), updated: Date.now() },
          parentID: 'parent-main-02',
        },
      });
      await hooks2.event!({ event: updatedEvent2 as any });

      const idleEvent2 = createMockEvent('session.idle', { sessionID: 'updated-subagent-session-02' });
      await hooks2.event!({ event: idleEvent2 as any });

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('SubAgent Task 2 Updated');
    });
  });

  // ============================================================
  // Toast 通知测试组
  // ============================================================
  describe('toast notifications', () => {
    // Helper to create ctx with toast spy
    function createCtxWithToast(overrides: Record<string, unknown> = {}) {
      const showToast = mock(() => Promise.resolve());
      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/toast-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {
          tui: { showToast },
        },
        $: {} as any,
        ...overrides,
      };
      return { ctx, showToast };
    }

    // Reset module-level flags before each toast test
    beforeEach(() => {
      getTestHelpers().resetFlags();
    });

    afterEach(() => {
      delete process.env.OPENCODE_CLI_RUN_MODE;
    });

    test('shows startup toast on first session.created', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Toast Startup Test' })],
      };

      const { ctx, showToast } = createCtxWithToast();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'toast-session-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Toast Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const event = createMockEvent('session.created', { info: sessionInfo });
      await hooks.event!({ event: event as any });

      // Wait for setTimeout(0) to fire
      await new Promise(r => setTimeout(r, 10));

      expect(showToast).toHaveBeenCalled();
      const calls = showToast.mock.calls;
      const startupCall = calls.find((c: any[]) => c[0]?.body?.variant === 'success');
      expect(startupCall).toBeDefined();
      expect(startupCall[0].body.title).toContain('ul-opencode-event');
      expect(startupCall[0].body.message).toContain('1 channel');
      expect(startupCall[0].body.message).toContain('smtp');
    });

    test('does not show startup toast twice', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Toast Twice Test' })],
      };

      const { ctx, showToast } = createCtxWithToast();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo1 = {
        id: 'toast-session-2a',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'First Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      const sessionInfo2 = {
        id: 'toast-session-2b',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Second Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo1 }) as any });
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo2 }) as any });

      await new Promise(r => setTimeout(r, 10));

      // Only ONE startup toast (variant=success), not two
      const startupCalls = showToast.mock.calls.filter((c: any[]) => c[0]?.body?.variant === 'success');
      expect(startupCalls.length).toBe(1);
    });

    test('shows error toast when loadConfig fails', async () => {
      // Override configMock to throw for this test
      mock.module('../src/config', () => ({
        loadConfig: () => {
          throw new Error('Config file not found: ENOENT');
        },
      }));

      // Re-import to pick up the new mock
      const { NotificationPlugin: FreshPlugin } = await import('../src/index');
      globalThis.__ul_opencode_event_test!.resetFlags();

      const { ctx, showToast } = createCtxWithToast();
      const hooks = await FreshPlugin(ctx);

      await new Promise(r => setTimeout(r, 10));

      expect(showToast).toHaveBeenCalled();
      const errorCall = showToast.mock.calls.find((c: any[]) => c[0]?.body?.variant === 'error');
      expect(errorCall).toBeDefined();
      expect(errorCall[0].body.title).toContain('Error');
      expect(errorCall[0].body.message).toContain('日志');

      // Restore original config mock (must reference live configMock variable)
      mock.module('../src/config', () => ({
        loadConfig: () => {
          if (configMock) {
            return {
              channels: configMock.channels,
              timezone: configMock.timezone,
              includeSessionTypes: configMock.includeSessionTypes,
              projectName: configMock.projectName,
              cost: configMock.cost,
            };
          }
          return { channels: [] };
        },
      }));
    });

    test('shows warning toast when no channels configured', async () => {
      configMock = { channels: [] };

      const { ctx, showToast } = createCtxWithToast();
      const hooks = await NotificationPlugin(ctx);

      await new Promise(r => setTimeout(r, 10));

      expect(showToast).toHaveBeenCalled();
      const warningCall = showToast.mock.calls.find((c: any[]) => c[0]?.body?.variant === 'warning');
      expect(warningCall).toBeDefined();
      expect(warningCall[0].body.message).toContain('通道');
    });

    test('skips startup toast in CLI mode', async () => {
      process.env.OPENCODE_CLI_RUN_MODE = 'true';
      configMock = {
        channels: [createMockChannel({ name: 'CLI Toast Test' })],
      };

      const { ctx, showToast } = createCtxWithToast();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'cli-toast-session',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'CLI Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };

      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      await new Promise(r => setTimeout(r, 10));

      // No startup toast (success variant) should be shown
      const startupCalls = showToast.mock.calls.filter((c: any[]) =>
        c[0]?.body?.variant === 'success' && c[0]?.body?.title?.includes('ul-opencode-event'),
      );
      expect(startupCalls.length).toBe(0);
    });

    test('skips startup toast for sub-sessions', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Sub Toast Test' })],
      };

      const { ctx, showToast } = createCtxWithToast();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'sub-toast-session',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub Session',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
        parentID: 'parent-session-001',
      };

      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      await new Promise(r => setTimeout(r, 10));

      // No startup toast (success variant) for sub-sessions
      const startupCalls = showToast.mock.calls.filter((c: any[]) =>
        c[0]?.body?.variant === 'success' && c[0]?.body?.title?.includes('ul-opencode-event'),
      );
      expect(startupCalls.length).toBe(0);
    });
  });

  // ============================================================
  // message.updated - token 数据累积 测试组
  // ============================================================
  describe('message.updated - token accumulation', () => {
    // Helper: create a mock assistant message.updated event
    function createMockAssistantMessage(overrides: {
      id: string;
      sessionID: string;
      cost?: number;
      tokens?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
      modelID?: string;
      providerID?: string;
      mode?: string;
    }) {
      return createMockEvent('message.updated', {
        info: {
          id: overrides.id,
          sessionID: overrides.sessionID,
          role: 'assistant',
          time: { created: Date.now() },
          cost: overrides.cost ?? 0,
          tokens: {
            input: overrides.tokens?.input ?? 0,
            output: overrides.tokens?.output ?? 0,
            reasoning: overrides.tokens?.reasoning ?? 0,
            cache: {
              read: overrides.tokens?.cacheRead ?? 0,
              write: overrides.tokens?.cacheWrite ?? 0,
            },
          },
          modelID: overrides.modelID ?? 'test-model',
          providerID: overrides.providerID ?? 'test-provider',
          mode: overrides.mode ?? 'build',
          parentID: '',
          path: { cwd: '/', root: '/' },
        },
      });
    }

    // Helper: create a mock user message.updated event
    function createMockUserMessage(id: string, sessionID: string) {
      return createMockEvent('message.updated', {
        info: {
          id,
          sessionID,
          role: 'user',
          time: { created: Date.now() },
          parentID: '',
          path: { cwd: '/', root: '/' },
        },
      });
    }

    // Helper: create standard ctx
    function createTestCtx(overrides: Record<string, unknown> = {}) {
      return {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
        ...overrides,
      };
    }

    test('single AssistantMessage token data is correctly accumulated in sessionCost/sessionTokens', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Accum Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      // Create session
      const sessionInfo = {
        id: 'token-session-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Token Test Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // Send assistant message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'msg-1',
          sessionID: 'token-session-1',
          cost: 0.05,
          tokens: { input: 100, output: 200, reasoning: 50, cacheRead: 30, cacheWrite: 10 },
          modelID: 'claude-sonnet-4',
          providerID: 'anthropic',
          mode: 'build',
        }) as any,
      });

      // Trigger idle - verify token data in payload
      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-session-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      expect(payload.sessionCost).toBe(0.05);
      expect(payload.sessionTokens).toBeDefined();
      expect(payload.sessionTokens!.input).toBe(100);
      expect(payload.sessionTokens!.output).toBe(200);
      expect(payload.sessionTokens!.reasoning).toBe(50);
      expect(payload.sessionTokens!.cacheRead).toBe(30);
      expect(payload.sessionTokens!.cacheWrite).toBe(10);
      expect(payload.modelID).toBe('claude-sonnet-4');
      expect(payload.providerID).toBe('anthropic');
      expect(payload.mode).toBe('build');
    });

    test('same message.id updated multiple times does not duplicate cost (overwrites instead)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Dedup Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-session-2',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Dedup Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // First update for msg-1 with cost 0.03
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'msg-dup-1',
          sessionID: 'token-session-2',
          cost: 0.03,
          tokens: { input: 50, output: 100 },
        }) as any,
      });

      // Second update for same msg-1 with cost 0.05 (overwrites)
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'msg-dup-1',
          sessionID: 'token-session-2',
          cost: 0.05,
          tokens: { input: 80, output: 150 },
        }) as any,
      });

      // Trigger idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-session-2' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      // Should have 0.05 (not 0.08)
      expect(getTestHelpers().payloads[0].sessionCost).toBe(0.05);
      expect(getTestHelpers().payloads[0].sessionTokens!.input).toBe(80);
      expect(getTestHelpers().payloads[0].sessionTokens!.output).toBe(150);
    });

    test('different message.ids in same session accumulate costs', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token MultiMsg Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-session-3',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Multi Message Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // First message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'msg-multi-1',
          sessionID: 'token-session-3',
          cost: 0.03,
          tokens: { input: 50, output: 100 },
        }) as any,
      });

      // Second message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'msg-multi-2',
          sessionID: 'token-session-3',
          cost: 0.04,
          tokens: { input: 60, output: 120 },
        }) as any,
      });

      // Trigger idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-session-3' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      // Should have 0.07 (0.03 + 0.04)
      expect(getTestHelpers().payloads[0].sessionCost).toBeCloseTo(0.07, 10);
      expect(getTestHelpers().payloads[0].sessionTokens!.input).toBe(60);
      expect(getTestHelpers().payloads[0].sessionTokens!.output).toBe(120);
    });

    test('UserMessage is silently skipped (role !== assistant)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token UserMsg Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-session-4',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'User Msg Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // User message - should be skipped
      await hooks.event!({
        event: createMockUserMessage('user-msg-1', 'token-session-4') as any,
      });

      // Assistant message - should be tracked
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'asst-msg-1',
          sessionID: 'token-session-4',
          cost: 0.05,
          tokens: { input: 100, output: 200 },
        }) as any,
      });

      // Trigger idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-session-4' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      // Should have 0.05 (user message did not affect)
      expect(getTestHelpers().payloads[0].sessionCost).toBe(0.05);
    });

    test('sub-session token data merges into totalCost/totalTokens', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token SubAgg Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      // Main session
      const mainSession = {
        id: 'token-main-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Main Session',
        version: '1.0',
        time: { created: Date.now() - 120000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: mainSession }) as any });
      getTestHelpers().payloads.length = 0;

      // Sub session
      const subSession = {
        id: 'token-sub-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Sub Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
        parentID: 'token-main-1',
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: subSession }) as any });

      // Sub session message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'sub-msg-1',
          sessionID: 'token-sub-1',
          cost: 0.03,
          tokens: { input: 50, output: 100 },
        }) as any,
      });

      // Main session message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'main-msg-1',
          sessionID: 'token-main-1',
          cost: 0.05,
          tokens: { input: 100, output: 200 },
        }) as any,
      });

      // Trigger main session idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-main-1' });
      await hooks.event!({ event: idleEvent as any });

      // Should have at least 1 payload (the idle)
      expect(getTestHelpers().payloads.length).toBeGreaterThanOrEqual(1);
      const idlePayload = getTestHelpers().payloads.find(p => p.eventType === 'idle' && p.sessionId === 'token-main-1');
      expect(idlePayload).toBeDefined();
      // sessionCost = 0.05 (main only)
      expect(idlePayload!.sessionCost).toBe(0.05);
      // totalCost = 0.08 (main + sub)
      expect(idlePayload!.totalCost).toBeCloseTo(0.08, 10);
    });

    test('token data persists across multiple idle events for same session', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Persist Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-persist-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Persist Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // Send message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'persist-msg-1',
          sessionID: 'token-persist-1',
          cost: 0.05,
          tokens: { input: 100, output: 200 },
        }) as any,
      });

      // First idle - should have data
      const idleEvent1 = createMockEvent('session.idle', { sessionID: 'token-persist-1' });
      await hooks.event!({ event: idleEvent1 as any });
      expect(getTestHelpers().payloads.length).toBe(1);
      expect(getTestHelpers().payloads[0].sessionCost).toBe(0.05);

      // Second idle for same session - token data should still be available (not cleaned up)
      getTestHelpers().payloads.length = 0;
      const idleEvent2 = createMockEvent('session.idle', { sessionID: 'token-persist-1' });
      await hooks.event!({ event: idleEvent2 as any });
      expect(getTestHelpers().payloads.length).toBe(1);
      // Token data persists - should still have the cost
      expect(getTestHelpers().payloads[0].sessionCost).toBe(0.05);
    });

    test('no token data - payload fields are undefined/empty', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token NoData Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-nodata-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'No Data Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // No message.updated events - go straight to idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-nodata-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      // No messages - fillTokenData fills all-zero token data
      expect(payload.sessionCost).toBe(0);
      expect(payload.totalCost).toBe(0);
      expect(payload.sessionTokens).toBeDefined();
      expect(payload.sessionTokens!.total).toBe(0);
      expect(payload.modelID).toBeUndefined();
      expect(payload.costFormatted).toBeDefined();
    });

    test('costFormatted and totalCostFormatted are correctly formatted', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Format Test' })],
        cost: { currency: 'USD', decimalPlaces: 4 },
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-format-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Format Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'format-msg-1',
          sessionID: 'token-format-1',
          cost: 0.0423,
          tokens: { input: 100, output: 200 },
        }) as any,
      });

      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-format-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      expect(getTestHelpers().payloads[0].costFormatted).toBe('$0.0423');
      expect(getTestHelpers().payloads[0].totalCostFormatted).toBe('$0.0423');
      expect(getTestHelpers().payloads[0].currency).toBe('USD');
    });

    test('modelID/providerID/mode take values from the last message', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token LastMsg Test' })],
      };

      const ctx = createTestCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'token-lastmsg-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Last Message Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // First message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'lastmsg-1',
          sessionID: 'token-lastmsg-1',
          cost: 0.01,
          tokens: { input: 50 },
          modelID: 'model-first',
          providerID: 'provider-first',
          mode: 'plan',
        }) as any,
      });

      // Second (last) message
      await hooks.event!({
        event: createMockAssistantMessage({
          id: 'lastmsg-2',
          sessionID: 'token-lastmsg-1',
          cost: 0.02,
          tokens: { input: 100 },
          modelID: 'model-last',
          providerID: 'provider-last',
          mode: 'build',
        }) as any,
      });

      const idleEvent = createMockEvent('session.idle', { sessionID: 'token-lastmsg-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      // Should contain last message's values
      expect(payload.modelID).toBe('model-last');
      expect(payload.providerID).toBe('provider-last');
      expect(payload.mode).toBe('build');
      // Cost should be accumulated
      expect(payload.sessionCost).toBeCloseTo(0.03, 10);
    });
  });

  // ============================================================
  // token tracking across multiple idle events 测试组
  // ============================================================
  describe('token tracking across multiple idle events', () => {
    // Helper: create a mock assistant message.updated event
    function createMsgEvent(overrides: {
      id: string;
      sessionID: string;
      cost?: number;
      tokens?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
      modelID?: string;
      providerID?: string;
      mode?: string;
    }) {
      return createMockEvent('message.updated', {
        info: {
          id: overrides.id,
          sessionID: overrides.sessionID,
          role: 'assistant',
          time: { created: Date.now() },
          cost: overrides.cost ?? 0,
          tokens: {
            input: overrides.tokens?.input ?? 0,
            output: overrides.tokens?.output ?? 0,
            reasoning: overrides.tokens?.reasoning ?? 0,
            cache: {
              read: overrides.tokens?.cacheRead ?? 0,
              write: overrides.tokens?.cacheWrite ?? 0,
            },
          },
          modelID: overrides.modelID ?? 'test-model',
          providerID: overrides.providerID ?? 'test-provider',
          mode: overrides.mode ?? 'test-mode',
          parentID: '',
          path: { cwd: '/', root: '/' },
        },
      });
    }

    test('tokens increase monotonically across multiple idle events', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Test' })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create main session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'session-token-test',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Token Monotonic Test',
            version: '1.0',
            time: { created: Date.now() - 120000, updated: Date.now() },
          },
        }) as any,
      });
      getTestHelpers().payloads.length = 0;

      // Send 3 message.updated events
      for (let i = 1; i <= 3; i++) {
        await hooks.event!({
          event: createMsgEvent({
            id: `msg-${i}`,
            sessionID: 'session-token-test',
            cost: 0.05,
            tokens: { input: 5000, output: 1000, reasoning: 500, cacheRead: 2000, cacheWrite: 500 },
            modelID: 'test-model',
            providerID: 'test-provider',
            mode: 'test-mode',
          }) as any,
        });
      }

      // Fire first session.idle
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'session-token-test' }) as any,
      });

      const payloads = getTestHelpers().payloads;
      expect(payloads.length).toBe(1);
      const firstSessionCost = payloads[0].sessionCost!;
      const firstTotalCost = payloads[0].totalCost!;
      const firstSessionTotal = payloads[0].sessionTokens!.total;

      // Send 2 MORE message.updated events
      for (let i = 4; i <= 5; i++) {
        await hooks.event!({
          event: createMsgEvent({
            id: `msg-${i}`,
            sessionID: 'session-token-test',
            cost: 0.05,
            tokens: { input: 6000, output: 1200, reasoning: 600, cacheRead: 2500, cacheWrite: 600 },
          }) as any,
        });
      }

      // Fire second session.idle
      getTestHelpers().payloads.length = 0;
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'session-token-test' }) as any,
      });

      expect(getTestHelpers().payloads.length).toBe(1);
      const secondPayload = getTestHelpers().payloads[0];

      // session cost should have increased (5 messages * 0.05 = 0.25 > 3 * 0.05 = 0.15)
      expect(secondPayload.sessionCost!).toBeGreaterThan(firstSessionCost);
      // total cost should have increased
      expect(secondPayload.totalCost!).toBeGreaterThan(firstTotalCost);
      // session tokens total should have increased
      expect(secondPayload.sessionTokens!.total).toBeGreaterThan(firstSessionTotal);
    });

    test('sub-session tokens are aggregated into parent total', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create main session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'session-parent-agg',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Parent Agg Session',
            version: '1.0',
            time: { created: Date.now() - 120000, updated: Date.now() },
          },
        }) as any,
      });

      // Create child session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'session-child-agg',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Child Agg Session',
            version: '1.0',
            time: { created: Date.now() - 60000, updated: Date.now() },
            parentID: 'session-parent-agg',
          },
        }) as any,
      });

      getTestHelpers().payloads.length = 0;

      // Send message.updated for main session
      await hooks.event!({
        event: createMsgEvent({
          id: 'main-agg-msg-1',
          sessionID: 'session-parent-agg',
          cost: 0.05,
          tokens: { input: 5000 },
        }) as any,
      });

      // Send message.updated for child session
      await hooks.event!({
        event: createMsgEvent({
          id: 'child-agg-msg-1',
          sessionID: 'session-child-agg',
          cost: 0.03,
          tokens: { input: 3000 },
        }) as any,
      });

      // Fire main session's idle
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'session-parent-agg' }) as any,
      });

      const payloads = getTestHelpers().payloads;
      const idlePayload = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'session-parent-agg');
      expect(idlePayload).toBeDefined();

      // totalCost > sessionCost (proves sub-session included)
      expect(idlePayload!.totalCost!).toBeGreaterThan(idlePayload!.sessionCost!);
      // totalTokens > sessionTokens (child's tokens aggregated)
      expect(idlePayload!.totalTokens!.input).toBeGreaterThan(idlePayload!.sessionTokens!.input);
      // totalTokens includes child session contribution (>= 5000 + 3000 = 8000)
      expect(idlePayload!.totalTokens!.input).toBeGreaterThanOrEqual(8000);
    });

    test('sub-session idle does not lose its token data for parent aggregation', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create main session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'session-parent-persist',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Parent Persist Session',
            version: '1.0',
            time: { created: Date.now() - 120000, updated: Date.now() },
          },
        }) as any,
      });

      // Create child session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'session-child-persist',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Child Persist Session',
            version: '1.0',
            time: { created: Date.now() - 60000, updated: Date.now() },
            parentID: 'session-parent-persist',
          },
        }) as any,
      });

      getTestHelpers().payloads.length = 0;

      // Send message.updated for child session with tokens
      await hooks.event!({
        event: createMsgEvent({
          id: 'child-persist-msg-1',
          sessionID: 'session-child-persist',
          cost: 0.02,
          tokens: { input: 2000, output: 1000 },
        }) as any,
      });

      // Fire child session's session.idle (this triggers the bug: tokenDataMap.delete for child!)
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'session-child-persist' }) as any,
      });

      // The child idle event should be filtered (subagent not in default whitelist but we added it)
      // Clear payloads from child idle
      getTestHelpers().payloads.length = 0;

      // Send message.updated for main session with tokens
      await hooks.event!({
        event: createMsgEvent({
          id: 'main-persist-msg-1',
          sessionID: 'session-parent-persist',
          cost: 0.05,
          tokens: { input: 5000 },
        }) as any,
      });

      // Fire main session's session.idle
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'session-parent-persist' }) as any,
      });

      const payloads = getTestHelpers().payloads;
      const mainIdle = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'session-parent-persist');
      expect(mainIdle).toBeDefined();

      // main session's totalTokens.input should include child session's tokens
      // child contributed 2000 input + main contributed 5000 input = 7000 minimum
      expect(mainIdle!.totalTokens!.input).toBeGreaterThanOrEqual(7000);
    });

    test('nested sub-sessions (grandchildren) are aggregated into parent total', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create main session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'nested-main',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Nested Main Session',
            version: '1.0',
            time: { created: Date.now() - 120000, updated: Date.now() },
          },
        }) as any,
      });

      // Create child session (parentID = nested-main)
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'nested-child',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Nested Child Session',
            version: '1.0',
            time: { created: Date.now() - 60000, updated: Date.now() },
            parentID: 'nested-main',
          },
        }) as any,
      });

      // Create grandchild session (parentID = nested-child)
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'nested-grandchild',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Nested Grandchild Session',
            version: '1.0',
            time: { created: Date.now() - 30000, updated: Date.now() },
            parentID: 'nested-child',
          },
        }) as any,
      });

      getTestHelpers().payloads.length = 0;

      // Send message.updated for main session
      await hooks.event!({
        event: createMsgEvent({
          id: 'nested-main-msg-1',
          sessionID: 'nested-main',
          cost: 0.05,
          tokens: { input: 5000 },
        }) as any,
      });

      // Send message.updated for child session
      await hooks.event!({
        event: createMsgEvent({
          id: 'nested-child-msg-1',
          sessionID: 'nested-child',
          cost: 0.03,
          tokens: { input: 3000 },
        }) as any,
      });

      // Send message.updated for grandchild session
      await hooks.event!({
        event: createMsgEvent({
          id: 'nested-grandchild-msg-1',
          sessionID: 'nested-grandchild',
          cost: 0.02,
          tokens: { input: 2000 },
        }) as any,
      });

      // Fire main session's idle
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'nested-main' }) as any,
      });

      const payloads = getTestHelpers().payloads;
      const idlePayload = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'nested-main');
      expect(idlePayload).toBeDefined();

      // totalTokens.input should include all three levels: 5000 + 3000 + 2000 = 10000
      expect(idlePayload!.totalTokens!.input).toBeGreaterThanOrEqual(10000);
      // totalTokens > sessionTokens (proves child + grandchild included)
      expect(idlePayload!.totalTokens!.input).toBeGreaterThan(idlePayload!.sessionTokens!.input);
      // totalCost should include all levels: 0.05 + 0.03 + 0.02 = 0.10
      expect(idlePayload!.totalCost!).toBeCloseTo(0.10, 10);
    });

    test('child idle before parent does not lose child token data', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create main session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'child-idle-main',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Child Idle Main Session',
            version: '1.0',
            time: { created: Date.now() - 120000, updated: Date.now() },
          },
        }) as any,
      });

      // Create child session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'child-idle-child',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'Child Idle Child Session',
            version: '1.0',
            time: { created: Date.now() - 60000, updated: Date.now() },
            parentID: 'child-idle-main',
          },
        }) as any,
      });

      getTestHelpers().payloads.length = 0;

      // Send message.updated for child session
      await hooks.event!({
        event: createMsgEvent({
          id: 'child-idle-msg-1',
          sessionID: 'child-idle-child',
          cost: 0.03,
          tokens: { input: 3000, output: 1000 },
        }) as any,
      });

      // Fire child session's idle FIRST (before main)
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'child-idle-child' }) as any,
      });

      // Clear payloads from child idle
      getTestHelpers().payloads.length = 0;

      // Send message.updated for main session
      await hooks.event!({
        event: createMsgEvent({
          id: 'child-idle-main-msg-1',
          sessionID: 'child-idle-main',
          cost: 0.05,
          tokens: { input: 5000 },
        }) as any,
      });

      // Fire main session's idle
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'child-idle-main' }) as any,
      });

      const payloads = getTestHelpers().payloads;
      const mainIdle = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'child-idle-main');
      expect(mainIdle).toBeDefined();

      // Child's token data should still be available despite child having idled earlier
      // totalTokens.input >= 5000 (main) + 3000 (child) = 8000
      expect(mainIdle!.totalTokens!.input).toBeGreaterThanOrEqual(8000);
      // totalCost >= 0.05 (main) + 0.03 (child) = 0.08
      expect(mainIdle!.totalCost!).toBeGreaterThanOrEqual(0.08);
    });

    test('string-encoded token values from SDK are correctly converted to numbers', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Token String Test' })],
      };

      const ctx = {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
      };

      const hooks = await NotificationPlugin(ctx);

      // Create main session
      await hooks.event!({
        event: createMockEvent('session.created', {
          info: {
            id: 'session-string-tokens',
            projectID: 'test-project',
            directory: '/test/directory',
            title: 'String Token Session',
            version: '1.0',
            time: { created: Date.now() - 60000, updated: Date.now() },
          },
        }) as any,
      });
      getTestHelpers().payloads.length = 0;

      // Send a raw message.updated event with STRING token/cost values
      // (bypasses createMsgEvent which converts to numbers)
      await hooks.event!({
        event: {
          type: 'message.updated',
          properties: {
            info: {
              id: 'string-msg-1',
              sessionID: 'session-string-tokens',
              role: 'assistant',
              time: { created: Date.now() },
              cost: '0.03',           // STRING, not number
              tokens: {
                input: '5000',         // STRING, not number
                output: 200,           // number (mixed)
                reasoning: '300',      // STRING
                cache: {
                  read: '100',         // STRING
                  write: 50,           // number (mixed)
                },
              },
              modelID: 'test-model',
              providerID: 'test-provider',
              mode: 'test-mode',
              parentID: '',
              path: { cwd: '/', root: '/' },
            },
          },
        } as any,
      });

      // Fire session.idle
      await hooks.event!({
        event: createMockEvent('session.idle', { sessionID: 'session-string-tokens' }) as any,
      });

      const payloads = getTestHelpers().payloads;
      expect(payloads.length).toBe(1);
      const payload = payloads[0];

      // Verify all string-encoded values are correctly converted to numbers
      expect(payload.sessionCost).toBe(0.03);
      expect(typeof payload.sessionCost).toBe('number');
      expect(payload.sessionTokens!.input).toBe(5000);
      expect(typeof payload.sessionTokens!.input).toBe('number');
      expect(payload.sessionTokens!.output).toBe(200);
      expect(payload.sessionTokens!.reasoning).toBe(300);
      expect(payload.sessionTokens!.cacheRead).toBe(100);
      expect(payload.sessionTokens!.cacheWrite).toBe(50);
    });
  });

  // ============================================================
  // aggregateSessionTokens: last-message semantics
  // ============================================================
  describe('aggregateSessionTokens: last-message semantics', () => {
    // Helper: create a mock assistant message.updated event
    function createSemMsg(overrides: {
      id: string;
      sessionID: string;
      cost?: number;
      tokens?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
      modelID?: string;
      providerID?: string;
      mode?: string;
    }) {
      return createMockEvent('message.updated', {
        info: {
          id: overrides.id,
          sessionID: overrides.sessionID,
          role: 'assistant',
          time: { created: Date.now() },
          cost: overrides.cost ?? 0,
          tokens: {
            input: overrides.tokens?.input ?? 0,
            output: overrides.tokens?.output ?? 0,
            reasoning: overrides.tokens?.reasoning ?? 0,
            cache: {
              read: overrides.tokens?.cacheRead ?? 0,
              write: overrides.tokens?.cacheWrite ?? 0,
            },
          },
          modelID: overrides.modelID ?? 'test-model',
          providerID: overrides.providerID ?? 'test-provider',
          mode: overrides.mode ?? 'test-mode',
          parentID: '',
          path: { cwd: '/', root: '/' },
        },
      });
    }

    // Helper: create standard ctx
    function createSemCtx(overrides: Record<string, unknown> = {}) {
      return {
        project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
        directory: '/token-project',
        worktree: '/test/worktree',
        serverUrl: new URL('http://localhost:3000'),
        client: {} as any,
        $: {} as any,
        ...overrides,
      };
    }

    test('3+ messages: sessionTokens.total = last message\'s input + output + cacheRead + cacheWrite', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'LastMsg Semantics Test' })],
      };

      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'lastmsg-semantics-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Last Message Semantics',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // Message 1: input=100, output=10, reasoning=5, cacheRead=500, cacheWrite=50
      await hooks.event!({
        event: createSemMsg({
          id: 'sem-msg-1',
          sessionID: 'lastmsg-semantics-1',
          cost: 0.01,
          tokens: { input: 100, output: 10, reasoning: 5, cacheRead: 500, cacheWrite: 50 },
        }) as any,
      });

      // Message 2: input=200, output=20, reasoning=10, cacheRead=600, cacheWrite=60
      await hooks.event!({
        event: createSemMsg({
          id: 'sem-msg-2',
          sessionID: 'lastmsg-semantics-1',
          cost: 0.02,
          tokens: { input: 200, output: 20, reasoning: 10, cacheRead: 600, cacheWrite: 60 },
        }) as any,
      });

      // Message 3 (last): input=300, output=30, reasoning=15, cacheRead=700, cacheWrite=70
      await hooks.event!({
        event: createSemMsg({
          id: 'sem-msg-3',
          sessionID: 'lastmsg-semantics-1',
          cost: 0.03,
          tokens: { input: 300, output: 30, reasoning: 15, cacheRead: 700, cacheWrite: 70 },
        }) as any,
      });

      // Trigger idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'lastmsg-semantics-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      // total = last message's input + output + cacheRead + cacheWrite (excludes reasoning)
      expect(payload.sessionTokens!.total).toBe(300 + 30 + 700 + 70); // 1100
      expect(payload.sessionTokens!.input).toBe(300);
      expect(payload.sessionTokens!.output).toBe(30);
      expect(payload.sessionTokens!.reasoning).toBe(15);
      expect(payload.sessionTokens!.cacheRead).toBe(700);
      expect(payload.sessionTokens!.cacheWrite).toBe(70);
    });

    test('sessionCost = sum of all message costs (unchanged)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Cost Sum Test' })],
      };

      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'cost-sum-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Cost Sum Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // 3 messages with costs 0.01, 0.02, 0.03
      await hooks.event!({
        event: createSemMsg({
          id: 'cost-msg-1',
          sessionID: 'cost-sum-1',
          cost: 0.01,
          tokens: { input: 100 },
        }) as any,
      });
      await hooks.event!({
        event: createSemMsg({
          id: 'cost-msg-2',
          sessionID: 'cost-sum-1',
          cost: 0.02,
          tokens: { input: 200 },
        }) as any,
      });
      await hooks.event!({
        event: createSemMsg({
          id: 'cost-msg-3',
          sessionID: 'cost-sum-1',
          cost: 0.03,
          tokens: { input: 300 },
        }) as any,
      });

      const idleEvent = createMockEvent('session.idle', { sessionID: 'cost-sum-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      // Cost should be sum of all message costs (unchanged behavior)
      expect(getTestHelpers().payloads[0].sessionCost).toBeCloseTo(0.06, 10);
    });

    test('reasoning excluded from total but available in breakdown', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Reasoning Exclude Test' })],
      };

      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'reasoning-exclude-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Reasoning Exclude Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // 1 message: input=100, output=50, reasoning=999, cacheRead=200, cacheWrite=10
      await hooks.event!({
        event: createSemMsg({
          id: 'reasoning-msg-1',
          sessionID: 'reasoning-exclude-1',
          cost: 0.01,
          tokens: { input: 100, output: 50, reasoning: 999, cacheRead: 200, cacheWrite: 10 },
        }) as any,
      });

      const idleEvent = createMockEvent('session.idle', { sessionID: 'reasoning-exclude-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      // total excludes reasoning: 100 + 50 + 200 + 10 = 360
      expect(payload.sessionTokens!.total).toBe(100 + 50 + 200 + 10); // 360
      // reasoning still available in breakdown
      expect(payload.sessionTokens!.reasoning).toBe(999);
    });

    test('single message: behavior same as current', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Single Msg Test' })],
      };

      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'single-msg-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Single Message Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // 1 message: input=1000, output=500, reasoning=100, cacheRead=2000, cacheWrite=50
      await hooks.event!({
        event: createSemMsg({
          id: 'single-msg-1',
          sessionID: 'single-msg-1',
          cost: 0.05,
          tokens: { input: 1000, output: 500, reasoning: 100, cacheRead: 2000, cacheWrite: 50 },
        }) as any,
      });

      const idleEvent = createMockEvent('session.idle', { sessionID: 'single-msg-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      // total excludes reasoning: 1000 + 500 + 2000 + 50 = 3550
      expect(payload.sessionTokens!.total).toBe(1000 + 500 + 2000 + 50); // 3550
      expect(payload.sessionTokens!.input).toBe(1000);
      expect(payload.sessionTokens!.output).toBe(500);
      expect(payload.sessionTokens!.reasoning).toBe(100);
      expect(payload.sessionTokens!.cacheRead).toBe(2000);
      expect(payload.sessionTokens!.cacheWrite).toBe(50);
    });

    test('empty session: all token fields 0', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Empty Session Test' })],
      };

      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'empty-session-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'Empty Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // No message.updated events - go straight to idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'empty-session-1' });
      await hooks.event!({ event: idleEvent as any });

      expect(getTestHelpers().payloads.length).toBe(1);
      const payload = getTestHelpers().payloads[0];
      // Empty session should have token fields as 0 (not undefined)
      expect(payload.sessionTokens).toBeDefined();
      expect(payload.sessionTokens!.total).toBe(0);
      expect(payload.sessionTokens!.input).toBe(0);
      expect(payload.sessionTokens!.output).toBe(0);
      expect(payload.sessionTokens!.reasoning).toBe(0);
      expect(payload.sessionTokens!.cacheRead).toBe(0);
      expect(payload.sessionTokens!.cacheWrite).toBe(0);
      expect(payload.sessionCost).toBe(0);
    });

    test('sub-session aggregation: totalTokens = sum of all completed messages across sessions', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'SubAgg LastMsg Test' })],
        includeSessionTypes: ['main', 'subagent'],
      };

      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      // Main session
      const mainSession = {
        id: 'subagg-main-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'SubAgg Main Session',
        version: '1.0',
        time: { created: Date.now() - 120000, updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: mainSession }) as any });

      // Sub session
      const subSession = {
        id: 'subagg-sub-1',
        projectID: 'test-project',
        directory: '/test/directory',
        title: 'SubAgg Sub Session',
        version: '1.0',
        time: { created: Date.now() - 60000, updated: Date.now() },
        parentID: 'subagg-main-1',
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: subSession }) as any });
      getTestHelpers().payloads.length = 0;

      // Main session: 2 messages
      await hooks.event!({
        event: createSemMsg({
          id: 'subagg-main-msg-1',
          sessionID: 'subagg-main-1',
          cost: 0.01,
          tokens: { input: 100, output: 10, reasoning: 5, cacheRead: 50, cacheWrite: 5 },
        }) as any,
      });
      await hooks.event!({
        event: createSemMsg({
          id: 'subagg-main-msg-2',
          sessionID: 'subagg-main-1',
          cost: 0.02,
          tokens: { input: 200, output: 20, reasoning: 10, cacheRead: 100, cacheWrite: 10 },
        }) as any,
      });

      // Sub session: 2 messages
      await hooks.event!({
        event: createSemMsg({
          id: 'subagg-sub-msg-1',
          sessionID: 'subagg-sub-1',
          cost: 0.03,
          tokens: { input: 300, output: 30, reasoning: 15, cacheRead: 150, cacheWrite: 15 },
        }) as any,
      });
      await hooks.event!({
        event: createSemMsg({
          id: 'subagg-sub-msg-2',
          sessionID: 'subagg-sub-1',
          cost: 0.04,
          tokens: { input: 400, output: 40, reasoning: 20, cacheRead: 200, cacheWrite: 20 },
        }) as any,
      });

      // Trigger main session idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'subagg-main-1' });
      await hooks.event!({ event: idleEvent as any });

      const payloads = getTestHelpers().payloads;
      const idlePayload = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'subagg-main-1');
      expect(idlePayload).toBeDefined();

      // New strategy: totalTokens base = main sumAllCompletedTokens, plus sub sumAllCompletedTokens
      // Main session sum of all completed: (100+10+50+5) + (200+20+100+10) = 165 + 330 = 495
      // Sub session sum of all completed: (300+30+150+15) + (400+40+200+20) = 495 + 660 = 1155
      // totalTokens.total = 495 + 1155 = 1650
      expect(idlePayload!.totalTokens!.total).toBe(1650);
    });

    test('streaming intermediate: totalTokens accumulates all completed messages', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Total Token Streaming Test' })],
      };
      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'stream-sess-1',
        projectID: 'test',
        directory: '/test',
        title: 'Stream Test',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });

      // msg1: completed message with non-zero tokens
      await hooks.event!({ event: createSemMsg({
        id: 'stream-msg-1', sessionID: 'stream-sess-1', cost: 0.01,
        tokens: { input: 10000, output: 500, reasoning: 100, cacheRead: 50000, cacheWrite: 0 },
      }) as any });

      // msg2: streaming intermediate with zero tokens
      await hooks.event!({ event: createSemMsg({
        id: 'stream-msg-2', sessionID: 'stream-sess-1', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      }) as any });

      getTestHelpers().payloads.length = 0;

      // Trigger question event (mid-stream)
      const questionEvent = {
        type: 'question.asked',
        properties: {
          id: 'q-1',
          sessionID: 'stream-sess-1',
          questions: [{ text: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }],
        },
      };
      await hooks.event!({ event: questionEvent as any });

      const payloads = getTestHelpers().payloads;
      const qPayload = payloads.find(p => p.eventType === 'question');
      expect(qPayload).toBeDefined();

      // sessionTokens uses last non-zero message (fallback), can be non-zero
      // totalTokens accumulates ALL completed messages
      expect(qPayload!.totalTokens!.total).toBeGreaterThan(0);
      // Should be the msg1 total: 10000 + 500 + 50000 + 0 = 60500
      expect(qPayload!.totalTokens!.total).toBe(60500);
    });

    test('multiple completed messages: totalTokens reflects last-msg tokens (no sub-sessions)', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Multi Completed Test' })],
      };
      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'multi-comp-sess-1',
        projectID: 'test',
        directory: '/test',
        title: 'Multi Completed',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // msg1: input=100, output=10, cacheRead=50, cacheWrite=5 => total=165
      await hooks.event!({ event: createSemMsg({
        id: 'mc-msg-1', sessionID: 'multi-comp-sess-1', cost: 0.01,
        tokens: { input: 100, output: 10, cacheRead: 50, cacheWrite: 5 },
      }) as any });

      // msg2: input=200, output=20, cacheRead=100, cacheWrite=10 => total=330
      await hooks.event!({ event: createSemMsg({
        id: 'mc-msg-2', sessionID: 'multi-comp-sess-1', cost: 0.02,
        tokens: { input: 200, output: 20, cacheRead: 100, cacheWrite: 10 },
      }) as any });

      // msg3: input=300, output=30, cacheRead=150, cacheWrite=15 => total=495
      await hooks.event!({ event: createSemMsg({
        id: 'mc-msg-3', sessionID: 'multi-comp-sess-1', cost: 0.03,
        tokens: { input: 300, output: 30, cacheRead: 150, cacheWrite: 15 },
      }) as any });

      // Trigger idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'multi-comp-sess-1' });
      await hooks.event!({ event: idleEvent as any });

      const payloads = getTestHelpers().payloads;
      const idlePayload = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'multi-comp-sess-1');
      expect(idlePayload).toBeDefined();

      // totalTokens = sum of all completed messages (no sub-sessions)
      expect(idlePayload!.totalTokens!.total).toBe(165 + 330 + 495); // 990
      expect(idlePayload!.totalTokens!.input).toBe(100 + 200 + 300); // 600
      expect(idlePayload!.totalTokens!.output).toBe(10 + 20 + 30); // 60
      expect(idlePayload!.totalTokens!.cacheRead).toBe(50 + 100 + 150); // 300
      expect(idlePayload!.totalTokens!.cacheWrite).toBe(5 + 10 + 15); // 30
    });

    test('all messages with zero tokens: totalTokens is 0', async () => {
      configMock = {
        channels: [createMockChannel({ name: 'Zero Tokens Test' })],
      };
      const ctx = createSemCtx();
      const hooks = await NotificationPlugin(ctx);

      const sessionInfo = {
        id: 'zero-tok-sess-1',
        projectID: 'test',
        directory: '/test',
        title: 'Zero Tokens',
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      };
      await hooks.event!({ event: createMockEvent('session.created', { info: sessionInfo }) as any });
      getTestHelpers().payloads.length = 0;

      // msg1: all zero tokens
      await hooks.event!({ event: createSemMsg({
        id: 'zero-msg-1', sessionID: 'zero-tok-sess-1', cost: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }) as any });

      // msg2: all zero tokens
      await hooks.event!({ event: createSemMsg({
        id: 'zero-msg-2', sessionID: 'zero-tok-sess-1', cost: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }) as any });

      // Trigger idle
      const idleEvent = createMockEvent('session.idle', { sessionID: 'zero-tok-sess-1' });
      await hooks.event!({ event: idleEvent as any });

      const payloads = getTestHelpers().payloads;
      const idlePayload = payloads.find(p => p.eventType === 'idle' && p.sessionId === 'zero-tok-sess-1');
      expect(idlePayload).toBeDefined();

      // All messages have zero tokens => totalTokens should be 0
      expect(idlePayload!.totalTokens!.total).toBe(0);
      expect(idlePayload!.totalTokens!.input).toBe(0);
      expect(idlePayload!.totalTokens!.output).toBe(0);
      expect(idlePayload!.totalTokens!.cacheRead).toBe(0);
      expect(idlePayload!.totalTokens!.cacheWrite).toBe(0);
    });
  });
});
