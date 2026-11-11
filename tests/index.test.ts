import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, SessionType } from '../src/types';

// ---------------------------------------------------------------------------
// Mocked modules (must be registered before importing the plugin)
// ---------------------------------------------------------------------------

interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

// Keep the tests away from the real data directory (~/.local/share/opencode):
// the plugin writes the session cache and the event claim markers there.
const testDataDir = require('node:fs').mkdtempSync(
  require('node:path').join(require('node:os').tmpdir(), 'ul-opencode-event-test-data-'),
);
process.env.OPENCODE_DATA_DIR = testDataDir;

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

mock.module('../src/updater', () => ({
  getCurrentVersion: () => '2.0.0',
  runAutoUpdate: () => Promise.resolve(),
}));

// Usage rows are read from the OpenCode database - stub them for the tests.
// The real module is imported BEFORE the mock is registered, otherwise the
// factory would import the mocked module again (deadlock).
const actualUsage = await import('../src/usage');
const usageRows = new Map<string, any>();
mock.module('../src/usage', () => ({
  ...actualUsage,
  readProjectUsage: async () => new Map(usageRows),
}));

import { setupPlugin, PLUGIN_ID } from '../src/plugin-core';
import plugin from '../src/index';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    type: 'smtp',
    enabled: true,
    name: 'Test Channel',
    config: { host: 'smtp.test.com', port: 465, secure: true, auth: { user: 'test@test.com', pass: 'pass' } },
    recipients: ['receiver@test.com'],
    events: { created: true, idle: true, error: true },
    ...overrides,
  } as Channel;
}

/** Push based event stream, mimicking ctx.event.subscribe(). */
class EventStream {
  private items: Array<{ type: string; data: Record<string, unknown>; location?: { directory: string } }> = [];
  private waiters: Array<() => void> = [];

