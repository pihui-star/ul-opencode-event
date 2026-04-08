/**
 * DingTalk robot webhook sender module
 *
 * Sends notifications via DingTalk (钉钉) custom robot webhook API.
 * Uses Web Crypto API for HMAC-SHA256 signing (no external dependencies).
 * Uses Node.js built-in fetch for HTTP requests.
 *
 * Reference: https://open.dingtalk.com/document/orgapp/custom-robot-access
 */

import type { Channel, ChannelSender, ChannelFormatter, FormattedMessage, DingtalkConfig } from './types.js';
import { logger, DEBUG_ENABLED } from './logger.js';

// ─── Signing ───────────────────────────────────────────────

/**
 * Generate HmacSHA256 signature for DingTalk webhook authentication.
 *
 * Algorithm: base64(hmac_sha256(secret, timestamp + "\n" + secret))
 *
 * @param secret - The robot signing secret
 * @param timestamp - Millisecond timestamp string
 * @returns Base64-encoded signature
 */
export async function generateSign(secret: string, timestamp: string): Promise<string> {
  if (!secret) {
    return '';
  }

  const stringToSign = `${timestamp}\n${secret}`;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(stringToSign);

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

/** Characters that need escaping in DingTalk Markdown */
const ESCAPE_CHARS_REGEX = /[\\_*\[\]()~`>#+\-={}|.`!]/g;

/**
 * Escape special characters for DingTalk Markdown subset.
 */
function escapeMarkdown(text: string): string {
  return text.replace(ESCAPE_CHARS_REGEX, '\\$&');
}

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
 * Create a DingTalk Markdown formatter.
 *
 * Converts subject + body into DingTalk's expected JSON structure:
 * { msgtype: "markdown", markdown: { title, text }, at? }
 *
 * Formatting rules:
 * - Subject becomes markdown title (# title), truncated at 100 chars
 * - Lines matching "key: value" get bold keys (**key**: value)
 * - Error-looking lines wrapped in ``` code blocks
 * - Special characters escaped per DingTalk Markdown subset
 * - Total content truncated at 4000 chars
 */
export function createDingTalkFormatter(config: DingtalkConfig): ChannelFormatter {
  return {
    format(subject: string, body: string, _payload: import('./types.js').EventPayload): FormattedMessage {
      // 1. Title: truncate at 100 chars with ... suffix
      const rawTitle = subject.trim();
      const title = rawTitle.length > MAX_TITLE_LENGTH
        ? rawTitle.slice(0, MAX_TITLE_LENGTH) + '...'
        : rawTitle;

      // 2. Process body lines
      const lines = body.split('\n');
      const processedLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for key: value pattern -> **key**: value
        const kvMatch = trimmed.match(KEY_VALUE_PATTERN);
        if (kvMatch && kvMatch[1] && kvMatch[2]) {
          processedLines.push(`**${escapeMarkdown(kvMatch[1].trim())}**: ${escapeMarkdown(kvMatch[2].trim())}`);
          continue;
        }

        // Check for error-like content -> wrap in code block
        if (ERROR_INDICATORS.test(trimmed)) {
          processedLines.push(`\`\`\`\n${escapeMarkdown(trimmed)}\n\`\`\``);
          continue;
        }

        // Default: escape special characters and pass through
        processedLines.push(escapeMarkdown(trimmed));
      }

      // 3. Join with double newlines (DingTalk Markdown requires \n\n for line breaks)
      let text = processedLines.join('\n\n');

      if (text.length > MAX_CONTENT_LENGTH) {
        text = text.slice(0, TRUNCATE_KEEP_LENGTH) + TRUNCATE_SUFFIX;
      }

      // 4. Build final message object
      const message: FormattedMessage = {
        msgtype: 'markdown',
        markdown: {
          title,
          text,
        },
      };

      // 5. Append @mention config if present
      if (config.at) {
        (message as Record<string, unknown>).at = config.at;
      }

      return message;
    },
  };
}

// ─── Sending ──────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;


/**
 * Create a DingTalk webhook sender for the given channel configuration.
 *
 * Factory function that validates channel config and returns a sender
 * or null if the channel is invalid/disabled.
 *
 * Validation:
 * - channel.type must be 'dingtalk'
 * - channel.enabled must not be false
 * - webhook URL must be present and look valid (http:// or https://)
 */
export async function createDingTalkSender(channel: Channel): Promise<ChannelSender | null> {
  if (channel.type !== 'dingtalk') {
    return null;
  }

  if (channel.enabled === false) {
    return null;
  }

  const config = channel.config as DingtalkConfig;

  if (!config.webhook) {
    return null;
  }

  // Validate webhook URL format
  const webhookUrl = config.webhook.trim();
  if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
    return null;
  }

  const channelName = channel.name || 'DingTalk';
  const secret = config.secret;

  return {
    send: async (message: unknown): Promise<void> => {
      // Expect FormattedMessage from createDingTalkFormatter
      const msg = message as {
        msgtype?: string;
        markdown?: { title?: string; text?: string };
        at?: { atMobiles?: string[]; atAll?: boolean };
      } | undefined;

      if (!msg || msg.msgtype !== 'markdown' || !msg.markdown) {
        return;
      }

      // Build target URL with signing if secret is configured
      let targetUrl = webhookUrl;

      if (secret) {
        const timestamp = String(Date.now());
        const sign = await generateSign(secret, timestamp);
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}timestamp=${encodeURIComponent(timestamp)}&sign=${encodeURIComponent(sign)}`;
      }

      // Send via fetch with timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      logger.debug(`DingTalk webhook POST ${targetUrl}`);

      try {
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
          signal: controller.signal,
        });

        clearTimeout(timer);

        logger.debug(`DingTalk response: ${response.status} ${response.statusText}`);

        // Parse response
        let result: { errcode?: number; errmsg?: string };
        try {
          result = (await response.json()) as { errcode?: number; errmsg?: string };
        } catch {
          result = {};
        }

        if (result.errcode !== undefined && result.errcode !== 0) {
          // DingTalk API returned an error
          logger.debug(`[${channelName}] DingTalk API error: errcode=${result.errcode}, errmsg=${result.errmsg ?? 'unknown'}`);
          return;
        }

        // Success (errcode === 0 or no errcode in response)
        logger.debug(`[${channelName}] DingTalk message sent successfully`);
      } catch (error) {
        clearTimeout(timer);

        // Network error or abort - log error
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`DingTalk send failed: ${message}`);
      }
    },

    close: async (): Promise<void> => {
      // No persistent connections for HTTP-based webhook sending
      // This is a no-op but required by ChannelSender interface
    },
  };
}
