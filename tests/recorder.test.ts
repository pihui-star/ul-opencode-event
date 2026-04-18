import { describe, test, expect, afterAll, afterEach, beforeAll } from 'bun:test';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as os from 'node:os';

// Use createRequire to get the REAL fs module, just like recorder.ts does.
// This prevents mock.module('fs') from other test files (logger.test.ts, updater.test.ts)
// from breaking our fs operations.
const nodeRequire = createRequire(import.meta.url);
const fs = nodeRequire('node:fs') as typeof import('node:fs');

// ---------------------------------------------------------------------------
// Setup
//
// The recorder module is a singleton - filePath gets lazily cached on first
// call to getFilePath(). Since other test files (handler.test.ts -> handler.ts
// -> recorder.ts) load the module before us, and may have already triggered
// getFilePath(), filePath could be cached to the default homedir path.
//
// Our strategy: set OPENCODE_DATA_DIR BEFORE importing recorder, but also
// handle the case where filePath is already cached by detecting the actual
// file path the recorder is writing to.
// ---------------------------------------------------------------------------

// Set env before import (may not take effect if filePath already cached)
const TEMP_DIR = path.join(os.tmpdir(), `recorder-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
process.env.OPENCODE_DATA_DIR = TEMP_DIR;

// Import recorder module
const recorder = await import('../src/recorder.js');

// The recorder's filePath may be cached to a different path than our TEMP_DIR
// if other tests already triggered getFilePath(). Detect the actual path by
// calling recordEventVariables and seeing where the file appears.
function detectRecorderFilePath(): string {
  const marker = `__detect_${Date.now()}_${Math.random().toString(36).slice(2, 6)}__`;

  // Try our TEMP_DIR first
  const tempPath = path.join(TEMP_DIR, 'ul-opencode-event-variables.jsonl');

  // Call recordEventVariables to trigger lazy init
  recorder.recordEventVariables({ eventType: 'detect', __marker: marker });

  // Check if file appeared in TEMP_DIR
  if (fs.existsSync(tempPath)) {
    return tempPath;
  }

  // Otherwise filePath was cached to the default path
  const defaultBase = path.join(os.homedir(), '.local', 'share', 'opencode');
  const defaultPath = path.join(defaultBase, 'ul-opencode-event-variables.jsonl');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  // Fallback - shouldn't happen but just in case
  return tempPath;
}

let RECORDER_FILE: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileLines(): string[] {
  const content = fs.readFileSync(RECORDER_FILE, 'utf-8');
  return content.trim().split('\n').filter(line => line.length > 0 && !line.startsWith('[TRUNCATED]'));
}

function removeRecorderFile(): void {
  try {
    fs.unlinkSync(RECORDER_FILE);
  } catch {
    // File may not exist
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recorder', () => {
  beforeAll(() => {
    RECORDER_FILE = detectRecorderFilePath();

    // Remove the detection marker file to start clean
    removeRecorderFile();
  });

  afterAll(() => {
    // Clean up temp dir if we created it
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
    // Clean up default path test data
    try {
      const defaultPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'ul-opencode-event-variables.jsonl');
      if (fs.existsSync(defaultPath)) {
        // Only remove if it was created by our tests (contains our markers)
        const content = fs.readFileSync(defaultPath, 'utf-8');
        if (content.includes('"__recorder_test__"')) {
          fs.unlinkSync(defaultPath);
        }
      }
    } catch {
      // Best effort
    }
    delete process.env.OPENCODE_DATA_DIR;
  });

  afterEach(() => {
    removeRecorderFile();
  });

  test('first write creates the file', () => {
    expect(fs.existsSync(RECORDER_FILE)).toBe(false);

    recorder.recordEventVariables({
      eventType: 'idle',
      timestamp: '2024-01-01T00:00:00Z',
      projectName: 'test',
      __recorder_test__: 'yes',
    });

    expect(fs.existsSync(RECORDER_FILE)).toBe(true);
    const lines = readFileLines();
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.eventType).toBe('idle');
    expect(parsed.timestamp).toBe('2024-01-01T00:00:00Z');
    expect(parsed.projectName).toBe('test');
  });

  test('multiple writes append lines', () => {
    recorder.recordEventVariables({ eventType: 'created', timestamp: '2024-01-01T00:00:01Z', __recorder_test__: 'yes' });
    recorder.recordEventVariables({ eventType: 'idle', timestamp: '2024-01-01T00:00:02Z', __recorder_test__: 'yes' });
    recorder.recordEventVariables({ eventType: 'error', timestamp: '2024-01-01T00:00:03Z', __recorder_test__: 'yes' });

    const lines = readFileLines();
    expect(lines.length).toBe(3);

    const first = JSON.parse(lines[0]);
    expect(first.eventType).toBe('created');

    const second = JSON.parse(lines[1]);
    expect(second.eventType).toBe('idle');

    const third = JSON.parse(lines[2]);
    expect(third.eventType).toBe('error');
  });

  test('undefined fields are omitted from JSON output', () => {
    recorder.recordEventVariables({
      eventType: 'idle',
      error: undefined,
      message: undefined,
      __recorder_test__: 'yes',
    });

    const lines = readFileLines();
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.eventType).toBe('idle');
    expect(parsed).not.toHaveProperty('error');
    expect(parsed).not.toHaveProperty('message');
  });

  test('rotation: file exceeding 2MB gets truncated', () => {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(RECORDER_FILE), { recursive: true });

    // Pre-fill the file to exceed 2MB with valid JSON lines
    const bigLine = JSON.stringify({ eventType: 'idle', padding: 'x'.repeat(2000), __recorder_test__: 'yes' }) + '\n';
    const linesNeeded = Math.ceil((2 * 1024 * 1024) / bigLine.length) + 10;

    const fd = fs.openSync(RECORDER_FILE, 'w');
    for (let i = 0; i < linesNeeded; i++) {
      fs.writeSync(fd, bigLine);
    }
    fs.closeSync(fd);

    const sizeBefore = fs.statSync(RECORDER_FILE).size;
    expect(sizeBefore).toBeGreaterThanOrEqual(2 * 1024 * 1024);

    // Now call recordEventVariables - should trigger rotation
    recorder.recordEventVariables({ eventType: 'error', timestamp: '2024-01-01T00:00:00Z', trigger: 'rotation-test', __recorder_test__: 'yes' });

    const content = fs.readFileSync(RECORDER_FILE, 'utf-8');
    // After rotation, file starts with TRUNCATE_MARKER
    expect(content.startsWith('[TRUNCATED] ... old records dropped\n')).toBe(true);

    // The new line should be at the end
    const lines = content.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const lastParsed = JSON.parse(lastLine);
    expect(lastParsed.eventType).toBe('error');
    expect(lastParsed.trigger).toBe('rotation-test');
  });

  test('error tolerance: does not throw', () => {
    // The recorder is designed to never throw. Test this by calling it
    // repeatedly - it should always succeed regardless of state.
    expect(() => {
      recorder.recordEventVariables({ eventType: 'idle', timestamp: '2024-01-01T00:00:00Z', __recorder_test__: 'yes' });
    }).not.toThrow();

    // Verify it wrote successfully
    expect(fs.existsSync(RECORDER_FILE)).toBe(true);
  });

  test('directory auto-creation', () => {
    // The recorder's lazy init creates the directory on first write.
    // Verify the directory exists after writing.
    removeRecorderFile();

    recorder.recordEventVariables({ eventType: 'created', autoCreate: 'yes', __recorder_test__: 'yes' });

    // File should exist (directory was created by recorder's ensureDir)
    expect(fs.existsSync(RECORDER_FILE)).toBe(true);

    const dir = path.dirname(RECORDER_FILE);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  test('full variable recording with all fields', () => {
    const fullVariables: Record<string, string | undefined> = {
      eventType: 'idle',
      timestamp: '2024-01-15T10:30:00Z',
      projectName: 'test-project',
      projectPath: '/home/user/test-project',
      sessionId: 'ses_abc123',
      sessionTitle: 'Test Session',
      message: 'Task completed successfully',
      duration: '5m 30s',
      sessionType: 'main',
      modelID: 'claude-sonnet-4',
      providerID: 'anthropic',
      mode: 'code',
      currency: 'USD',
      sessionCost: '0.0012',
      sessionCostFormatted: '$0.0012',
      totalCostFormatted: '$0.0025',
      totalCost: '0.0025',
      sessionTokensInput: '50000',
      sessionTokensOutput: '12000',
      sessionTokensReasoning: '3000',
      sessionTokensCacheRead: '5000',
      sessionTokensCacheWrite: '1500',
      sessionTokensTotal: '71500',
      sessionTokensInputHuman: '50.0K',
      sessionTokensOutputHuman: '12.0K',
      sessionTokensReasoningHuman: '3.0K',
      sessionTokensCacheReadHuman: '5.0K',
      sessionTokensCacheWriteHuman: '1.5K',
      sessionTokensTotalHuman: '71.5K',
      totalTokensInput: '100000',
      totalTokensOutput: '25000',
      totalTokensReasoning: '8000',
      totalTokensCacheRead: '12000',
      totalTokensCacheWrite: '3000',
      totalTokensTotal: '148000',
      totalTokensInputHuman: '100.0K',
      totalTokensOutputHuman: '25.0K',
      totalTokensReasoningHuman: '8.0K',
      totalTokensCacheReadHuman: '12.0K',
      totalTokensCacheWriteHuman: '3.0K',
      totalTokensTotalHuman: '148.0K',
      title: 'My Title',
      questionText: 'What is the answer?',
      options: 'yes,no',
      permissionType: 'file_write',
      statusType: 'running',
      commandName: 'build',
      arguments: '--production',
      filePath: '/src/index.ts',
      todoSummary: '3/5 complete',
      parentSessionId: 'ses_parent_001',
      error: undefined,
      __recorder_test__: 'yes',
    };

    recorder.recordEventVariables(fullVariables);

    const lines = readFileLines();
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);

    // Verify all expected keys are present
    const expectedKeys = [
      'eventType', 'timestamp', 'projectName', 'projectPath', 'sessionId',
      'sessionTitle', 'message', 'duration', 'sessionType', 'modelID',
      'providerID', 'mode', 'currency', 'sessionCost', 'sessionCostFormatted',
      'totalCostFormatted', 'totalCost', 'sessionTokensInput', 'sessionTokensOutput',
      'sessionTokensReasoning', 'sessionTokensCacheRead', 'sessionTokensCacheWrite',
      'sessionTokensTotal', 'sessionTokensInputHuman', 'sessionTokensOutputHuman',
      'sessionTokensReasoningHuman', 'sessionTokensCacheReadHuman',
      'sessionTokensCacheWriteHuman', 'sessionTokensTotalHuman',
      'totalTokensInput', 'totalTokensOutput', 'totalTokensReasoning',
      'totalTokensCacheRead', 'totalTokensCacheWrite', 'totalTokensTotal',
      'totalTokensInputHuman', 'totalTokensOutputHuman', 'totalTokensReasoningHuman',
      'totalTokensCacheReadHuman', 'totalTokensCacheWriteHuman', 'totalTokensTotalHuman',
      'title', 'questionText', 'options', 'permissionType', 'statusType',
      'commandName', 'arguments', 'filePath', 'todoSummary', 'parentSessionId',
    ];

    for (const key of expectedKeys) {
      expect(parsed).toHaveProperty(key);
    }

    // Verify undefined field was omitted
    expect(parsed).not.toHaveProperty('error');

    // Spot-check some values
    expect(parsed.eventType).toBe('idle');
    expect(parsed.modelID).toBe('claude-sonnet-4');
    expect(parsed.sessionTokensTotal).toBe('71500');
    expect(parsed.totalTokensTotalHuman).toBe('148.0K');
  });
});
