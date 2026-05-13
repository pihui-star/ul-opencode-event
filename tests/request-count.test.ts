import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, SessionType } from '../src/types';

// ── Mock: email ──────────────────────────────────────────────────
mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    if (channel.enabled === false) return null;
    if (channel.type !== 'smtp') return null;
    if (!channel.recipients || channel.recipients.length === 0) return null;
    return {
      send: async () => {},
    };
  },
}));

// ── Mock: updater ────────────────────────────────────────────────
mock.module('../src/updater', () => ({
  getCurrentVersion: () => '1.0.0',
  runAutoUpdate: () => Promise.resolve(),
}));

// ── Mock: config ─────────────────────────────────────────────────
let configMock: { channels: Channel[]; includeSessionTypes?: SessionType[]; cost?: any } | null = null;

mock.module('../src/config', () => ({
  loadConfig: () => {
    if (configMock) {
      return {
        channels: configMock.channels,
        includeSessionTypes: configMock.includeSessionTypes,
        cost: configMock.cost,
      };
    }
    return { channels: [] };
  },
}));

// ── Import after mocking ─────────────────────────────────────────
import { NotificationPlugin } from '../src/index';

function getTestHelpers() {
  return globalThis.__ul_opencode_event_test!;
}

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
    events: { idle: true, error: true },
    ...overrides,
  } as Channel;
}

function createMockEvent(type: string, properties: Record<string, unknown>) {
  return { type, properties };
}

function makeCtx(directory: string) {
  return {
    project: { id: 'test-project', worktree: '/test/path', time: { created: Date.now() } },
    directory,
    worktree: '/test/worktree',
    serverUrl: new URL('http://localhost:3000'),
    client: {} as any,
    $: {} as any,
  };
}

/**
 * Helper: create a session via session.created + send a single assistant message.
 * Returns hooks so callers can send additional messages afterward.
 */
