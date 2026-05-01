/**
 * File channel sender module
 *
 * Writes notification messages as JSON Lines to a local file.
 * Uses WriteBuffer for efficient buffered writes with periodic rotation checks.
 * Rotation is performed by file-rotation.ts (shouldRotate + rotateFile).
 *
 * Zero external dependencies — uses only Node.js built-in modules.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { Channel, ChannelSender, ChannelFormatter, FormattedMessage, FileConfig, EventPayload } from './types.js';
import { logger } from './logger.js';
import { WriteBuffer } from './write-buffer.js';
import { shouldRotate, rotateFile } from './file-rotation.js';

// ─── Constants ───────────────────────────────────────────

/** Default max file size before rotation: 1 MB */
export const DEFAULT_FILE_MAX_SIZE = 1048576;

/** Default output file path */
export const DEFAULT_FILE_PATH = path.join(
  os.homedir(), '.local', 'share', 'opencode', 'ul-opencode-event-messages.log'
);

/** Check rotation every N writes to reduce statSync overhead */
const ROTATION_CHECK_INTERVAL = 50;

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
 * Uses WriteBuffer for buffered writes — data is accumulated in memory
 * and flushed periodically (every 50 items or 500ms) or on close().
 * Rotation is checked every 50 writes via shouldRotate() to minimize
 * statSync overhead.
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

  let writeCount = 0;
  const buffer = new WriteBuffer({
    filePath,
    maxSizeBytes: maxSize,
    flushInterval: 500,
  });

  return {
    send: async (message: unknown): Promise<void> => {
      try {
        const line = JSON.stringify(message) + '\n';

        // Check rotation every N writes to reduce statSync overhead
        writeCount++;
        if (writeCount % ROTATION_CHECK_INTERVAL === 0 && shouldRotate(filePath, maxSize)) {
          rotateFile(filePath);
        }

        buffer.append(line);
      } catch (error) {
        logger.error(`[${channelName}] Failed to write file message: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    close: async (): Promise<void> => {
      buffer.close();
    },
  };
}
