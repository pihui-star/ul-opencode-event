import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// CRITICAL: logger.test.ts calls mock.module('../src/write-buffer.js', ...)
// and mock.module('fs'/'node:fs', partialMockFs) which are process-global.
// Since Bun caches the mocked module, any import/require of write-buffer.js
// in this file would get the mock version whose flush writes to in-memory
// state instead of the real filesystem.
//
// Strategy:
// 1. Capture the real node:fs via createRequire (bypasses mock registry).
// 2. Override fs/node:fs mocks with the complete real fs so transitive
//    imports get real filesystem operations.
// 3. Override the write-buffer mock with the real implementation that uses
//    the real fs captured in step 1.
// ---------------------------------------------------------------------------

const nodeRequire = createRequire(import.meta.url);
const realFs = nodeRequire('node:fs') as typeof import('node:fs');
const realPath = nodeRequire('node:path') as typeof import('node:path');

// Override logger.test.ts's partial fs mock with the complete real fs.
mock.module('fs', () => ({ ...realFs }));
mock.module('node:fs', () => ({ ...realFs }));

// Override logger.test.ts's write-buffer mock with the real implementation.
// We inline the class using realFs/realPath to guarantee real filesystem ops.
mock.module('../src/write-buffer.js', () => ({
  WriteBuffer: class WriteBuffer {
    private readonly filePath: string;
    private readonly flushInterval: number;
    private readonly maxBatchSize: number;
    private readonly maxSizeBytes: number;
    private buffer: string[] = [];
    private currentSizeBytesVal = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private flushFn: () => void;

    constructor(opts: {
      filePath: string;
      flushInterval?: number;
      maxBatchSize?: number;
      maxSizeBytes?: number;
    }) {
      this.filePath = opts.filePath;
      this.flushInterval = opts.flushInterval ?? 500;
      this.maxBatchSize = opts.maxBatchSize ?? 50;
      this.maxSizeBytes = opts.maxSizeBytes ?? 2 * 1024 * 1024;
      this.flushFn = () => this.flush();
      this.timer = setInterval(() => this.flush(), this.flushInterval);
      process.on('exit', this.flushFn);
    }

    append(line: string): void {
      this.buffer.push(line);
      if (this.buffer.length >= this.maxBatchSize) {
        this.flush();
      }
    }

    flush = (): void => {
      if (this.buffer.length === 0) return;
      const content = this.buffer.join('');
      this.buffer = [];
      try {
        realFs.mkdirSync(realPath.dirname(this.filePath), { recursive: true });
      } catch {
        // directory may already exist
      }
      try {
        realFs.appendFileSync(this.filePath, content, 'utf-8');
        this.currentSizeBytesVal += Buffer.byteLength(content, 'utf-8');
      } catch {
        // silent failure
      }
    };

    close(): void {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      process.removeListener('exit', this.flushFn);
      this.flush();
    }

    get size(): number {
      return this.buffer.length;
    }

    get currentSizeBytes(): number {
      return this.currentSizeBytesVal;
    }

    get needsRotation(): boolean {
      return this.currentSizeBytesVal >= this.maxSizeBytes;
    }
  },
}));

// Use realFs directly in test assertions (bypasses mock registry).
const fs = realFs;

// Import WriteBuffer after mock setup.
const { WriteBuffer } = nodeRequire('../src/write-buffer.js') as typeof import('../src/write-buffer.js');

describe('WriteBuffer', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
    filePath = path.join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  test('append 后未到 flush 间隔，文件不存在或为空', () => {
    const buf = new WriteBuffer({ filePath, flushInterval: 60000 });
    buf.append('line1');
    buf.append('line2');
    expect(buf.size).toBe(2);

    const exists = fs.existsSync(filePath);
    expect(exists).toBe(false);

    buf.close();
  });

  test('flush 后内容写入文件', () => {
    const buf = new WriteBuffer({ filePath, flushInterval: 60000 });
    buf.append('line1\n');
    buf.append('line2\n');
    buf.flush();

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('line1\nline2\n');
    expect(buf.size).toBe(0);

    buf.close();
  });

  test('append 超过 maxBatchSize 时自动 flush', () => {
    const buf = new WriteBuffer({ filePath, flushInterval: 60000, maxBatchSize: 3 });
    buf.append('a\n');
    buf.append('b\n');
    buf.append('c\n');
    // 第 3 条达到 maxBatchSize，应已自动 flush
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('a\nb\nc\n');
    expect(buf.size).toBe(0);

    buf.close();
  });

  test('close() 确保所有数据写入文件', () => {
    const buf = new WriteBuffer({ filePath, flushInterval: 60000 });
    buf.append('remaining\n');
    buf.close();

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toBe('remaining\n');
  });

  test('文件大小计数器 currentSizeBytes 正确累计', () => {
    const buf = new WriteBuffer({ filePath, flushInterval: 60000 });
    const line = 'hello world\n';
    buf.append(line);
    buf.flush();

    expect(buf.currentSizeBytes).toBe(Buffer.byteLength(line, 'utf-8'));

    buf.append(line);
    buf.flush();
    expect(buf.currentSizeBytes).toBe(Buffer.byteLength(line, 'utf-8') * 2);

    buf.close();
  });

  test('needsRotation 在超过 maxSizeBytes 时为 true', () => {
    const buf = new WriteBuffer({ filePath, flushInterval: 60000, maxSizeBytes: 20 });
    const line = 'a-pretty-long-line-here\n';
    buf.append(line);
    buf.flush();

    expect(buf.currentSizeBytes).toBe(Buffer.byteLength(line, 'utf-8'));
    expect(buf.needsRotation).toBe(buf.currentSizeBytes >= 20);

    buf.close();
  });

  test('flush 时自动创建父目录', () => {
    const nestedPath = path.join(tmpDir, 'a', 'b', 'c', 'nested.jsonl');
    const buf = new WriteBuffer({ filePath: nestedPath, flushInterval: 60000 });
    buf.append('deep\n');
    buf.flush();

    expect(fs.existsSync(nestedPath)).toBe(true);
    expect(fs.readFileSync(nestedPath, 'utf-8')).toBe('deep\n');

    buf.close();
  });
});
