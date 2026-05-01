/**
 * T8: 增量项目级聚合器测试
 * 验证 projectAgg 模块级计数器的增量更新、基数初始化、去重和 fillProjectData O(1) 读取。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel, SessionType } from '../src/types';

// Mock email module
mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    if (channel.enabled === false) return null;
    if (channel.type !== 'smtp') return null;
    if (!channel.recipients || channel.recipients.length === 0) return null;
    return { send: async () => {} };
  },
}));

// Mock updater module
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

async function createSessionWithTokens(
  hooks: { event: (args: { event: any }) => Promise<void> },
  sessionId: string,
  directory: string,
  projectPath: string,
  tokens: { input: number; output: number; cost: number; reasoning?: number; cacheRead?: number; cacheWrite?: number },
) {
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
  await hooks.event({
    event: createMockEvent('message.updated', {
      info: {
        role: 'assistant',
        sessionID: sessionId,
        id: `msg-${sessionId}-1`,
        tokens: {
          input: tokens.input,
          output: tokens.output,
          reasoning: tokens.reasoning ?? 0,
          cache: { read: tokens.cacheRead ?? 0, write: tokens.cacheWrite ?? 0 },
        },
        cost: tokens.cost,
        modelID: 'test-model',
        providerID: 'test-provider',
        mode: 'code',
      },
    }),
  });
}

describe('incremental project-level aggregation (T8)', () => {
  beforeEach(() => {
    configMock = null;
    getTestHelpers().resetFlags();
  });

  afterEach(() => {
    configMock = null;
    getTestHelpers().resetFlags();
  });

  test('initial projectAgg is zero', async () => {
    configMock = { channels: [createMockChannel()] };
    const ctx = makeCtx('/project-init');
    const hooks = await NotificationPlugin(ctx);

    // Create session but DON'T add any message.updated
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-init',
          projectID: 'test-project',
          directory: '/project-init',
          title: 'Init Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-init' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];
    expect(p.projectTokens!.input).toBe(0);
    expect(p.projectTokens!.output).toBe(0);
    expect(p.projectTokens!.total).toBe(0);
    expect(p.projectCost).toBe(0);
  });

  test('single message.updated correctly increments projectAgg', async () => {
    configMock = { channels: [createMockChannel()] };
    const ctx = makeCtx('/project-single');
    const hooks = await NotificationPlugin(ctx);

    await createSessionWithTokens(hooks, 'sess-s1', '/project-single', '/project-single', {
      input: 100, output: 50, cost: 0.01,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-s1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];
    expect(p.projectTokens!.input).toBe(100);
    expect(p.projectTokens!.output).toBe(50);
    expect(p.projectTokens!.total).toBe(150);
    expect(p.projectCost).toBeCloseTo(0.01);
  });

  test('same messageId update produces correct delta (not double-count)', async () => {
    configMock = { channels: [createMockChannel()] };
    const ctx = makeCtx('/project-delta');
    const hooks = await NotificationPlugin(ctx);

    // Create session
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-d1',
          projectID: 'test-project',
          directory: '/project-delta',
          title: 'Delta Session',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });

    // First message.updated for msg-1: input=100
    await hooks.event({
      event: createMockEvent('message.updated', {
        info: {
          role: 'assistant',
          sessionID: 'sess-d1',
          id: 'msg-d1',
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.01,
          modelID: 'test-model',
          providerID: 'test-provider',
          mode: 'code',
        },
      }),
    });

    // Second message.updated for SAME msg-1: input=150 (streaming update)
    await hooks.event({
      event: createMockEvent('message.updated', {
        info: {
          role: 'assistant',
          sessionID: 'sess-d1',
          id: 'msg-d1',
          tokens: { input: 150, output: 80, reasoning: 10, cache: { read: 5, write: 3 } },
          cost: 0.02,
          modelID: 'test-model',
          providerID: 'test-provider',
          mode: 'code',
        },
      }),
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-d1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // projectAgg should reflect the final values (150/80), NOT 100+150=250
    expect(p.projectTokens!.input).toBe(150);
    expect(p.projectTokens!.output).toBe(80);
    expect(p.projectTokens!.reasoning).toBe(10);
    expect(p.projectTokens!.cacheRead).toBe(5);
    expect(p.projectTokens!.cacheWrite).toBe(3);
    expect(p.projectTokens!.total).toBe(238); // 150+80+5+3
    expect(p.projectCost).toBeCloseTo(0.02);
  });

  test('multi-session aggregation accumulates correctly', async () => {
    configMock = { channels: [createMockChannel()] };
    const ctx = makeCtx('/project-multi');
    const hooks = await NotificationPlugin(ctx);

    // Session 1: input=100, output=50, cost=0.01
    await createSessionWithTokens(hooks, 'sess-m1', '/project-multi', '/project-multi', {
      input: 100, output: 50, cost: 0.01,
    });
    // Session 2: input=200, output=100, cost=0.02
    await createSessionWithTokens(hooks, 'sess-m2', '/project-multi', '/project-multi', {
      input: 200, output: 100, cost: 0.02,
    });

    getTestHelpers().payloads.length = 0;

    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-m1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // projectAgg = session1 + session2
    expect(p.projectTokens!.input).toBe(300); // 100+200
    expect(p.projectTokens!.output).toBe(150); // 50+100
    expect(p.projectTokens!.total).toBe(450);
    expect(p.projectCost).toBeCloseTo(0.03);
  });

  test('cross-project isolation: only current project counted', async () => {
    configMock = { channels: [createMockChannel()] };
    const ctx = makeCtx('/project-iso');
    const hooks = await NotificationPlugin(ctx);

    // Current project session
    await createSessionWithTokens(hooks, 'sess-iso1', '/project-iso', '/project-iso', {
      input: 100, output: 50, cost: 0.01,
    });

    // Different project session (different directory in session.created)
    await hooks.event({
      event: createMockEvent('session.created', {
        info: {
          id: 'sess-other',
          projectID: 'test-project',
          directory: '/other-project',
          title: 'Other Project',
          version: '1.0',
          time: { created: Date.now(), updated: Date.now() },
        },
      }),
    });
    await hooks.event({
      event: createMockEvent('message.updated', {
        info: {
          role: 'assistant',
          sessionID: 'sess-other',
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
      event: createMockEvent('session.idle', { sessionID: 'sess-iso1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Only /project-iso session counted
    expect(p.projectTokens!.input).toBe(100);
    expect(p.projectTokens!.output).toBe(50);
    expect(p.projectCost).toBeCloseTo(0.01);
  });

  test('fillProjectData uses projectAgg (O(1) read), verified via multi-step accumulation', async () => {
    configMock = { channels: [createMockChannel()] };
    const ctx = makeCtx('/project-o1');
    const hooks = await NotificationPlugin(ctx);

    // Create 3 sessions, each with token data
    await createSessionWithTokens(hooks, 'sess-o1', '/project-o1', '/project-o1', {
      input: 10, output: 5, cost: 0.001,
    });
    await createSessionWithTokens(hooks, 'sess-o2', '/project-o1', '/project-o1', {
      input: 20, output: 10, cost: 0.002,
    });
    await createSessionWithTokens(hooks, 'sess-o3', '/project-o1', '/project-o1', {
      input: 30, output: 15, cost: 0.003,
    });

    getTestHelpers().payloads.length = 0;

    // Trigger idle for sess-o1 - projectAgg should include ALL 3 sessions
    await hooks.event({
      event: createMockEvent('session.idle', { sessionID: 'sess-o1' }),
    });

    const payloads = getTestHelpers().payloads;
    expect(payloads.length).toBe(1);
    const p = payloads[0];

    // Sum: 10+20+30=60 input, 5+10+15=30 output, cost=0.006
    expect(p.projectTokens!.input).toBe(60);
    expect(p.projectTokens!.output).toBe(30);
    expect(p.projectTokens!.total).toBe(90);
    expect(p.projectCost).toBeCloseTo(0.006);
  });
});
