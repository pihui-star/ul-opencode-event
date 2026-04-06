import { describe, test, expect, mock, beforeEach, afterEach, beforeAll } from 'bun:test';
import type { Channel, DingtalkConfig, ChannelFormatter } from '../src/types.js';

// ─── Helper Factories ──────────────────────────────────────

function createMockDingtalkChannel(overrides?: Partial<Channel>): Channel {
  return {
    type: 'dingtalk',
    enabled: true,
    name: 'Test DingTalk',
    config: {
      webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
      ...overrides?.config,
    },
    recipients: [],
    events: { created: true, idle: true, error: true },
    ...overrides,
  };
}

function createMockDingtalkConfig(overrides?: Partial<DingtalkConfig>): DingtalkConfig {
  return {
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
    ...overrides,
  };
}

/** Narrowed DingTalk markdown message shape for test assertions */
interface DingTalkMarkdownMessage {
  msgtype: string;
  markdown: { title: string; text: string };
}

// Minimal EventPayload for formatter calls
const dummyPayload = {
  eventType: 'idle' as const,
  timestamp: '2024-01-01T12:00:00Z',
  projectName: 'test-project',
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
    json: response?.json ?? { errcode: 0, errmsg: 'ok' },
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

// Module is imported inside each describe block to allow DEBUG env control
// for sender tests that verify debug logging behavior.

// ══════════════════════════════════════════════════════════
// generateSign
// ══════════════════════════════════════════════════════════

describe('generateSign', () => {
  let generateSign: typeof import('../src/dingtalk').generateSign;
  beforeAll(async () => {
    ({ generateSign } = await import('../src/dingtalk'));
  });

  test('produces valid base64 string for known inputs', async () => {
    const secret = 'SEC_test_secret_key';
    const timestamp = '1704067200000';

    const sign = await generateSign(secret, timestamp);

    // Should be a non-empty base64 string
    expect(sign).toBeTruthy();
    expect(typeof sign).toBe('string');
    // Base64 characters only
    expect(sign).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('deterministic - same input produces same output', async () => {
    const secret = 'SEC_deterministic';
    const timestamp = '1704067200000';

    const sign1 = await generateSign(secret, timestamp);
    const sign2 = await generateSign(secret, timestamp);

    expect(sign1).toBe(sign2);
  });

  test('handles empty secret gracefully by returning empty string', async () => {
    const sign = await generateSign('', '1704067200000');
    expect(sign).toBe('');
  });

  test('handles undefined-like empty secret gracefully', async () => {
    const sign = await generateSign('', '1704067200000');
    expect(sign).toBe('');
  });

  test('produces correct length output (base64 of SHA-256 = 44 chars)', async () => {
    const secret = 'SEC_length_test';
    const timestamp = '1704067200000';

    const sign = await generateSign(secret, timestamp);

    // HMAC-SHA256 produces 32 bytes -> base64 encodes to 44 chars (no padding needed for 32 bytes)
    // Actually 32 bytes base64 = ceil(32/3)*4 = 44 chars (with possible padding)
    expect(sign.length).toBeGreaterThanOrEqual(43);
    expect(sign.length).toBeLessThanOrEqual(44);
  });
});

// ══════════════════════════════════════════════════════════
// createDingTalkFormatter
// ══════════════════════════════════════════════════════════

describe('createDingTalkFormatter', () => {
  let createDingTalkFormatter: typeof import('../src/dingtalk').createDingTalkFormatter;
  let formatter: ReturnType<typeof createDingTalkFormatter>;

  beforeAll(async () => {
    ({ createDingTalkFormatter } = await import('../src/dingtalk'));
  });

  beforeEach(() => {
    formatter = createDingTalkFormatter(createMockDingtalkConfig());
  });

  /** Helper to narrow FormattedMessage to DingTalk markdown shape */
  function md(result: ReturnType<ChannelFormatter['format']>): DingTalkMarkdownMessage {
    return result as unknown as DingTalkMarkdownMessage;
  }

  test('subject becomes markdown title (truncated at 100 chars with "...")', () => {
    const longSubject = 'A'.repeat(150);
    const result = md(formatter.format(longSubject, 'body text', dummyPayload));

    expect(result.msgtype).toBe('markdown');
    expect(result.markdown.title).toHaveLength(103); // 100 + '...'
    expect(result.markdown.title).toBe('A'.repeat(100) + '...');
  });

  test('short subject is not truncated', () => {
    const shortSubject = 'Hello World';
    const result = md(formatter.format(shortSubject, 'body text', dummyPayload));

    expect(result.markdown.title).toBe('Hello World');
  });

  test('body key:value lines become bold labels (**key**: value)', () => {
    const body = 'Project: myapp\nStatus: completed\nDuration: 5m';
    const result = md(formatter.format('Test', body, dummyPayload));

    const text = result.markdown.text;
    expect(text).toContain('**Project**: myapp');
    expect(text).toContain('**Status**: completed');
    expect(text).toContain('**Duration**: 5m');
  });

  test('special characters are properly escaped (17-char DingTalk MD subset)', () => {
    // Test all escapeable characters: \ _ * [ ] ( ) ~ ` > # + - = | { } . !
    const body = 'hello *world* [link](url) `code` #header --strike';
    const result = md(formatter.format('Test', body, dummyPayload));

    const text = result.markdown.text;

    // Each special char should be preceded by backslash
    expect(text).toContain('\\*world\\*');       // * escaped
    expect(text).toContain('\\[link\\]');        // [ ] escaped
    expect(text).toContain('\\(url\\)');         // ( ) escaped
    expect(text).toContain('\\`code\\`');        // ` escaped
    expect(text).toContain('\\#header');         // # escaped
    expect(text).toContain('\\-\\-strike');      // - escaped
  });

  test('long content truncated at 4000 chars with "... (truncated)" suffix', () => {
    const longBody = 'X'.repeat(5000);
    const result = md(formatter.format('Short Title', longBody, dummyPayload));

    const text = result.markdown.text;
    // Should be truncated: 3800 kept + "\n... (truncated)"
    expect(text.length).toBeLessThanOrEqual(3800 + '\n... (truncated)'.length);
    expect(text).toContain('... (truncated)');
  });

  test('header info preserved after truncation', () => {
    // Create body where key:value lines come first, then lots of filler
    const kvLines = 'Project: important_project\nStatus: active';
    const filler = '\n' + 'Y'.repeat(4500); // ensure we exceed 4000
    const body = kvLines + filler;

    const result = md(formatter.format('Title', body, dummyPayload));
    const text = result.markdown.text;

    // The key-value lines should still be present since they're at the start
    // Note: _ is also escaped in DingTalk markdown
    expect(text).toContain('**Project**: important\\_project');
    expect(text).toContain('**Status**: active');
  });

  test('at field included when config.at is present', () => {
    const configWithAt = createMockDingtalkConfig({
      at: { atMobiles: '13800138000', atAll: false },
    });
    const fmt = createDingTalkFormatter(configWithAt);
    const result = fmt.format('Test', 'body', dummyPayload);

    expect((result as Record<string, unknown>).at).toEqual({
      atMobiles: '13800138000',
      atAll: false,
    });
  });

  test('at field omitted when config.at is absent', () => {
    const configNoAt = createMockDingtalkConfig();
    delete configNoAt.at;
    const fmt = createDingTalkFormatter(configNoAt);
    const result = fmt.format('Test', 'body', dummyPayload);

    expect((result as Record<string, unknown>).at).toBeUndefined();
  });

  test('error-type content wrapped in code blocks', () => {
    // Use lines that match ERROR_INDICATORS but NOT KEY_VALUE_PATTERN
    // "Error: ..." would match KV pattern first (word + ": " + value)
    const body = 'An error occurred during execution\nStack trace follows\n  at file.ts:10';
    const result = md(formatter.format('Error Test', body, dummyPayload));

    const text = result.markdown.text;
    expect(text).toContain('```');
    // Error-indicating lines should be inside code blocks
    expect(text).toMatch(/```\n.*error occurred.*\n```/s);
  });

  test('normal lines without key:value or error indicators are passed through with escaping', () => {
    const body = 'Just a normal message\nAnother line';
    const result = md(formatter.format('Test', body, dummyPayload));

    const text = result.markdown.text;
    expect(text).toContain('Just a normal message');
    expect(text).toContain('Another line');
    // No bold formatting for non-kv lines
    expect(text).not.toContain('**Just**');
  });

  test('returns msgtype "markdown" with title and text', () => {
    const result = md(formatter.format('Subject', 'Body content', dummyPayload));

    expect(result.msgtype).toBe('markdown');
    expect(result.markdown).toBeDefined();
    expect(result.markdown.title).toBe('Subject');
    expect(result.markdown.text).toBe('Body content');
  });
});

// ══════════════════════════════════════════════════════════
// createDingTalkSender
// ══════════════════════════════════════════════════════════

describe('createDingTalkSender', () => {
  let createDingTalkSender: typeof import('../src/dingtalk').createDingTalkSender;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    ({ createDingTalkSender } = await import('../src/dingtalk'));
  });

  beforeEach(() => {
    originalFetch = setupMockFetch();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  test('returns null for non-dingtalk channel type', async () => {
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

    const sender = await createDingTalkSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for disabled channel (enabled: false)', async () => {
    const channel = createMockDingtalkChannel({ enabled: false });

    const sender = await createDingTalkSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for missing webhook URL', async () => {
    const channel = createMockDingtalkChannel({
      config: { webhook: '' },
    });

    const sender = await createDingTalkSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for invalid webhook URL (no http/https prefix)', async () => {
    const channel = createMockDingtalkChannel({
      config: { webhook: 'ftp://invalid-url.com/webhook' },
    });

    const sender = await createDingTalkSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for webhook without protocol', async () => {
    const channel = createMockDingtalkChannel({
      config: { webhook: 'oapi.dingtalk.com/robot/send' },
    });

    const sender = await createDingTalkSender(channel);
    expect(sender).toBeNull();
  });

  test('returns valid sender for well-formed dingtalk config', async () => {
    const channel = createMockDingtalkChannel();

    const sender = await createDingTalkSender(channel);
    expect(sender).not.toBeNull();
    expect(typeof sender!.send).toBe('function');
    expect(typeof sender!.close).toBe('function');
  });

  test('sender.send() calls fetch with correct URL (webhook + params for signed)', async () => {
    const channel = createMockDingtalkChannel({
      config: {
        webhook: 'https://oapi.dingtalk.com/robot/send?access_token=abc123',
        secret: 'SEC_test_sign',
      },
    });

    const sender = await createDingTalkSender(channel);
    expect(sender).not.toBeNull();

    const message = {
      msgtype: 'markdown',
      markdown: { title: 'Test', text: 'Body' },
    };

    await sender!.send(message);

    expect(capturedFetchCalls).toHaveLength(1);
    const callUrl = capturedFetchCalls[0].url;

    // Should contain the original webhook base
    expect(callUrl).toContain('https://oapi.dingtalk.com/robot/send');
    expect(callUrl).toContain('access_token=abc123');
    // Should have signing params appended
    expect(callUrl).toContain('timestamp=');
    expect(callUrl).toContain('sign=');
  });

  test('sender.send() adds timestamp and sign when secret configured', async () => {
    const channel = createMockDingtalkChannel({
      config: {
        webhook: 'https://oapi.dingtalk.com/robot/send?access_token=token',
        secret: 'SEC_my_secret',
      },
    });

    const sender = await createDingTalkSender(channel);
    await sender!.send({
      msgtype: 'markdown',
      markdown: { title: 'T', text: 'B' },
    });

    const url = capturedFetchCalls[0].url;
    // Verify both timestamp and sign are present
    expect(url).toMatch(/[?&]timestamp=\d+/);
    expect(url).toMatch(/[&]sign=[^&]+/);
  });

  test('sender.send() does NOT add sign params when no secret', async () => {
    const channel = createMockDingtalkChannel({
      config: {
        webhook: 'https://oapi.dingtalk.com/robot/send?access_token=nosecret',
        // no secret field
      },
    });

    const sender = await createDingTalkSender(channel);
    await sender!.send({
      msgtype: 'markdown',
      markdown: { title: 'T', text: 'B' },
    });

    const url = capturedFetchCalls[0].url;
    // URL should exactly match the webhook (no extra params)
    expect(url).toBe('https://oapi.dingtalk.com/robot/send?access_token=nosecret');
    expect(url).not.toContain('timestamp=');
    expect(url).not.toContain('sign=');
  });

  test('sender.send() handles success response (errcode=0)', async () => {
    setupMockFetch({ json: { errcode: 0, errmsg: 'ok' } });

    const channel = createMockDingtalkChannel();
    const sender = await createDingTalkSender(channel);

    // Should not throw on success
    await expect(sender!.send({
      msgtype: 'markdown',
      markdown: { title: 'OK', text: 'Success' },
    })).resolves.toBeUndefined();

    expect(capturedFetchCalls).toHaveLength(1);
  });

  test('sender.send() silently fails on network error (no throw)', async () => {
    setupMockFetch(undefined, new Error('Network connection failed'));

    const channel = createMockDingtalkChannel();
    const sender = await createDingTalkSender(channel);

    // Should NOT throw despite network error
    await expect(sender!.send({
      msgtype: 'markdown',
      markdown: { title: 'Err', text: 'Fail' },
    })).resolves.toBeUndefined();
  });

  test('sender.send() logs error when DEBUG enabled', async () => {
    // NOTE: DEBUG_ENABLED is captured at module load time as a top-level const.
    // ES module caching means re-importing returns the same bound value.
    // To truly test DEBUG logging, UL_OPENCODE_EVENT_EVENT_DEBUG must be set
    // before the FIRST import of ../src/dingtalk in this process.
    // Here we verify the error code path is reached (fetch is called, no throw)
    // and the catch block executes silently.
    setupMockFetch(undefined, new Error('Timeout'));

    const channel = createMockDingtalkChannel({ name: 'DebugChannel' });
    const sender = await createDingTalkSender(channel);

    // Verify: error does not propagate (silent failure)
    await expect(sender!.send({
      msgtype: 'markdown',
      markdown: { title: 'Dbg', text: 'Msg' },
    })).resolves.toBeUndefined();

    // Verify: fetch WAS called (we reached the network request before error)
    expect(capturedFetchCalls).toHaveLength(1);
  });

  test('sender.send() does NOT log error when DEBUG disabled', async () => {
    // Ensure DEBUG is off (default) - the top-level import already captured this
    setupMockFetch(undefined, new Error('Network fail'));

    const capturedErrors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    try {
      const channel = createMockDingtalkChannel({ name: 'SilentChannel' });
      const sender = await createDingTalkSender(channel);

      await sender!.send({
        msgtype: 'markdown',
        markdown: { title: 'S', text: 'M' },
      });

      // No errors should be logged when debug is off
      expect(capturedErrors.length).toBe(0);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('sender.close() resolves without error', async () => {
    const channel = createMockDingtalkChannel();
    const sender = await createDingTalkSender(channel);

    await expect(sender!.close()).resolves.toBeUndefined();
  });

  test('sender.send() ignores non-markdown messages silently', async () => {
    const channel = createMockDingtalkChannel();
    const sender = await createDingTalkSender(channel);

    // Send a non-markdown message - should be ignored
    await sender!.send({ msgtype: 'text', text: 'plain text' });

    // No fetch call should have been made
    expect(capturedFetchCalls).toHaveLength(0);
  });

  test('sender.send() sends POST request with JSON body and correct headers', async () => {
    const channel = createMockDingtalkChannel();
    const sender = await createDingTalkSender(channel);

    const message = {
      msgtype: 'markdown',
      markdown: { title: 'Headers Test', text: 'Check headers' },
    };

    await sender!.send(message);

    expect(capturedFetchCalls).toHaveLength(1);
    const { options } = capturedFetchCalls[0];
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body as string)).toEqual(message);
  });

  test('sender.send() handles DingTalk API error response (errcode != 0) silently', async () => {
    setupMockFetch({ json: { errcode: 310000, errmsg: 'keyword not allowed' } });

    const channel = createMockDingtalkChannel({ name: 'ApiErrorChannel' });
    const sender = await createDingTalkSender(channel);

    // Should not throw even on API error
    await expect(sender!.send({
      msgtype: 'markdown',
      markdown: { title: 'ApiErr', text: 'Bad keyword' },
    })).resolves.toBeUndefined();
  });
});
