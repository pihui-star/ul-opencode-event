/**
 * File channel sender module
 *
 * Writes notification messages as JSON Lines to a local file.
 * Supports automatic file rotation when the file exceeds a configurable size limit.
 * Uses synchronous file I/O for simplicity and reliability.
 *
 * Zero external dependencies — uses only Node.js built-in fs/path/os modules.
 */

import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Channel, ChannelSender, ChannelFormatter, FormattedMessage, FileConfig, EventPayload } from './types.js';
import { logger } from './logger.js';

// Use createRequire to get the real fs module, bypassing any test mock.module('fs')
const nodeRequire = createRequire(import.meta.url);
const fs = nodeRequire('node:fs') as typeof import('node:fs');

// ─── Constants ───────────────────────────────────────────

/** Default max file size before rotation: 1 MB */
export const DEFAULT_FILE_MAX_SIZE = 1048576;

/** Default output file path */
export const DEFAULT_FILE_PATH = path.join(
  os.homedir(), '.local', 'share', 'opencode', 'ul-opencode-event-messages.log'
);

/** Marker written at the beginning of a rotated (truncated) file */
const TRUNCATE_MARKER = '[TRUNCATED] ... old messages dropped\n';

// ─── Formatting ──────────────────────────────────────────

/**
 * Create a file channel formatter.
 *
 * Returns a pass-through formatter that bundles subject, body, and the full
 * event payload into a single object. This object is then JSON.stringify'd
 * by the sender and written as one JSON Line.
 */
export function createFileFormatter(): ChannelFormatter {
  return {
    format(subject: string, body: string, payload: EventPayload): FormattedMessage {
      return {
        ...payload,
        subject,
        body,
      };
    },
  };
}

// ─── Sending ─────────────────────────────────────────────

/**
 * Create a file channel sender for the given channel configuration.
 *
 * Factory function that validates channel config and returns a sender
 * or null if the channel is invalid/disabled.
 *
 * Validation:
 * - channel.type must be 'file'
 * - channel.enabled must not be false
 */
export async function createFileSender(channel: Channel): Promise<ChannelSender | null> {
  if (channel.type !== 'file') {
    return null;
  }

  if (channel.enabled === false) {
    return null;
  }

  const config = channel.config as FileConfig;
  const filePath = config.filePath || DEFAULT_FILE_PATH;
  const maxSize = config.maxSizeBytes ?? DEFAULT_FILE_MAX_SIZE;
  const channelName = channel.name || 'File';

  return {
    send: async (message: unknown): Promise<void> => {
      try {
        const line = JSON.stringify(message) + '\n';

        // Ensure directory exists
        const dir = path.dirname(filePath);
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {
          // Directory creation failure handled by appendFileSync error below
        }

        // Check file size and rotate if needed
        try {
          const stat = fs.statSync(filePath);
          if (stat.size >= maxSize) {
            rotateFile(filePath);
          }
        } catch {
          // File may not exist yet — that's fine, we'll create it on append
        }

        fs.appendFileSync(filePath, line, 'utf-8');
      } catch (error) {
        logger.error(`[${channelName}] Failed to write file message: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    close: async (): Promise<void> => {
      // No persistent connections or resources to clean up
    },
  };
}

// ─── Rotation ────────────────────────────────────────────

/**
 * Rotate the log file by keeping only the second (newer) half of content.
 *
 * Strategy:
 * 1. Read the entire file
 * 2. Find the midpoint
 * 3. Find the next newline after the midpoint (to avoid splitting a JSON line)
 * 4. Keep everything after that newline
 * 5. Write TRUNCATE marker + kept content back to the file
 *
 * Errors are caught and logged — never throws.
 */
function rotateFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.length === 0) return;

    const mid = Math.floor(content.length / 2);
    const nl = content.indexOf('\n', mid);
    const cut = nl >= 0 ? nl + 1 : mid;

    fs.writeFileSync(
      filePath,
      TRUNCATE_MARKER + content.slice(cut),
      'utf-8'
    );
  } catch (error) {
    logger.error(`File rotation failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
