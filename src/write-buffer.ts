import * as fs from 'node:fs';
import * as path from 'node:path';

export interface WriteBufferOptions {
  filePath: string;
  flushInterval?: number;
  maxBatchSize?: number;
  maxSizeBytes?: number;
}

export class WriteBuffer {
  private readonly filePath: string;
  private readonly flushInterval: number;
  private readonly maxBatchSize: number;
  private readonly maxSizeBytes: number;
  private buffer: string[] = [];
  private currentSizeBytesVal = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: WriteBufferOptions) {
    this.filePath = opts.filePath;
    this.flushInterval = opts.flushInterval ?? 500;
    this.maxBatchSize = opts.maxBatchSize ?? 50;
    this.maxSizeBytes = opts.maxSizeBytes ?? 2 * 1024 * 1024;

    this.timer = setInterval(() => this.flush(), this.flushInterval);

    process.on('exit', this.flush);
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
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    } catch {
      // directory may already exist
    }

    try {
      fs.appendFileSync(this.filePath, content, 'utf-8');
      this.currentSizeBytesVal += Buffer.byteLength(content, 'utf-8');
    } catch {
      // silent failure, same pattern as logger.ts
    }
  };

  close(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.removeListener('exit', this.flush);
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
}
