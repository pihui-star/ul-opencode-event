/**
 * Multi-channel event handler for notifications
 *
 * Channel senders are loaded lazily to avoid blocking oh-my-opencode during loading.
 * Only imports when actually needed (when creating senders).
 * Supports SMTP and DingTalk channels via a unified ChannelSender interface.
 */
import os from 'node:os';
import type { NotificationConfig, EventPayload, EventType, TemplateConfig, ChannelSender, TokenBreakdown } from './types.js';
import { renderTemplate } from './template.js';
import { getDefaultTemplates } from './locales.js';
import { getFormatter } from './formatters.js';
import { logger } from './logger.js';
import { recordEventVariables } from './recorder.js';
import { getCurrentVersion } from './updater.js';

/**
 * 事件默认开关配置
 * 未在配置文件中显式指定的事件，按此默认值决定是否发送通知
 */
const EVENT_DEFAULTS: Record<EventType, boolean> = {
  created: true,
  idle: true,
  error: true,
  question: true,
  permission: true,
  status: false,
  command: false,
  fileEdited: false,
  todo: false,
};

export interface EventHandler {
  handle: (eventType: EventType, payload: EventPayload) => Promise<void>;
  close: () => Promise<void>;
  setOpenCodeVersion: (version: string) => void;
}

/**
 * Virtual network interface name prefixes to skip when detecting local IP.
 * Case-insensitive comparison.
 */
const VIRTUAL_NIC_PREFIXES = ['docker', 'wsl', 'vethernet', 'tun', 'vmnet', 'vnic'];

// Module-level caches
let cachedLocalIP: string | null = null;

let uptimeCache: { value: string; timestamp: number } | null = null;
const UPTIME_CACHE_TTL = 60_000; // 60 seconds

export function resetIPCache(): void {
  cachedLocalIP = null;
}

export function resetUptimeCache(): void {
  uptimeCache = null;
}

/**
 * Format system uptime (in seconds) as a human-readable string.
 * Rules: calculate from largest unit (days) to smallest (seconds),
 * skip zero-valued large units, but always keep minutes as the baseline minimum.
 *
 * Examples: 0 → "0m", 45 → "0m 45s", 3661 → "1h 1m 1s", 90061 → "1d 1h 1m 1s"
 */
export function formatSystemUptime(seconds: number): string {
  const secs = Math.floor(Math.abs(seconds));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);

  return parts.join(' ');
}

/**
 * Get cached system uptime string. Refreshes every 60 seconds.
 */
function getCachedSystemUptime(): string {
  const now = Date.now();
  if (uptimeCache && now - uptimeCache.timestamp < UPTIME_CACHE_TTL) {
    return uptimeCache.value;
  }
  const value = formatSystemUptime(os.uptime());
  uptimeCache = { value, timestamp: now };
  return value;
}

/**
 * Get the first non-internal, non-virtual IPv4 address from network interfaces.
 * Returns "127.0.0.1" if no suitable interface is found.
 * Result is cached after first call.
 */
export function getLocalIP(): string {
  if (cachedLocalIP !== null) return cachedLocalIP;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    if (VIRTUAL_NIC_PREFIXES.some(prefix => lowerName.startsWith(prefix))) {
      continue;
    }
    const entries = interfaces[name];
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry.internal && entry.family === 'IPv4') {
        cachedLocalIP = entry.address;
        return cachedLocalIP;
      }
    }
  }
  cachedLocalIP = '127.0.0.1';
  return cachedLocalIP;
}

/**
 * Format a token count as a human-readable string with K/M/B suffix.
 * Examples: 0 → "0", 127100 → "127.1K", 1500000 → "1.5M", 1000000000 → "1.0B"
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.floor(Math.abs(n));
  if (abs < 1000) return String(abs);
  if (abs < 1_000_000) return (abs / 1000).toFixed(1) + 'K';
  if (abs < 1_000_000_000) return (abs / 1_000_000).toFixed(1) + 'M';
  return (abs / 1_000_000_000).toFixed(1) + 'B';
}

/**
 * Calculate cache hit rate from token breakdown.
 * Returns percentage string like "45.2%" or "N/A" for invalid/missing data.
 * Handles: undefined, null, total=0, NaN (0/0), Infinity, negative values.
 */