async function createSessionWithTokens(
  hooks: { event: (args: { event: any }) => Promise<void> },
  sessionId: string,
  directory: string,
  projectPath: string,
  tokens: { input: number; output: number; cost: number },
) {
  // session.created
  await hooks.event({
    event: createMockEvent('session.created', {
      info: {
        id: sessionId,
        projectID: 'test-project',
        directory: projectPath,
        title: `Session ${sessionId}`,
        version: '1.0',
        time: { created: Date.now(), updated: Date.now() },
      },
    }),
  });

  // message.updated with token data
  await hooks.event({
    event: createMockEvent('message.updated', {
      info: {
        role: 'assistant',
        sessionID: sessionId,
        id: `msg-${sessionId}-1`,
        tokens: { input: tokens.input, output: tokens.output, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: tokens.cost,
        modelID: 'test-model',
        providerID: 'test-provider',
        mode: 'code',
      },
    }),
  });
}

/**
 * Helper: send an additional assistant message to an existing session.
 */
async function sendAssistantMessage(
  hooks: { event: (args: { event: any }) => Promise<void> },
  sessionId: string,
  msgId: string,
  tokens: { input: number; output: number; cost: number },
) {
  await hooks.event({
    event: createMockEvent('message.updated', {
      info: {
        role: 'assistant',
        sessionID: sessionId,
        id: msgId,
        tokens: { input: tokens.input, output: tokens.output, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: tokens.cost,
        modelID: 'test-model',
        providerID: 'test-provider',
        mode: 'code',
      },
    }),
  });
}

// ── Test Suite ────────────────────────────────────────────────────
describe('Request count aggregation (RED phase)', () => {
  beforeEach(() => {
    configMock = null;
    getTestHelpers().payloads.length = 0;
  });

  afterEach(() => {
    configMock = null;
    getTestHelpers().payloads.length = 0;
  });

  // ── Session-level tests ──────────────────────────────────────────

  test('single session with 2 assistant messages → sessionRequestCount = 2', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-rc1');
    const hooks = await NotificationPlugin(ctx);

    // Create session + first message
    await createSessionWithTokens(hooks, 'sess-rc1', '/project-rc1', '/project-rc1', {
      input: 100, output: 50, cost: 0.01,
    });

    // Send second message
    await sendAssistantMessage(hooks, 'sess-rc1', 'msg-sess-rc1-2', {
      input: 200, output: 80, cost: 0.02,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger idle
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-rc1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // RED PHASE: expect 2, but implementation doesn't exist → undefined
    expect(p.sessionRequestCount).toBe(2);
  });

  test('single session with 1 message → sessionRequestCount = 1', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-rc1b');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-rc1b', '/project-rc1b', '/project-rc1b', {
      input: 100, output: 50, cost: 0.01,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-rc1b' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // RED PHASE: expect 1, but implementation doesn't exist → undefined
    expect(p.sessionRequestCount).toBe(1);
  });

  test('empty session (no messages) → sessionRequestCount = 0', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-rc0');
    const hooks = await NotificationPlugin(ctx);

    // Create session WITHOUT any messages
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-rc0',
          projectID: 'test-project',
          directory: '/project-rc0',
          title: 'Empty Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-rc0' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // RED PHASE: expect 0, but implementation doesn't exist → undefined (or absent)
    expect(p.sessionRequestCount).toBe(0);
  });

  // ── Total-level tests (session + sub-sessions) ───────────────────

  test('total request count with sub-sessions: 2+3 → totalRequestCount = 5', async () => {
    configMock = {
      channels: [createMockChannel()],
      includeSessionTypes: ['main', 'subagent'],
    };

    const ctx = makeCtx('/project-rc-total');
    const hooks = await NotificationPlugin(ctx);

    // Main session with 2 messages
    await createSessionWithTokens(hooks, 'sess-main', '/project-rc-total', '/project-rc-total', {
      input: 100, output: 50, cost: 0.01,
    });
    await sendAssistantMessage(hooks, 'sess-main', 'msg-main-2', {
      input: 200, output: 80, cost: 0.02,
    });

    // Sub-session with 3 messages
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-sub',
          projectID: 'test-project',
          directory: '/project-rc-total',
          title: 'Sub Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
          parentID: 'sess-main',
        },
      }),
    });
    await sendAssistantMessage(hooks, 'sess-sub', 'msg-sub-1', {
      input: 50, output: 25, cost: 0.005,
    });
    await sendAssistantMessage(hooks, 'sess-sub', 'msg-sub-2', {
      input: 60, output: 30, cost: 0.006,
    });
    await sendAssistantMessage(hooks, 'sess-sub', 'msg-sub-3', {
      input: 70, output: 35, cost: 0.007,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger main session idle
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-main' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // session should have 2 messages
    expect(p.sessionRequestCount).toBe(2);

    // total should include both sessions: 2 + 3 = 5
    expect(p.totalRequestCount).toBe(5);
  });

  // ── Project-level tests ─────────────────────────────────────────

  test('project request count across sessions: 2+2 → projectRequestCount = 4', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-rc-proj');
    const hooks = await NotificationPlugin(ctx);

    // Session A with 2 messages
    await createSessionWithTokens(hooks, 'sess-a', '/project-rc-proj', '/project-rc-proj', {
      input: 100, output: 50, cost: 0.01,
    });
    await sendAssistantMessage(hooks, 'sess-a', 'msg-a-2', {
      input: 150, output: 60, cost: 0.015,
    });

    // Session B with 2 messages
    await createSessionWithTokens(hooks, 'sess-b', '/project-rc-proj', '/project-rc-proj', {
      input: 200, output: 80, cost: 0.02,
    });
    await sendAssistantMessage(hooks, 'sess-b', 'msg-b-2', {
      input: 250, output: 90, cost: 0.025,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger idle on session A
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-a' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Both sessions in same project → 2 + 2 = 4
    expect(p.projectRequestCount).toBe(4);
  });

  test('cross-project isolation: project A 2 msgs, project B 1 msg → projectRequestCount = 2', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-a');
    const hooks = await NotificationPlugin(ctx);

    // Session in project A with 2 messages
    await createSessionWithTokens(hooks, 'sess-a1', '/project-a', '/project-a', {
      input: 100, output: 50, cost: 0.01,
    });
    await sendAssistantMessage(hooks, 'sess-a1', 'msg-a1-2', {
      input: 200, output: 80, cost: 0.02,
    });

    // Session in project B with 1 message (different projectPath)
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-b1',
          projectID: 'test-project',
          directory: '/project-b',
          title: 'Project B Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });
    await sendAssistantMessage(hooks, 'sess-b1', 'msg-b1-1', {
      input: 999, output: 999, cost: 9.99,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger idle on session A1 (project A)
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-a1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Only project A messages counted: 2 (NOT 3)
    expect(p.projectRequestCount).toBe(2);
  });

  // ── Created event (no aggregation) ──────────────────────────────

  test('created event: sessionRequestCount and totalRequestCount are absent', async () => {
    configMock = {
      channels: [createMockChannel({ events: { created: true, idle: true, error: true } })],
    };

    const ctx = makeCtx('/project-rc-created');
    const hooks = await NotificationPlugin(ctx);

    // Fire session.created
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-created',
          projectID: 'test-project',
          directory: '/project-rc-created',
          title: 'Created Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });

    const payloads = getTestHelpers().payloads;
    // Expect at least 1 payload (the created event notification)
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const createdPayload = payloads.find(p => p.eventType === 'created' && p.sessionId === 'sess-created');
    expect(createdPayload).toBeDefined();

    // Request counts should NOT be set on created events
    expect(createdPayload!.sessionRequestCount).toBeUndefined();
    expect(createdPayload!.totalRequestCount).toBeUndefined();
    // projectRequestCount may or may not be set; focus on session/total
  });
});
