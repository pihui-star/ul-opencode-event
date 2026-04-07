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
let configMock: { channels: Channel[]; timezone?: string; includeSessionTypes?: SessionType[] } | null = null;

mock.module('../src/config', () => ({
  loadConfig: () => {
    if (configMock) {
      return {
        channels: configMock.channels,
        timezone: configMock.timezone,
        includeSessionTypes: configMock.includeSessionTypes,
      };
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
    sentMessages.length = 0;
    configMock = null;
  });

  afterEach(() => {
    sentMessages.length = 0;
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

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].channelName).toBe('Created Test');
    expect(sentMessages[0].subject).toContain('[OpenCode]');
    expect(sentMessages[0].subject).toContain('Started');
    expect(sentMessages[0].text).toContain('/my-project');
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
      // Single item should not contain newline separator issues
      expect(sentMessages[0].text).not.toContain('\n\n');
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
});