  push(event: { type: string; data: Record<string, unknown>; location?: { directory: string } }): void {
    this.items.push(event);
    this.waiters.splice(0).forEach((w) => w());
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<{ type: string; data: Record<string, unknown> }> {
    for (;;) {
      if (this.items.length === 0) {
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        continue;
      }
      yield this.items.shift()!;
    }
  }
}

interface MockCtx {
  ctx: any;
  events: EventStream;
  tools: any[];
  hooks: Map<string, (event: any) => Promise<void> | void>;
  abortSignal: AbortSignal;
}

function createMockCtx(options: { sessions?: Record<string, any> } = {}): MockCtx {
  const events = new EventStream();
  const tools: any[] = [];
  const hooks = new Map<string, (event: any) => Promise<void> | void>();
  const controller = new AbortController();

  const ctx: any = {
    app: { name: 'opencode', version: '2.2.7', channel: 'stable' },
    location: {
      directory: '/test/directory',
      project: { id: 'proj-1', directory: '/test/directory', canonical: '/test/directory' },
    },
    options: {},
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const custom = options.sessions?.[sessionID];
        if (custom) return custom;
        return {
          id: sessionID,
          title: 'Test Session',
          time: { created: Date.now() - 60_000 },
          location: { directory: '/test/directory' },
          model: { id: 'gpt-4o', providerID: 'openai' },
        };
      },
      list: async () => ({ data: [], cursor: {} }),
      hook: async (name: string, callback: (event: any) => Promise<void> | void) => {
        hooks.set(name, callback);
        return { dispose: async () => {} };
      },
    },
    tool: {
      transform: async (callback: (editor: any) => void) => {
        callback({
          add: (tool: any) => tools.push(tool),
          list: () => tools,
          get: () => undefined,
          namespace: () => {},
          update: () => {},
          remove: () => {},
        });
        return { dispose: async () => {} };
      },
    },
    event: {
      subscribe: (opts: { signal?: AbortSignal }) => {
        const iterator = events[Symbol.asyncIterator]();
        return {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              if (opts.signal?.aborted) return;
              const next = await Promise.race([
                iterator.next(),
                new Promise<null>((resolve) => {
                  if (opts.signal) {
                    opts.signal.addEventListener('abort', () => resolve(null), { once: true });
                  }
                }),
              ]);
              if (next === null) return;
              yield next.value;
            }
          },
        };
      },
    },
    storage: {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
      scan: async () => ({ entries: [] }),
    },
  };

  return { ctx, events, tools, hooks, abortSignal: controller.signal };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('v2 plugin', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    configMock = null;
    usageRows.clear();
  });

  afterEach(() => {
    sentMessages.length = 0;
    configMock = null;
    usageRows.clear();
  });

  test('exports a v2 plugin definition with a stable id', () => {
    expect(PLUGIN_ID).toBe('ul-opencode-event');
  });

  test('default export carries both the v2 and the v1 entry points', () => {
    expect(plugin.id).toBe('ul-opencode-event');
    expect(typeof plugin.setup).toBe('function');
    expect(typeof plugin.server).toBe('function');
  });

  test('setup registers the ul-token-rebuild tool', async () => {
    configMock = { channels: [createMockChannel()] };
    const { ctx, tools } = createMockCtx();

    await setupPlugin(ctx);

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('ul-token-rebuild');
    expect(typeof tools[0].execute).toBe('function');
  });

  test('session.created triggers a notification', async () => {
    configMock = { channels: [createMockChannel({ name: 'Created Test' })] };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'session.created', data: { sessionID: 'session-123', title: 'Test Session' } });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].channelName).toBe('Created Test');
    expect(sentMessages[0].subject).toContain('Started');
    expect(sentMessages[0].text).toContain('Test Session');
  });

  test('session.idle triggers a notification', async () => {
    configMock = { channels: [createMockChannel({ name: 'Idle Test' })] };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'session.created', data: { sessionID: 'session-456', title: 'Test Session' } });
    await waitFor(() => sentMessages.length === 1);
    sentMessages.length = 0;

    events.push({ type: 'session.idle', data: { sessionID: 'session-456' } });
    await waitFor(() => sentMessages.length === 1);

    expect(sentMessages[0].subject).toContain('Completed');
    expect(sentMessages[0].text).toContain('Task completed successfully');
  });

  test('registers the experimental.idle hook (v2 idle signal)', async () => {
    configMock = { channels: [createMockChannel({ name: 'Idle Hook Test' })] };
    const { ctx, hooks } = createMockCtx();

    await setupPlugin(ctx);

    expect(hooks.has('experimental.idle')).toBe(true);

    await hooks.get('experimental.idle')!({ sessionID: 'session-hook' });
    await waitFor(() => sentMessages.length === 1);

    expect(sentMessages[0].subject).toContain('Completed');
    expect(sentMessages[0].text).toContain('Task completed successfully');
  });

  test('session.execution.failed triggers an error notification', async () => {
    configMock = { channels: [createMockChannel({ name: 'Error Test' })] };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({
      type: 'session.execution.failed',
      data: { sessionID: 'session-789', error: { type: 'provider_error', message: 'Test error occurred' } },
    });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('Error');
    expect(sentMessages[0].text).toContain('Test error occurred');
  });

  test('session.status with busy status triggers a status notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Status Test', events: { status: true } })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'session.status', data: { sessionID: 'st-1', status: { type: 'busy' } } });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('Status Change');
    expect(sentMessages[0].text).toContain('busy');
  });

  test('session.status with idle status is reported as an idle event', async () => {
    configMock = { channels: [createMockChannel({ name: 'Status Idle Test' })] };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'session.status', data: { sessionID: 'st-2', status: { type: 'idle' } } });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('Completed');
  });

  test('permission.asked triggers a permission notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Permission Test', events: { permission: true } })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({
      type: 'permission.asked',
      data: { sessionID: 'p-1', action: 'bash', resources: ['npm install'] },
    });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('Permission');
    expect(sentMessages[0].text).toContain('npm install');
  });

  test('form.created triggers a question notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Question Test', events: { question: true } })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({
      type: 'form.created',
      data: {
        form: {
          id: 'form-1',
          sessionID: 'q-1',
          title: 'Framework Choice',
          fields: [{ label: 'Framework', description: 'Which framework do you prefer?', options: ['React', 'Vue'] }],
        },
      },
    });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('Question');
    expect(sentMessages[0].text).toContain('Framework Choice');
    expect(sentMessages[0].text).toContain('Which framework do you prefer?');
  });

  test('session.shell.ended triggers a command notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'Command Test', events: { command: true } })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({
      type: 'session.shell.ended',
      data: { sessionID: 'cmd-1', shell: { command: 'npm install', status: 'exited' } },
    });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('Command Executed');
    expect(sentMessages[0].text).toContain('npm install');
  });

  test('filesystem.changed triggers a file edited notification', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'File Test', events: { fileEdited: true } })],
      includeSessionTypes: ['main', 'subagent', 'unknown'],
    };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'filesystem.changed', data: { file: 'src/index.ts', event: 'change' } });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].subject).toContain('File Edited');
    expect(sentMessages[0].text).toContain('src/index.ts');
  });

  test('unhandled event types are ignored', async () => {
    configMock = { channels: [createMockChannel()] };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'some.unknown.event', data: { foo: 'bar' } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sentMessages.length).toBe(0);
  });

  test('sub-agent sessions are filtered by the default whitelist', async () => {
    configMock = { channels: [createMockChannel({ name: 'SubAgent Test' })] };
    const { ctx, events } = createMockCtx({
      sessions: {
        'sub-1': {
          id: 'sub-1',
          title: 'Sub Agent Session',
          parentID: 'parent-1',
          time: { created: Date.now() - 1000 },
          location: { directory: '/test/directory' },
        },
      },
    });

    await setupPlugin(ctx);
    events.push({ type: 'session.created', data: { sessionID: 'sub-1', title: 'Sub Agent Session', parentID: 'parent-1' } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sentMessages.length).toBe(0);
  });

  test('sub-agent sessions notify when explicitly enabled', async () => {
    configMock = {
      channels: [createMockChannel({ name: 'SubAgent Enabled' })],
      includeSessionTypes: ['main', 'subagent'],
    };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({ type: 'session.created', data: { sessionID: 'sub-2', title: 'Sub Agent', parentID: 'parent-1' } });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages.length).toBe(1);
  });

  test('token data from the usage snapshot is included in the notification', async () => {
    configMock = { channels: [createMockChannel({ name: 'Token Test' })] };
    usageRows.set('session-token', {
      sessionId: 'session-token',
      cost: 0.05,
      tokens: { input: 100, output: 200, reasoning: 50, cacheRead: 30, cacheWrite: 40, total: 370 },
      requestCount: 2,
    });

    const { ctx, events } = createMockCtx();
    await setupPlugin(ctx);
    events.push({ type: 'session.idle', data: { sessionID: 'session-token' } });

    await waitFor(() => sentMessages.length === 1);
    expect(sentMessages[0].text).toContain('370');
  });

  test('events of another location are skipped (prevents duplicate notifications)', async () => {
    configMock = { channels: [createMockChannel({ name: 'Other Location Test' })] };
    const { ctx, events } = createMockCtx();

    await setupPlugin(ctx);
    events.push({
      type: 'session.created',
      data: { sessionID: 'other-1', title: 'Other Project Session' },
      location: { directory: '/other/directory' },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sentMessages.length).toBe(0);
  });

  test('cleanup aborts the event subscription', async () => {
    configMock = { channels: [createMockChannel()] };
    const { ctx, events } = createMockCtx();

    const cleanup = await setupPlugin(ctx);
    expect(typeof cleanup).toBe('function');

    (cleanup as () => void)();
    events.push({ type: 'session.created', data: { sessionID: 'after-cleanup' } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sentMessages.length).toBe(0);
  });

  test('setup returns early when no channel is configured', async () => {
    configMock = { channels: [] };
    const { ctx, tools } = createMockCtx();

    const cleanup = await setupPlugin(ctx);

    expect(cleanup).toBeUndefined();
    expect(tools.length).toBe(0);
  });
});
