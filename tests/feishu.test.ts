import { describe, test, expect, mock, beforeEach, afterEach, beforeAll } from 'bun:test';
import type { Channel, FeishuConfig, ChannelFormatter } from '../src/types.js';

// ─── Helper Factories ──────────────────────────────────────

function createMockFeishuChannel(overrides?: Partial<Channel>): Channel {
  return {
    type: 'feishu',
    enabled: true,
    name: 'Test Feishu',
    config: {
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
      ...overrides?.config,
    },
    recipients: [],
    events: { created: true, idle: true, error: true },
    ...overrides,
  };
}

function createMockFeishuConfig(overrides?: Partial<FeishuConfig>): FeishuConfig {
  return {
    webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
    ...overrides,
  };
}

/** Narrowed Feishu interactive card message shape for test assertions */
interface FeishuInteractiveMessage {
  msg_type: string;
  card: {
    config: Record<string, unknown>;
    header: {
      title: { tag: string; content: string };
      template: string;
    };
    elements: Array<{ tag: string; text: { tag: string; content: string } }>;
  };
}

// Minimal EventPayload for formatter calls
const dummyPayload = {
  eventType: 'idle' as const,
  timestamp: '2024-01-01T12:00:00Z',
  projectName: 'test-project',
  projectPath: '/test/project',
  sessionId: 'sess-123',
  sessionType: 'main' as const,
};

// ─── Fetch Mock State ─────────────────────────────────────

interface FetchCall {
  url: string;
  options: RequestInit;
}

let capturedFetchCalls: FetchCall[] = [];
let mockFetchResponse: { ok: boolean; status: number; json: Record<string, unknown> };
let mockFetchShouldThrow: Error | null = null;

function setupMockFetch(response?: Partial<{ ok: boolean; status: number; json: Record<string, unknown> }>, throwErr?: Error) {
  capturedFetchCalls = [];
  mockFetchResponse = {
    ok: response?.ok ?? true,
    status: response?.status ?? 200,
    json: response?.json ?? { code: 0, msg: 'success' },
  };
  mockFetchShouldThrow = throwErr ?? null;

  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = mock(async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
    capturedFetchCalls.push({
      url: typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url,
      options: options ?? {},
    });

    if (mockFetchShouldThrow) {
      throw mockFetchShouldThrow;
    }

    return {
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      json: async () => mockFetchResponse.json,
      text: async () => JSON.stringify(mockFetchResponse.json),
    } as Response;
  });

  return originalFetch;
}

function restoreFetch(originalFetch: typeof globalThis.fetch) {
  globalThis.fetch = originalFetch;
}

// ══════════════════════════════════════════════════════════
// generateFeishuSign
// ══════════════════════════════════════════════════════════

