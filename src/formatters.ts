/**
 * Channel Formatter Registry
 *
 * Provides formatter instances for each supported channel type.
 * Formatters convert generic subject/body into channel-specific message structures.
 *
 * - SMTP: pass-through (subject + text body)
 * - DingTalk: Markdown formatting with escaping and truncation
 * - Feishu: Interactive card messages for Feishu bots
 */

import type { ChannelType, Channel, ChannelFormatter, DingtalkConfig, FeishuConfig } from './types.js';
import { createDingTalkFormatter } from './dingtalk.js';
import { createFeishuFormatter } from './feishu.js';

// ─── Email Formatter (SMTP) ──────────────────────────────

/**
 * Email/pass-through formatter for SMTP channels.
 *
 * Returns subject and body as-is, compatible with nodemailer's mail options.
 * This is a pure function with no side effects.
 */
export const emailFormatter: ChannelFormatter = {
  format(subject: string, body: string): import('./types.js').FormattedMessage {
    return { subject, text: body };
  },
};

// ─── Formatter Registry ──────────────────────────────────

/** Built-in formatter lookup by channel type (excluding dingtalk which needs config) */
const FORMATTER_REGISTRY: Record<string, ChannelFormatter> = {
  smtp: emailFormatter,
  // feishu: not implemented -> returns null via getFormatter fallback
};

// ─── Public API ──────────────────────────────────────────

/**
 * Get the appropriate formatter for a given channel type.
 *
 * @param channelType - The channel type (smtp, dingtalk, feishu)
 * @param channel - The full channel configuration (needed for dingtalk config)
 * @returns The channel formatter, or null if the channel type is not supported
 */
export function getFormatter(channelType: ChannelType, channel: Channel): ChannelFormatter | null {
  if (channelType === 'dingtalk') {
    return createDingTalkFormatter(channel.config as DingtalkConfig);
  }

  if (channelType === 'feishu') {
    return createFeishuFormatter(channel.config as FeishuConfig);
  }

  return FORMATTER_REGISTRY[channelType] ?? null;
}

// ─── Re-exports ──────────────────────────────────────────

export { createDingTalkFormatter } from './dingtalk.js';
export { createFeishuFormatter } from './feishu.js';
