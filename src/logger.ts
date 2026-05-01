/**
 * Production-grade file logger module.
 * Zero dependencies, ESM-only, uses WriteBuffer for batched I/O.
 *
 * Features:
 * - Log levels: debug / info / warn / error
 * - Auto-rotation: uses file-rotation.ts when estimated size exceeds limit
 * - Auto-detects log path from OPENCODE_DATA_DIR or OS default
 * - Silent failure: never throws from write/truncate (catch-all + console fallback)
 * - Buffered writes via WriteBuffer (500ms flush interval, auto-flush on exit)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WriteBuffer } from './write-buffer.js';
import { shouldRotate, rotateFile } from './file-rotation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  /** Log line prefix, default '[ul-opencode-event]' */
  prefix?: string;
  /** Absolute log file path; auto-detected when omitted */
  filePath?: string;
  /** Max file size in bytes before rotation, default 2 MB */
  maxSizeBytes?: number;
  /** Whether to emit DEBUG level logs */
  debugEnabled?: boolean;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PREFIX = '[ul-opencode-event]';
const DEFAULT_MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the absolute log file path. */
function resolveLogPath(filePath?: string): string {
  if (filePath) return filePath;

  const baseDir =
    process.env.OPENCODE_DATA_DIR ??
    path.join(os.homedir(), '.local', 'share', 'opencode');

  return path.join(baseDir, 'ul-opencode-event.log');
}

/** Ensure the parent directory exists (non-fatal). */
function ensureDir(filePath: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // Directory creation failure is non-fatal – WriteBuffer.flush will also
    // attempt mkdirSync, and if that also fails, the error is silently caught.
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createLogger(config?: LoggerConfig): Logger {
  const prefix = config?.prefix ?? DEFAULT_PREFIX;
  const filePath = resolveLogPath(config?.filePath);
  const maxSize = config?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const debugEnabled = config?.debugEnabled ?? false;

  // Ensure log directory exists on creation
  ensureDir(filePath);

  const buffer = new WriteBuffer({
    filePath,
    flushInterval: 500,
    maxSizeBytes: maxSize,
  });

  // Track estimated file size to avoid statSync on every write.
  // One-time statSync at creation; subsequent updates via byte counting.
  let estimatedSize = 0;
  try {
    const stat = fs.statSync(filePath);
    estimatedSize = stat.size;
  } catch {
    // File doesn't exist yet – start from 0
  }

  /** Core write logic with estimated-size rotation and silent error handling. */
  function write(level: LogLevel, message: string): void {
    try {
      // Skip debug when disabled
      if (level === 'debug' && !debugEnabled) return;

      const line = `${new Date().toISOString()} ${prefix} [${level.toUpperCase()}] ${message}\n`;
      const lineBytes = Buffer.byteLength(line, 'utf-8');

      // Rotation check: in-memory threshold first, statSync only when estimated
      // size indicates the file might have exceeded the limit.
      if (estimatedSize + lineBytes >= maxSize) {
        buffer.flush();
        if (shouldRotate(filePath, maxSize)) {
          rotateFile(filePath);
        }
        // Refresh estimate from actual file size after potential rotation
        try {
          estimatedSize = fs.statSync(filePath).size;
        } catch {
          estimatedSize = 0;
        }
      }

      buffer.append(line);
      estimatedSize += lineBytes;
    } catch {
      // Fallback to console so nothing is completely lost
      switch (level) {
        case 'debug':
          break; // Already filtered above, but keep for completeness
        case 'info':
          console.info(`${prefix} [INFO] ${message}`);
          break;
        case 'warn':
          console.warn(`${prefix} [WARN] ${message}`);
          break;
        case 'error':
          console.error(`${prefix} [ERROR] ${message}`);
          break;
      }
    }
  }

  const result: Logger = {
    debug: (message: string) => write('debug', message),
    info: (message: string) => write('info', message),
    warn: (message: string) => write('warn', message),
    error: (message: string) => write('error', message),
  };

  // Internal methods for testing and graceful shutdown.
  // These are not part of the Logger interface but are available at runtime.
  Object.assign(result, {
    _flush: () => buffer.flush(),
    _close: () => buffer.close(),
  });

  return result;
}

// ---------------------------------------------------------------------------
// Default instance
// ---------------------------------------------------------------------------

export const logger = createLogger({
  prefix: DEFAULT_PREFIX,
  debugEnabled:
    process.env.UL_OPENCODE_EVENT_DEBUG === '1' ||
    process.env.UL_OPENCODE_EVENT_DEBUG === 'true',
});

export const DEBUG_ENABLED =
  process.env.UL_OPENCODE_EVENT_DEBUG === '1' ||
  process.env.UL_OPENCODE_EVENT_DEBUG === 'true';
