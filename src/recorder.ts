/**
 * System-level event variable recorder.
 * Writes template variables as JSON Lines to a standalone file.
 *
 * - Always on, fire-and-forget
 * - Auto-rotation at 2 MB (keeps newest half, line-boundary aligned)
 * - Silent failure: never throws, logs errors via logger
 */

import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from './logger.js';

// Use createRequire to get the real fs module, bypassing any test mock.module('fs')
const nodeRequire = createRequire(import.meta.url);
const fs = nodeRequire('node:fs') as typeof import('node:fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const TRUNCATE_MARKER = '[TRUNCATED] ... old records dropped\n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the absolute recorder file path. */
function resolveRecorderPath(): string {
  const baseDir =
    process.env.OPENCODE_DATA_DIR ??
    path.join(os.homedir(), '.local', 'share', 'opencode');

  return path.join(baseDir, 'ul-opencode-event-variables.jsonl');
}

/** Ensure the parent directory exists (non-fatal). */
function ensureDir(filePath: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // Directory creation failure is non-fatal.
  }
}

// ---------------------------------------------------------------------------
// Lazy initialization
// ---------------------------------------------------------------------------

let filePath: string | null = null;

function getFilePath(): string {
  if (!filePath) {
    filePath = resolveRecorderPath();
    ensureDir(filePath);
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** Truncate file by keeping only the second (newer) half, aligned to newline boundary. */
function truncate(fp: string): void {
  try {
    const content = fs.readFileSync(fp, 'utf-8');
    if (content.length === 0) return;

    const mid = Math.floor(content.length / 2);
    const nl = content.indexOf('\n', mid);
    const cut = nl >= 0 ? nl + 1 : mid;

    fs.writeFileSync(fp, TRUNCATE_MARKER + content.slice(cut), 'utf-8');
  } catch {
    // Truncation is best-effort – ignore failures silently
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record event variables to a JSON Lines file.
 * Each call appends one JSON line. Never throws.
 *
 * @param variables - Key-value map of template variables (values are string or undefined).
 *                    undefined values are naturally omitted by JSON.stringify.
 */
export function recordEventVariables(
  variables: Record<string, string | undefined>,
): void {
  try {
    const fp = getFilePath();
    const line = JSON.stringify(variables) + '\n';

    // Rotate if file exceeds max size
    try {
      const stat = fs.statSync(fp);
      if (stat.size >= DEFAULT_MAX_SIZE_BYTES) {
        truncate(fp);
      }
    } catch {
      // File may not exist yet – that's fine, we'll create it on append
    }

    fs.appendFileSync(fp, line, 'utf-8');
  } catch (err) {
    logger.error(`Failed to record event variables: ${err}`);
  }
}
