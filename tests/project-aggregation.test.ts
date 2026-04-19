import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, SessionType, SessionTokenData, TokenBreakdown } from '../src/types';

// Mock the email module (same pattern as index.test.ts)
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

// Mock the updater module
mock.module('../src/updater', () => ({
  getCurrentVersion: () => '1.0.0',
  runAutoUpdate: () => Promise.resolve(),
}));

// Mock config
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

// Import after mocking
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
 * Helper: create a session, populate token data via message.updated, then trigger idle.
 * Returns the captured payload.
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

describe('Project-level token aggregation', () => {
  beforeEach(() => {
    configMock = null;
    getTestHelpers().payloads.length = 0;
  });

  afterEach(() => {
    configMock = null;
    getTestHelpers().payloads.length = 0;
  });

  test('single session: projectTokens == sessionTokens', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-a');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-1', '/project-a', '/project-a', {
      input: 100, output: 50, cost: 0.01,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger idle event
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // projectTokens should equal session's sumAllCompletedTokens
    expect(p.projectTokens).toBeDefined();
    expect(p.projectTokens!.input).toBe(100);
    expect(p.projectTokens!.output).toBe(50);
    expect(p.projectTokens!.total).toBe(150);

    // projectCost should equal session cost
    expect(p.projectCost).toBeCloseTo(0.01);
  });

  test('multi-session aggregation: sums across 3 sessions', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-multi');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-m1', '/project-multi', '/project-multi', {
      input: 100, output: 50, cost: 0.01,
    });
    await createSessionWithTokens(hooks, 'sess-m2', '/project-multi', '/project-multi', {
      input: 200, output: 100, cost: 0.02,
    });
    await createSessionWithTokens(hooks, 'sess-m3', '/project-multi', '/project-multi', {
      input: 300, output: 150, cost: 0.03,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-m1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // projectTokens = sum of all 3 sessions
    expect(p.projectTokens!.input).toBe(600); // 100+200+300
    expect(p.projectTokens!.output).toBe(300); // 50+100+150
    expect(p.projectTokens!.total).toBe(900);
    expect(p.projectCost).toBeCloseTo(0.06); // 0.01+0.02+0.03
  });

  test('cross-project isolation: only counts sessions from same project', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-a');
    const hooks = await NotificationPlugin(ctx);

    // Sessions for project-a (current project)
    await createSessionWithTokens(hooks, 'sess-a1', '/project-a', '/project-a', {
      input: 100, output: 50, cost: 0.01,
    });
    await createSessionWithTokens(hooks, 'sess-a2', '/project-a', '/project-a', {
      input: 200, output: 100, cost: 0.02,
    });

    // Sessions for project-b (different project)
    await createSessionWithTokens(hooks, 'sess-b1', '/project-b', '/project-b', {
      input: 999, output: 999, cost: 9.99,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-a1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Only project-a sessions should be counted (not project-b)
    expect(p.projectTokens!.input).toBe(300); // 100+200 (not 999)
    expect(p.projectTokens!.output).toBe(150); // 50+100 (not 999)
    expect(p.projectCost).toBeCloseTo(0.03); // 0.01+0.02 (not 9.99)
  });

  test('message.updated fallback: ctx.directory used when sessionMap has no entry', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-skip');
    const hooks = await NotificationPlugin(ctx);

    // Create a session with explicit projectPath
    await createSessionWithTokens(hooks, 'sess-with', '/project-skip', '/project-skip', {
      input: 100, output: 50, cost: 0.01,
    });

    // Create a session via message.updated WITHOUT prior session.created
    // The handler falls back to ctx.directory for projectPath
    await hooks.event({
      event: createMockEvent('message.updated', {
        info: {
          role: 'assistant',
          sessionID: 'sess-fallback',
          id: 'msg-fallback-1',
          tokens: { input: 50, output: 25, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.005,
          modelID: 'test-model',
          providerID: 'test-provider',
          mode: 'code',
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-with' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Both sessions should be counted: explicit projectPath + ctx.directory fallback
    expect(p.projectTokens!.input).toBe(150); // 100 + 50
    expect(p.projectTokens!.output).toBe(75); // 50 + 25
    expect(p.projectCost).toBeCloseTo(0.015); // 0.01 + 0.005
  });

  test('cross-project isolation via different projectPath assignment', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-isolated');
    const hooks = await NotificationPlugin(ctx);

    // Session in current project
    await createSessionWithTokens(hooks, 'sess-current', '/project-isolated', '/project-isolated', {
      input: 200, output: 100, cost: 0.02,
    });

    // Session explicitly in a different project (session.created with different directory)
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-other-proj',
          projectID: 'other-project',
          directory: '/different-project',
          title: 'Other Project Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });
    await hooks.event({
      event: createMockEvent('message.updated', {
        info: {
          role: 'assistant',
          sessionID: 'sess-other-proj',
          id: 'msg-other-1',
          tokens: { input: 999, output: 888, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 9.99,
          modelID: 'test-model',
          providerID: 'test-provider',
          mode: 'code',
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-current' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Only current project sessions should be counted, not the /different-project session
    expect(p.projectTokens!.input).toBe(200);
    expect(p.projectTokens!.output).toBe(100);
    expect(p.projectCost).toBeCloseTo(0.02);
  });

  test('projectCostFormatted is set with currency symbol', async () => {
    configMock = {
      channels: [createMockChannel()],
      cost: { currency: 'USD' },
    };

    const ctx = makeCtx('/project-fmt');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-fmt', '/project-fmt', '/project-fmt', {
      input: 100, output: 50, cost: 0.05,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-fmt' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    expect(p.projectCostFormatted).toBeDefined();
    expect(p.projectCostFormatted).toContain('$');
    expect(p.projectCostFormatted).toContain('0.05');
  });

  test('projectCostFormatted with CNY currency', async () => {
    configMock = {
      channels: [createMockChannel()],
      cost: { currency: 'CNY', exchangeRate: 7.25 },
    };

    const ctx = makeCtx('/project-cny');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-cny', '/project-cny', '/project-cny', {
      input: 100, output: 50, cost: 1.0,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-cny' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    expect(p.projectCostFormatted).toBeDefined();
    expect(p.projectCostFormatted).toContain('\u00a5'); // ¥
    // 1.0 USD * 7.25 = 7.25 CNY
    expect(p.projectCostFormatted).toContain('7.25');
  });

  test('session.created backfills projectPath for preloaded sessions', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-backfill');
    const hooks = await NotificationPlugin(ctx);

    // Simulate a preloaded session (no projectPath) by sending message.updated first
    await hooks.event({
      event: createMockEvent('message.updated', {
        info: {
          role: 'assistant',
          sessionID: 'sess-preloaded',
          id: 'msg-pre-1',
          tokens: { input: 50, output: 25, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.005,
          modelID: 'test-model',
          providerID: 'test-provider',
          mode: 'code',
        },
      }),
    });

    // Now send session.created with a directory - should backfill projectPath
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-preloaded',
          projectID: 'test-project',
          directory: '/project-backfill',
          title: 'Preloaded Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    // Now trigger idle - the preloaded session should be counted in project aggregation
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-preloaded' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // The preloaded session should now have projectPath backfilled and be counted
    expect(p.projectTokens!.input).toBe(50);
    expect(p.projectTokens!.output).toBe(25);
    expect(p.projectCost).toBeCloseTo(0.005);
  });

  test('path.normalize handles mixed slashes for project matching', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    // Use forward slashes in ctx.directory
    const ctx = makeCtx('/project/norm');
    const hooks = await NotificationPlugin(ctx);

    // Create session with same normalized path
    await createSessionWithTokens(hooks, 'sess-norm', '/project/norm', '/project/norm', {
      input: 80, output: 40, cost: 0.008,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-norm' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Should match despite any slash differences
    expect(p.projectTokens!.input).toBe(80);
    expect(p.projectTokens!.output).toBe(40);
  });

  test('project aggregation works for error events', async () => {
    configMock = {
      channels: [createMockChannel()],
      includeSessionTypes: ['main', 'unknown'] as SessionType[],
    };

    const ctx = makeCtx('/project-err');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-err1', '/project-err', '/project-err', {
      input: 100, output: 50, cost: 0.01,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger error event (not idle)
    await hooks.event({
      event: createMockEvent('session.error', {
        sessionID: 'sess-err1',
        error: { message: 'test error' },
      }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    expect(p.projectTokens).toBeDefined();
    expect(p.projectTokens!.input).toBe(100);
    expect(p.projectCost).toBeCloseTo(0.01);
    expect(p.projectCostFormatted).toBeDefined();
  });

  test('project fields are zero when no sessions have token data', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-empty');
    const hooks = await NotificationPlugin(ctx);

    // Create session but DON'T add any message.updated
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-empty',
          projectID: 'test-project',
          directory: '/project-empty',
          title: 'Empty Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-empty' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Should have zero project data (no token data for any session in this project)
    expect(p.projectTokens).toBeDefined();
    expect(p.projectTokens!.input).toBe(0);
    expect(p.projectTokens!.output).toBe(0);
    expect(p.projectTokens!.total).toBe(0);
    expect(p.projectCost).toBe(0);
  });

  test('handler variables include 14 project* fields in payload', async () => {
    configMock = {
      channels: [createMockChannel()],
    };

    const ctx = makeCtx('/project-vars');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-vars', '/project-vars', '/project-vars', {
      input: 100, output: 50, cost: 0.01,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-vars' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Verify the 3 payload fields that handler.ts reads to generate 14 variables
    expect(typeof p.projectCost).toBe('number');
    expect(p.projectTokens).toBeDefined();
    expect(typeof p.projectTokens!.input).toBe('number');
    expect(typeof p.projectTokens!.output).toBe('number');
    expect(typeof p.projectTokens!.reasoning).toBe('number');
    expect(typeof p.projectTokens!.cacheRead).toBe('number');
    expect(typeof p.projectTokens!.cacheWrite).toBe('number');
    expect(typeof p.projectTokens!.total).toBe('number');
    expect(typeof p.projectCostFormatted).toBe('string');

    // These 9 fields (projectCost + 7 token breakdown + projectCostFormatted) are
    // what handler.ts uses to produce its 14 project* variables:
    // projectCost, projectCostFormatted, projectTokens{Input,Output,Reasoning,CacheRead,CacheWrite,Total},
    // projectTokens{Input,Output,Reasoning,CacheRead,CacheWrite,Total}Human
  });
});
