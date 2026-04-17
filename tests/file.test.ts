import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import type { Channel, EventPayload } from '../src/types';

// Use REAL fs — no mock.module() in this file
// Use createRequire to bypass Bun's mock.module registry
const nodeRequire = createRequire(import.meta.url);
const nodeFs = nodeRequire('node:fs') as typeof import('node:fs');

let createFileSender: typeof import('../src/file').createFileSender;
let createFileFormatter: typeof import('../src/file').createFileFormatter;
let DEFAULT_FILE_MAX_SIZE: number;
let DEFAULT_FILE_PATH: string;

let tempDir: string;

beforeAll(async () => {
  const mod = await import('../src/file');
  createFileSender = mod.createFileSender;
  createFileFormatter = mod.createFileFormatter;
  DEFAULT_FILE_MAX_SIZE = mod.DEFAULT_FILE_MAX_SIZE;
  DEFAULT_FILE_PATH = mod.DEFAULT_FILE_PATH;

  // Create temp dir manually to avoid mkdtempSync issues with mock leakage
  tempDir = path.join(os.tmpdir(), `ul-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  nodeFs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  // Clean up temp directory
  try {
    nodeFs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures
  }
});

const samplePayload: EventPayload = {
  eventType: 'idle',
  timestamp: '2026-04-17T00:00:00Z',
  projectName: 'test-project',
  sessionId: 'session-123',
  sessionType: 'main',
};

describe('createFileFormatter', () => {
  test('returns formatter with subject, body, and payload merged', () => {
    const formatter = createFileFormatter();
    const result = formatter.format('Test Subject', 'Test Body', samplePayload);

    expect(result.subject).toBe('Test Subject');
    expect(result.body).toBe('Test Body');
    expect(result.eventType).toBe('idle');
    expect(result.projectName).toBe('test-project');
    expect(result.sessionId).toBe('session-123');
  });
});

describe('createFileSender', () => {
  test('returns null for non-file channel type', async () => {
    const channel: Channel = {
      type: 'smtp',
      enabled: true,
      name: 'test-smtp',
      config: { host: 'smtp.test.com', port: 465, auth: { user: 'a', pass: 'b' } },
      events: {},
    };
    const sender = await createFileSender(channel);
    expect(sender).toBeNull();
  });

  test('returns null for disabled channel', async () => {
    const channel: Channel = {
      type: 'file',
      enabled: false,
      name: 'disabled-file',
      config: {},
      events: {},
    };
    const sender = await createFileSender(channel);
    expect(sender).toBeNull();
  });

  test('returns sender for valid file channel', async () => {
    const filePath = path.join(tempDir, 'valid-test.log');
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'valid-file',
      config: { filePath, maxSizeBytes: 1048576 },
      events: {},
    };
    const sender = await createFileSender(channel);
    expect(sender).not.toBeNull();
  });

  test('writes message as JSON line to file', async () => {
    const filePath = path.join(tempDir, 'write-test.log');
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'write-file',
      config: { filePath, maxSizeBytes: 1048576 },
      events: {},
    };
    const sender = await createFileSender(channel);
    await sender!.send({ subject: 'Hello', body: 'World', eventType: 'idle' });

    const content = nodeFs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.subject).toBe('Hello');
    expect(parsed.body).toBe('World');
  });

  test('appends multiple messages as JSON Lines', async () => {
    const filePath = path.join(tempDir, 'multi-write.log');
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'multi-file',
      config: { filePath, maxSizeBytes: 1048576 },
      events: {},
    };
    const sender = await createFileSender(channel);

    await sender!.send({ msg: 1 });
    await sender!.send({ msg: 2 });
    await sender!.send({ msg: 3 });

    const content = nodeFs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).msg).toBe(1);
    expect(JSON.parse(lines[1]).msg).toBe(2);
    expect(JSON.parse(lines[2]).msg).toBe(3);
  });

  test('auto-creates directory if it does not exist', async () => {
    const nestedDir = path.join(tempDir, 'nested', 'deep', 'dir');
    const filePath = path.join(nestedDir, 'auto-dir-test.log');
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'auto-dir-file',
      config: { filePath, maxSizeBytes: 1048576 },
      events: {},
    };
    const sender = await createFileSender(channel);
    await sender!.send({ test: 'auto-dir' });

    expect(nodeFs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(nodeFs.readFileSync(filePath, 'utf-8').trim());
    expect(parsed.test).toBe('auto-dir');
  });

  test('rotates file when size exceeds maxSizeBytes', async () => {
    const filePath = path.join(tempDir, 'rotate-test.log');
    const maxSize = 200; // Very small to trigger rotation quickly
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'rotate-file',
      config: { filePath, maxSizeBytes: maxSize },
      events: {},
    };
    const sender = await createFileSender(channel);

    // Write enough data to exceed the max size
    for (let i = 0; i < 50; i++) {
      await sender!.send({ index: i, padding: 'x'.repeat(20) });
    }

    const content = nodeFs.readFileSync(filePath, 'utf-8');
    // File should contain TRUNCATE marker after rotation
    expect(content).toContain('[TRUNCATED]');
    // File should be smaller than total written data (50 lines * ~50 chars = ~2500 chars)
    expect(content.length).toBeLessThan(2500);
  });

  test('silent error handling - does not throw on write failure', async () => {
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'error-file',
      config: { filePath: '/nonexistent/path/that/should/fail/test.log', maxSizeBytes: 1048576 },
      events: {},
    };
    const sender = await createFileSender(channel);

    // Should NOT throw — errors are caught and logged
    await expect(sender!.send({ test: 'error' })).resolves.toBeUndefined();
  });

  test('close is a no-op', async () => {
    const filePath = path.join(tempDir, 'close-test.log');
    const channel: Channel = {
      type: 'file',
      enabled: true,
      name: 'close-file',
      config: { filePath, maxSizeBytes: 1048576 },
      events: {},
    };
    const sender = await createFileSender(channel);
    // Should NOT throw
    await expect(sender!.close()).resolves.toBeUndefined();
  });
});

describe('constants', () => {
  test('DEFAULT_FILE_MAX_SIZE is 1048576 (1MB)', () => {
    expect(DEFAULT_FILE_MAX_SIZE).toBe(1048576);
  });

  test('DEFAULT_FILE_PATH points to opencode data directory', () => {
    expect(DEFAULT_FILE_PATH).toContain('opencode');
    expect(DEFAULT_FILE_PATH).toContain('ul-opencode-event-messages.log');
  });
});