export function calcCacheHitRate(tokens: TokenBreakdown | undefined): string {
  if (tokens == null) return 'N/A';
  const total = tokens.total;
  const cacheRead = tokens.cacheRead;
  if (total === 0 || !Number.isFinite(cacheRead) || cacheRead < 0) return 'N/A';
  const rate = cacheRead / total * 100;
  if (!Number.isFinite(rate)) return 'N/A';
  return rate.toFixed(1) + '%';
}

/**
 * Creates an event handler that dispatches notifications to all enabled channels.
 * Senders are created lazily on first handle() call to avoid importing nodemailer at plugin load time.
 */
export function createEventHandler(config: NotificationConfig): EventHandler {
  // Lazy sender cache - created on first use (supports all channel types)
  const senders: Map<string, ChannelSender> = new Map();
  let sendersInitialized = false;

  // Resolve locale-aware default templates at creation time
  const defaultTemplates = getDefaultTemplates(config.language);

  // Static system variables - collected once at creation time
  const staticSystemInfo = {
    hostname: os.hostname(),
    osType: os.type(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    username: os.userInfo().username,
    nodeVersion: process.version,
    pluginVersion: getCurrentVersion() ?? "unknown",
  };

  // OpenCode version - set from session.created event in index.ts
  let opencodeVersion = "";

  return {
    handle: async (eventType: EventType, payload: EventPayload): Promise<void> => {
      // Lazy-create senders on first use to avoid nodemailer import at plugin load time
      if (!sendersInitialized) {
        sendersInitialized = true;
        for (let i = 0; i < config.channels.length; i++) {
          const channel = config.channels[i];
          if (channel.type === 'smtp' && channel.enabled !== false) {
            try {
              // Dynamic import to avoid blocking plugin loading
              const emailModule = await import('./email.js');
              const sender = await emailModule.createEmailSender(channel);
              if (sender) {
                const key = channel.name || `channel-${i}`;
                senders.set(key, sender);
              }
            } catch (error) {
              logger.error(`Failed to initialize channel '${channel.name ?? String(i)}': ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (channel.type === 'dingtalk' && channel.enabled !== false) {
            try {
              // Dynamic import to avoid blocking plugin loading
              const dingtalkModule = await import('./dingtalk.js');
              const sender = await dingtalkModule.createDingTalkSender(channel);
              if (sender) {
                const key = channel.name || `channel-${i}`;
                senders.set(key, sender);
              }
            } catch (error) {
              logger.error(`Failed to initialize channel '${channel.name ?? String(i)}': ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (channel.type === 'feishu' && channel.enabled !== false) {
            try {
              const feishuModule = await import('./feishu.js');
              const sender = await feishuModule.createFeishuSender(channel);
              if (sender) {
                const key = channel.name || `channel-${i}`;
                senders.set(key, sender);
              }
            } catch (error) {
              logger.error(`Failed to initialize channel '${channel.name ?? String(i)}': ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (channel.type === 'file' && channel.enabled !== false) {
            try {
              const fileModule = await import('./file.js');
              const sender = await fileModule.createFileSender(channel);
              if (sender) {
                const key = channel.name || `channel-${i}`;
                senders.set(key, sender);
              }
            } catch (error) {
              logger.error(`Failed to initialize channel '${channel.name ?? String(i)}': ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }

      // Prepare template variables from payload (channel-independent, built once)
      const variables = {
        eventType: payload.eventType,
        timestamp: payload.timestamp,
        projectName: payload.projectName,
        sessionId: payload.sessionId,
        sessionTitle: payload.sessionTitle,
        message: payload.message,
        error: payload.error,
        duration: payload.duration,
        // 新增字段
        title: payload.title,
        questionText: payload.questionText,
        options: payload.options,
        permissionType: payload.permissionType,
        statusType: payload.statusType,
        commandName: payload.commandName,
        arguments: payload.arguments,
        filePath: payload.filePath,
        todoSummary: payload.todoSummary,
        sessionType: payload.sessionType,
        parentSessionId: payload.parentSessionId,
        projectPath: payload.projectPath,
        // 费用与 Token 用量
        sessionCost: payload.sessionCost != null ? String(payload.sessionCost) : undefined,
        sessionCostFormatted: payload.costFormatted,
        sessionTokensInput: payload.sessionTokens?.input != null ? String(payload.sessionTokens.input) : undefined,
        sessionTokensOutput: payload.sessionTokens?.output != null ? String(payload.sessionTokens.output) : undefined,
        sessionTokensReasoning: payload.sessionTokens?.reasoning != null ? String(payload.sessionTokens.reasoning) : undefined,
        sessionTokensCacheRead: payload.sessionTokens?.cacheRead != null ? String(payload.sessionTokens.cacheRead) : undefined,
        sessionTokensCacheWrite: payload.sessionTokens?.cacheWrite != null ? String(payload.sessionTokens.cacheWrite) : undefined,
        sessionTokensTotal: payload.sessionTokens?.total != null ? String(payload.sessionTokens.total) : undefined,
        sessionRequestCount: payload.sessionRequestCount != null ? String(payload.sessionRequestCount) : undefined,
        totalCost: payload.totalCost != null ? String(payload.totalCost) : undefined,
        totalCostFormatted: payload.totalCostFormatted,
        totalTokensInput: payload.totalTokens?.input != null ? String(payload.totalTokens.input) : undefined,
        totalTokensOutput: payload.totalTokens?.output != null ? String(payload.totalTokens.output) : undefined,
        totalTokensReasoning: payload.totalTokens?.reasoning != null ? String(payload.totalTokens.reasoning) : undefined,
        totalTokensCacheRead: payload.totalTokens?.cacheRead != null ? String(payload.totalTokens.cacheRead) : undefined,
        totalTokensCacheWrite: payload.totalTokens?.cacheWrite != null ? String(payload.totalTokens.cacheWrite) : undefined,
        totalTokensTotal: payload.totalTokens?.total != null ? String(payload.totalTokens.total) : undefined,
        totalRequestCount: payload.totalRequestCount != null ? String(payload.totalRequestCount) : undefined,
        modelID: payload.modelID,
        providerID: payload.providerID,
        mode: payload.mode,
        currency: payload.currency,
        // Token 用量（人类可读格式）
        sessionTokensInputHuman: payload.sessionTokens?.input != null ? formatTokenCount(payload.sessionTokens.input) : undefined,
        sessionTokensOutputHuman: payload.sessionTokens?.output != null ? formatTokenCount(payload.sessionTokens.output) : undefined,
        sessionTokensReasoningHuman: payload.sessionTokens?.reasoning != null ? formatTokenCount(payload.sessionTokens.reasoning) : undefined,
        sessionTokensCacheReadHuman: payload.sessionTokens?.cacheRead != null ? formatTokenCount(payload.sessionTokens.cacheRead) : undefined,
        sessionTokensCacheWriteHuman: payload.sessionTokens?.cacheWrite != null ? formatTokenCount(payload.sessionTokens.cacheWrite) : undefined,
        sessionTokensTotalHuman: payload.sessionTokens?.total != null ? formatTokenCount(payload.sessionTokens.total) : undefined,
        totalTokensInputHuman: payload.totalTokens?.input != null ? formatTokenCount(payload.totalTokens.input) : undefined,
        totalTokensOutputHuman: payload.totalTokens?.output != null ? formatTokenCount(payload.totalTokens.output) : undefined,
        totalTokensReasoningHuman: payload.totalTokens?.reasoning != null ? formatTokenCount(payload.totalTokens.reasoning) : undefined,
        totalTokensCacheReadHuman: payload.totalTokens?.cacheRead != null ? formatTokenCount(payload.totalTokens.cacheRead) : undefined,
        totalTokensCacheWriteHuman: payload.totalTokens?.cacheWrite != null ? formatTokenCount(payload.totalTokens.cacheWrite) : undefined,
        totalTokensTotalHuman: payload.totalTokens?.total != null ? formatTokenCount(payload.totalTokens.total) : undefined,
        // 项目级 Token 用量
        projectCost: payload.projectCost != null ? String(payload.projectCost) : undefined,
        projectCostFormatted: payload.projectCostFormatted,
        projectTokensInput: payload.projectTokens?.input != null ? String(payload.projectTokens.input) : undefined,
        projectTokensOutput: payload.projectTokens?.output != null ? String(payload.projectTokens.output) : undefined,
        projectTokensReasoning: payload.projectTokens?.reasoning != null ? String(payload.projectTokens.reasoning) : undefined,
        projectTokensCacheRead: payload.projectTokens?.cacheRead != null ? String(payload.projectTokens.cacheRead) : undefined,
        projectTokensCacheWrite: payload.projectTokens?.cacheWrite != null ? String(payload.projectTokens.cacheWrite) : undefined,
        projectTokensTotal: payload.projectTokens?.total != null ? String(payload.projectTokens.total) : undefined,
        projectRequestCount: payload.projectRequestCount != null ? String(payload.projectRequestCount) : undefined,
        projectTokensInputHuman: payload.projectTokens?.input != null ? formatTokenCount(payload.projectTokens.input) : undefined,
        projectTokensOutputHuman: payload.projectTokens?.output != null ? formatTokenCount(payload.projectTokens.output) : undefined,
        projectTokensReasoningHuman: payload.projectTokens?.reasoning != null ? formatTokenCount(payload.projectTokens.reasoning) : undefined,
        projectTokensCacheReadHuman: payload.projectTokens?.cacheRead != null ? formatTokenCount(payload.projectTokens.cacheRead) : undefined,
        projectTokensCacheWriteHuman: payload.projectTokens?.cacheWrite != null ? formatTokenCount(payload.projectTokens.cacheWrite) : undefined,
        projectTokensTotalHuman: payload.projectTokens?.total != null ? formatTokenCount(payload.projectTokens.total) : undefined,
        // 缓存命中率
        sessionCacheHitRate: calcCacheHitRate(payload.sessionTokens),
        totalCacheHitRate: calcCacheHitRate(payload.totalTokens),
        projectCacheHitRate: calcCacheHitRate(payload.projectTokens),
        // 静态系统变量
        hostname: staticSystemInfo.hostname,
        osType: staticSystemInfo.osType,
        osPlatform: staticSystemInfo.osPlatform,
        osRelease: staticSystemInfo.osRelease,
        osArch: staticSystemInfo.osArch,
        username: staticSystemInfo.username,
        nodeVersion: staticSystemInfo.nodeVersion,
        pluginVersion: staticSystemInfo.pluginVersion,
        opencodeVersion,
        // 动态系统变量
        processPid: String(process.pid),
        systemUptime: getCachedSystemUptime(),
        localIP: getLocalIP(),
      };

      // Resolve custom variables - merge after built-in vars are built
      if (config.customVariables && Object.keys(config.customVariables).length > 0) {
        // First, resolve custom variable values against built-in variables (single pass)
        const resolvedCustomVars: Record<string, string> = {};
        for (const [key, value] of Object.entries(config.customVariables)) {
          resolvedCustomVars[key] = renderTemplate(value, variables);
        }
        // Then merge into variables map (custom can override built-in)
        Object.assign(variables, resolvedCustomVars);
      }

      // System-level: record all event variables (always on, independent of channels)
      recordEventVariables(variables);

      // Process each channel using cached senders
      for (let i = 0; i < config.channels.length; i++) {
        const channel = config.channels[i];

        // Check if this event type is enabled for the channel
        // 显式配置优先，未配置时使用默认值
        const eventConfig = channel.events?.[eventType];
        const eventEnabled = eventConfig ?? EVENT_DEFAULTS[eventType];
        if (!eventEnabled) {
          continue;
        }

        // Get template (channel-specific or default)
        const template = channel.templates?.[eventType] ?? defaultTemplates[eventType];

        // Render templates
        const subject = template.subject ? renderTemplate(template.subject, variables) : '';
        const body = template.body ? renderTemplate(template.body, variables) : '';

        // Dispatch using cached sender
        const key = channel.name || `channel-${i}`;
        const sender = senders.get(key);
        if (sender) {
          const formatter = getFormatter(channel.type, channel);
          try {
            if (formatter) {
              // Format message for this channel type, then send via ChannelSender interface
              const formatted = formatter.format(subject, body, payload);
              await sender.send(formatted);
            } else {
              // Fallback: for channels without a formatter, use legacy subject/body signature
              await (sender as import('./email.js').EmailSender).send(subject, body);
            }
            logger.info(`Notification sent: ${eventType} -> ${key} (${payload.sessionId})`);
          } catch (error) {
            logger.error(`Failed to send notification (${eventType} -> ${key}): ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    },

    close: async (): Promise<void> => {
      // Close all cached senders (cleanup SMTP connections)
      const closePromises = Array.from(senders.values()).map(sender => sender.close());
      await Promise.all(closePromises);
      senders.clear();
    },

    setOpenCodeVersion: (version: string): void => {
      opencodeVersion = version;
    },
  };
}
