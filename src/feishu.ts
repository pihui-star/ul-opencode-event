/**
 * Feishu (Lark) custom robot webhook sender module
 *
 * Sends notifications via Feishu custom robot webhook API using interactive cards.
 * Uses Web Crypto API for HMAC-SHA256 signing (no external dependencies).
 * Uses Node.js built-in fetch for HTTP requests.
 *
 * Reference: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */

import type { Channel, ChannelSender, ChannelFormatter, FormattedMessage, FeishuConfig } from './types.js';
import { logger } from './logger.js';

// ─── Signing ───────────────────────────────────────────────

/**
 * Generate HmacSHA256 signature for Feishu webhook authentication.
 *
 * Algorithm: base64(hmac_sha256(timestamp + "\n" + secret, ""))
 *
 * Key difference from DingTalk:
 * - Feishu: key = timestamp + "\n" + secret, message = "" (empty)
 * - DingTalk: key = secret, message = timestamp + "\n" + secret
 *
 * @param secret - The robot signing secret
 * @param timestamp - Second-level timestamp string
 * @returns Base64-encoded signature
 */
export async function generateFeishuSign(secret: string, timestamp: string): Promise<string> {
  if (!secret) {
    return '';
  }

  const stringToSign = `${timestamp}\n${secret}`;

  const encoder = new TextEncoder();
  // Feishu: key = timestamp + "\n" + secret
  const keyData = encoder.encode(stringToSign);
  // Feishu: message = "" (empty)
  const data = encoder.encode('');

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);

  // Convert ArrayBuffer to base64 without Buffer (pure browser/Node compat)
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// ─── Formatting ────────────────────────────────────────────

/** Max title length before truncation */
const MAX_TITLE_LENGTH = 100;

/** Max content length before truncation */
const MAX_CONTENT_LENGTH = 4000;
/** Keep this many chars when truncating */
const TRUNCATE_KEEP_LENGTH = 3800;
const TRUNCATE_SUFFIX = '\n... (truncated)';

/** Pattern to detect key: value lines for bold formatting */
const KEY_VALUE_PATTERN = /^(\s*\w[\w\s]*?)\s*:\s*(.+)$/;

/** Pattern to detect error-like content */
const ERROR_INDICATORS = /\b(error|Error|stack trace|Stack|Exception)\b/;

/**
 * Create a Feishu interactive card formatter.
 *
 * Converts subject + body into Feishu's interactive card JSON structure:
 * { msg_type: "interactive", card: { header, elements } }
 *
 * Formatting rules:
 * - Subject becomes card header title, truncated at 100 chars
 * - Lines matching "key: value" get bold keys (**key**: value)
 * - Error-looking lines wrapped in ``` code blocks
 * - No DingTalk-style character escaping (lark_md uses standard Markdown)
 * - Total content truncated at 4000 chars
 */
export function createFeishuFormatter(_config: FeishuConfig): ChannelFormatter {
  return {
    format(subject: string, body: string, _payload: import('./types.js').EventPayload): FormattedMessage {
      // 1. Title: truncate at 100 chars with ... suffix
      const rawTitle = subject.trim();
      const title = rawTitle.length > MAX_TITLE_LENGTH
        ? rawTitle.slice(0, MAX_TITLE_LENGTH) + '...'
        : rawTitle;

      // 2. Process body lines
      const processedLines: string[] = [];

      for (const line of body.split('\n')) {
        const trimmed = line.trim();

        if (!trimmed) {
          processedLines.push('');
          continue;
        }

        // Check for key: value pattern -> **key**: value
        const kvMatch = trimmed.match(KEY_VALUE_PATTERN);
        if (kvMatch && kvMatch[1] && kvMatch[2]) {
          processedLines.push(`**${kvMatch[1].trim()}**: ${kvMatch[2].trim()}`);
          continue;
        }

        // Check for error-like content -> wrap in code block
        if (ERROR_INDICATORS.test(trimmed)) {
          processedLines.push(`\`\`\`\n${trimmed}\n\`\`\``);
          continue;
        }

        // Default: pass through (lark_md supports standard Markdown)
        processedLines.push(trimmed);
      }

      // 3. Join lines
      let text = processedLines.join('\n');

      if (text.length > MAX_CONTENT_LENGTH) {
        text = text.slice(0, TRUNCATE_KEEP_LENGTH) + TRUNCATE_SUFFIX;
      }

      // 4. Build interactive card message
      const message: FormattedMessage = {
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: 'plain_text', content: title },
            template: 'blue',
          },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: text },
            },
          ],
        },
      };

      return message;
    },
  };
}

// ─── Sending ──────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Create a Feishu webhook sender for the given channel configuration.
 *
 * Factory function that validates channel config and returns a sender
 * or null if the channel is invalid/disabled.
 *
 * Validation:
 * - channel.type must be 'feishu'
 * - channel.enabled must not be false
 * - webhook URL must be present and look valid (http:// or https://)
 */
export async function createFeishuSender(channel: Channel): Promise<ChannelSender | null> {
  if (channel.type !== 'feishu') {
    return null;
  }

  if (channel.enabled === false) {
    return null;
  }

  const config = channel.config as FeishuConfig;

  if (!config.webhook) {
    return null;
  }

  // Validate webhook URL format
  const webhookUrl = config.webhook.trim();
  if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
    return null;
  }

  const channelName = channel.name || 'Feishu';
  const secret = config.secret;

  return {
    send: async (message: unknown): Promise<void> => {
      // Expect FormattedMessage from createFeishuFormatter
      const msg = message as {
        msg_type?: string;
        card?: Record<string, unknown>;
      } | undefined;

      if (!msg || msg.msg_type !== 'interactive' || !msg.card) {
        return;
      }

      // Build message body (sign goes in body, not URL)
      const body: Record<string, unknown> = { ...msg };

      if (secret) {
        // Feishu uses second-level timestamp (not milliseconds like DingTalk)
        const timestamp = String(Math.floor(Date.now() / 1000));
        const sign = await generateFeishuSign(secret, timestamp);
        body.timestamp = timestamp;
        body.sign = sign;
      }

      // Send via fetch with timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      logger.debug(`Feishu webhook POST ${webhookUrl}`);

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timer);

        logger.debug(`Feishu response: ${response.status} ${response.statusText}`);

        // Parse response - Feishu returns { code: 0, msg: "success" }
        let result: { code?: number; msg?: string };
        try {
          result = (await response.json()) as { code?: number; msg?: string };
        } catch {
          result = {};
        }

        if (result.code !== undefined && result.code !== 0) {
          // Feishu API returned an error
          logger.debug(`[${channelName}] Feishu API error: code=${result.code}, msg=${result.msg ?? 'unknown'}`);
          return;
        }

        // Success (code === 0 or no code in response)
        logger.debug(`[${channelName}] Feishu message sent successfully`);
      } catch (error) {
        clearTimeout(timer);

        // Network error or abort - log error
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Feishu send failed: ${message}`);
      }
    },

    close: async (): Promise<void> => {
      // No persistent connections for HTTP-based webhook sending
      // This is a no-op but required by ChannelSender interface
    },
  };
}