describe('generateFeishuSign', () => {
  let generateFeishuSign: typeof import('../src/feishu').generateFeishuSign;
  beforeAll(async () => {
    ({ generateFeishuSign } = await import('../src/feishu'));
  });

  test('produces valid base64 string for known inputs', async () => {
    const secret = 'test_secret_key';
    const timestamp = '1704067200';

    const sign = await generateFeishuSign(secret, timestamp);

    // Should be a non-empty base64 string
    expect(sign).toBeTruthy();
    expect(typeof sign).toBe('string');
    // Base64 characters only
    expect(sign).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('deterministic - same input produces same output', async () => {
    const secret = 'deterministic_secret';
    const timestamp = '1704067200';

    const sign1 = await generateFeishuSign(secret, timestamp);
    const sign2 = await generateFeishuSign(secret, timestamp);

    expect(sign1).toBe(sign2);
  });

  test('handles empty secret gracefully by returning empty string', async () => {
    const sign = await generateFeishuSign('', '1704067200');
    expect(sign).toBe('');
  });

  test('produces correct length output (base64 of SHA-256 = 43-44 chars)', async () => {
    const secret = 'length_test_secret';
    const timestamp = '1704067200';

    const sign = await generateFeishuSign(secret, timestamp);

    // HMAC-SHA256 produces 32 bytes -> base64 encodes to 44 chars (with possible padding)
    expect(sign.length).toBeGreaterThanOrEqual(43);
    expect(sign.length).toBeLessThanOrEqual(44);
  });

  test('differs from DingTalk signing algorithm for same inputs', async () => {
    // This test proves the signing algorithms are correctly different
    const { generateSign: generateDingtalkSign } = await import('../src/dingtalk');

    const secret = 'shared_secret';
    const feishuTimestamp = '1704067200'; // seconds
    const dingtalkTimestamp = '1704067200000'; // milliseconds

    const feishuSign = await generateFeishuSign(secret, feishuTimestamp);
    const dingtalkSign = await generateDingtalkSign(secret, dingtalkTimestamp);

    // Both produce valid signatures but they must be different algorithms
    expect(feishuSign).toBeTruthy();
    expect(dingtalkSign).toBeTruthy();
    // Different algorithms produce different outputs
    expect(feishuSign).not.toBe(dingtalkSign);
  });
});

// ══════════════════════════════════════════════════════════
// createFeishuFormatter
// ══════════════════════════════════════════════════════════

describe('createFeishuFormatter', () => {
  let createFeishuFormatter: typeof import('../src/feishu').createFeishuFormatter;
  let formatter: ReturnType<typeof createFeishuFormatter>;

  beforeAll(async () => {
    ({ createFeishuFormatter } = await import('../src/feishu'));
  });

  beforeEach(() => {
    formatter = createFeishuFormatter(createMockFeishuConfig());
  });

  /** Helper to narrow FormattedMessage to Feishu interactive card shape */
  function card(result: ReturnType<ChannelFormatter['format']>): FeishuInteractiveMessage {
    return result as unknown as FeishuInteractiveMessage;
  }

  test('subject becomes card header title (truncated at 100 chars with "...")', () => {
    const longSubject = 'A'.repeat(150);
    const result = card(formatter.format(longSubject, 'body text', dummyPayload));

    expect(result.card.header.title.content).toHaveLength(103); // 100 + '...'
    expect(result.card.header.title.content).toBe('A'.repeat(100) + '...');
  });

  test('short subject is not truncated', () => {
    const shortSubject = 'Hello World';
    const result = card(formatter.format(shortSubject, 'body text', dummyPayload));

    expect(result.card.header.title.content).toBe('Hello World');
  });

  test('body key:value lines become bold labels (**key**: value)', () => {
    const body = 'Project: myapp\nStatus: completed\nDuration: 5m';
    const result = card(formatter.format('Test', body, dummyPayload));

    const text = result.card.elements[0].text.content;
    expect(text).toContain('**Project**: myapp');
    expect(text).toContain('**Status**: completed');
    expect(text).toContain('**Duration**: 5m');
  });

  test('error content wrapped in code blocks', () => {
    const body = 'An error occurred during execution\nStack trace follows\n  at file.ts:10';
    const result = card(formatter.format('Error Test', body, dummyPayload));

    const text = result.card.elements[0].text.content;
    expect(text).toContain('```');
    expect(text).toMatch(/```\n.*error occurred.*\n```/s);
  });

  test('long content truncated at 4000 chars with "... (truncated)" suffix', () => {
    const longBody = 'X'.repeat(5000);
    const result = card(formatter.format('Short Title', longBody, dummyPayload));

    const text = result.card.elements[0].text.content;
    // Should be truncated: 3800 kept + "\n... (truncated)"
    expect(text.length).toBeLessThanOrEqual(3800 + '\n... (truncated)'.length);
    expect(text).toContain('... (truncated)');
  });

  test('output has msg_type "interactive"', () => {
    const result = card(formatter.format('Subject', 'Body content', dummyPayload));

    expect(result.msg_type).toBe('interactive');
  });

  test('output contains card.header and card.elements', () => {
    const result = card(formatter.format('Subject', 'Body content', dummyPayload));

    expect(result.card).toBeDefined();
    expect(result.card.header).toBeDefined();
    expect(result.card.elements).toBeDefined();
    expect(result.card.elements.length).toBeGreaterThan(0);
  });

  test('normal lines passed through without escaping', () => {
    // Feishu lark_md does NOT need DingTalk's 17-char escaping
    const body = 'Just a normal message\nAnother line';
    const result = card(formatter.format('Test', body, dummyPayload));

    const text = result.card.elements[0].text.content;
    expect(text).toContain('Just a normal message');
    expect(text).toContain('Another line');
    // No bold formatting for non-kv lines
    expect(text).not.toContain('**Just**');
  });
});

// ══════════════════════════════════════════════════════════
// createFeishuSender
// ══════════════════════════════════════════════════════════

describe('createFeishuSender', () => {
  let createFeishuSender: typeof import('../src/feishu').createFeishuSender;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    ({ createFeishuSender } = await import('../src/feishu'));
  });

  beforeEach(() => {
    originalFetch = setupMockFetch();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  test('returns null for non-feishu channel type', async () => {
    const channel: Channel = {
      type: 'smtp',
      enabled: true,
      name: 'SMTP Channel',
      config: {
        host: 'smtp.test.com',
        port: 465,
        secure: true,
        auth: { user: 'test@test.com', pass: 'pass' },
      },
      recipients: ['user@test.com'],
      events: { created: true },
    };

    const sender = await createFeishuSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for disabled channel (enabled: false)', async () => {
    const channel = createMockFeishuChannel({ enabled: false });

    const sender = await createFeishuSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for missing webhook URL', async () => {
    const channel = createMockFeishuChannel({
      config: { webhook: '' },
    });

    const sender = await createFeishuSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for invalid webhook URL (ftp://)', async () => {
    const channel = createMockFeishuChannel({
      config: { webhook: 'ftp://invalid-url.com/webhook' },
    });

    const sender = await createFeishuSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for webhook without protocol', async () => {
    const channel = createMockFeishuChannel({
      config: { webhook: 'open.feishu.cn/open-apis/bot/v2/hook/test' },
    });

    const sender = await createFeishuSender(channel);
    expect(sender).toBeNull();
  });

  test('returns valid sender for well-formed feishu config', async () => {
    const channel = createMockFeishuChannel();

    const sender = await createFeishuSender(channel);
    expect(sender).not.toBeNull();
    expect(typeof sender!.send).toBe('function');
    expect(typeof sender!.close).toBe('function');
  });

  test('sender.send() calls fetch POST to correct webhook URL', async () => {
    const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123';
    const channel = createMockFeishuChannel({
      config: { webhook },
    });

    const sender = await createFeishuSender(channel);
    expect(sender).not.toBeNull();

    const message = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: 'Test' },
          template: 'blue',
        },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'Body' } }],
      },
    };

    await sender!.send(message);

    expect(capturedFetchCalls).toHaveLength(1);
    expect(capturedFetchCalls[0].url).toBe(webhook);
  });

  test('sender.send() includes timestamp and sign in body when secret configured', async () => {
    const channel = createMockFeishuChannel({
      config: {
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/token',
        secret: 'my_secret_key',
      },
    });

    const sender = await createFeishuSender(channel);
    await sender!.send({
      msg_type: 'interactive',
      card: {
        config: {},
        header: { title: { tag: 'plain_text', content: 'T' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'B' } }],
      },
    });

    expect(capturedFetchCalls).toHaveLength(1);
    const body = JSON.parse(capturedFetchCalls[0].options.body as string);

    // Feishu puts sign in the body, not in the URL
    expect(body.timestamp).toBeDefined();
    expect(body.sign).toBeDefined();
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.sign).toBe('string');
    expect(body.sign).toBeTruthy();

    // Verify sign is NOT in the URL (unlike DingTalk)
    const url = capturedFetchCalls[0].url;
    expect(url).not.toContain('sign=');
    expect(url).not.toContain('timestamp=');
  });

  test('sender.send() does NOT include timestamp and sign when no secret', async () => {
    const channel = createMockFeishuChannel({
      config: {
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/nosecret',
      },
    });

    const sender = await createFeishuSender(channel);
    await sender!.send({
      msg_type: 'interactive',
      card: {
        config: {},
        header: { title: { tag: 'plain_text', content: 'T' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'B' } }],
      },
    });

    const body = JSON.parse(capturedFetchCalls[0].options.body as string);
    expect(body.timestamp).toBeUndefined();
    expect(body.sign).toBeUndefined();
  });

  test('sender.send() handles success response (code=0) without throwing', async () => {
    setupMockFetch({ json: { code: 0, msg: 'success' } });

    const channel = createMockFeishuChannel();
    const sender = await createFeishuSender(channel);

    await expect(sender!.send({
      msg_type: 'interactive',
      card: {
        config: {},
        header: { title: { tag: 'plain_text', content: 'OK' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'Success' } }],
      },
    })).resolves.toBeUndefined();

    expect(capturedFetchCalls).toHaveLength(1);
  });

  test('sender.send() silently fails on network error (no throw)', async () => {
    setupMockFetch(undefined, new Error('Network connection failed'));

    const channel = createMockFeishuChannel();
    const sender = await createFeishuSender(channel);

    // Should NOT throw despite network error
    await expect(sender!.send({
      msg_type: 'interactive',
      card: {
        config: {},
        header: { title: { tag: 'plain_text', content: 'Err' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'Fail' } }],
      },
    })).resolves.toBeUndefined();
  });

  test('sender.send() handles API error response (code != 0) silently', async () => {
    setupMockFetch({ json: { code: 19001, msg: 'invalid sign' } });

    const channel = createMockFeishuChannel({ name: 'ApiErrorChannel' });
    const sender = await createFeishuSender(channel);

    // Should not throw even on API error
    await expect(sender!.send({
      msg_type: 'interactive',
      card: {
        config: {},
        header: { title: { tag: 'plain_text', content: 'ApiErr' }, template: 'blue' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'Bad sign' } }],
      },
    })).resolves.toBeUndefined();
  });

  test('sender.close() resolves without error', async () => {
    const channel = createMockFeishuChannel();
    const sender = await createFeishuSender(channel);

    await expect(sender!.close()).resolves.toBeUndefined();
  });

  test('sender.send() ignores non-interactive messages silently', async () => {
    const channel = createMockFeishuChannel();
    const sender = await createFeishuSender(channel);

    // Send a non-interactive message - should be ignored
    await sender!.send({ msg_type: 'text', text: 'plain text' });

    // No fetch call should have been made
    expect(capturedFetchCalls).toHaveLength(0);
  });

  test('sender.send() sends POST request with JSON body and correct headers', async () => {
    const channel = createMockFeishuChannel();
    const sender = await createFeishuSender(channel);

    const message = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: 'Headers Test' },
          template: 'blue',
        },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'Check headers' } }],
      },
    };

    await sender!.send(message);

    expect(capturedFetchCalls).toHaveLength(1);
    const { options } = capturedFetchCalls[0];
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(options.body as string);
    expect(body.msg_type).toBe('interactive');
    expect(body.card).toBeDefined();
  });
});
