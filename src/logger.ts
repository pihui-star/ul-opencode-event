/**
 * Production-grade file logger module.
 * Zero dependencies, ESM-only, synchronous I/O.
 *
 * Features:
 * - Log levels: debug / info / warn / error
 * - Auto-rotation: truncates file at configurable size limit (keeps newest half)
 * - Auto-detects log path from OPENCODE_DATA_DIR or OS default
 * - Silent failure: never throws from write/truncate (catch-all + console fallback)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
const TRUNCATE_MARKER = '[TRUNCATED] ... old logs dropped\n';

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
    // Directory creation failure is non-fatal – appendFileSync will fail
    // later and be caught by _write's own try/catch.
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

  /** Truncate log file by keeping only the second (newer) half of content. */
  function truncate(): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.length === 0) return;

      const mid = Math.floor(content.length / 2);
      const nl = content.indexOf('\n', mid);
      const cut = nl >= 0 ? nl + 1 : mid;

      fs.writeFileSync(
        filePath,
        TRUNCATE_MARKER + content.slice(cut),
        'utf-8',
      );
    } catch {
      // Truncation is best-effort – ignore failures silently
    }
  }

  /** Core write logic with size-check rotation and silent error handling. */
  function write(level: LogLevel, message: string): void {
    try {
      // Skip debug when disabled
      if (level === 'debug' && !debugEnabled) return;

      const line = `${new Date().toISOString()} ${prefix} [${level.toUpperCase()}] ${message}\n`;

      // Rotate if file exceeds max size
      try {
        const stat = fs.statSync(filePath);
        if (stat.size >= maxSize) {
          truncate();
        }
      } catch {
        // File may not exist yet – that's fine, we'll create it on append
      }

      fs.appendFileSync(filePath, line, 'utf-8');
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

  return {
    debug: (message: string) => write('debug', message),
    info: (message: string) => write('info', message),
    warn: (message: string) => write('warn', message),
    error: (message: string) => write('error', message),
  };
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
