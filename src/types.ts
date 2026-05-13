/**
 * Notification Plugin Type Definitions
 * Supports multi-channel notification with SMTP, Feishu, and DingTalk
 */

/**
 * Supported locale languages for default notification templates
 */
export type LocaleType = 'zh' | 'en';

/**
 * Session type classification for event source identification
 * - main: Primary user session (default)
 * - subagent: Child session spawned by explore/librarian agents
 * - unknown: Session type could not be determined
 */
export type SessionType = 'main' | 'subagent' | 'unknown';

/** Default session types to include in notifications (backward compatible) */
export const DEFAULT_SESSION_TYPES: SessionType[] = ['main'];

/**
 * Main configuration interface for the notification plugin
 */
export interface NotificationConfig {
  channels: Channel[];
  timezone?: string;        // IANA 时区标识符，如 "Asia/Shanghai"
  language?: LocaleType;           // 默认提示模板语言 (默认 'en')
  /** 项目简称（默认取目录名 basename） */
  projectName?: string;
  includeSessionTypes?: SessionType[]; // 包含的会话类型 (默认 ['main'])
  /** 自动更新开关（默认 true） */
  auto_update?: boolean;
  /** 费用计算配置 */
  cost?: CostConfig;
  /** 自定义模板变量，key 必须匹配 VARIABLE_NAME_REGEX */
  customVariables?: Record<string, string>;
}

/**
 * Valid variable name pattern for customVariables keys.
 * Must match the template system's /\{\{(\w+)\}\}/g regex.
 */
export const VARIABLE_NAME_REGEX = /^\w+$/;

/**
 * Generic channel interface
 */
export interface Channel {
  type: ChannelType;
  enabled: boolean;
  name?: string;
  config: ChannelConfig;
  recipients?: string[];
  events: EventConfig;
  templates?: ChannelTemplates;
}

/**
 * Supported channel types
 */
export type ChannelType = 'smtp' | 'feishu' | 'dingtalk' | 'file';

/**
 * Union type for channel-specific configurations
 */
export type ChannelConfig = SMTPConfig | FeishuConfig | DingtalkConfig | FileConfig;

/**
 * SMTP channel configuration
 */
export interface SMTPConfig {
  host: string;
  port: number;
  secure?: boolean;
  /**
   * Local interface to bind for outgoing connections
   * - Use IPv4 address (e.g., "0.0.0.0", "192.168.1.1") to force IPv4
   * - Use IPv6 address (e.g., "::", "::1", "2001:db8::1") to force IPv6
   * - If not specified, both IPv4 and IPv6 are tried automatically
   */
  localAddress?: string;
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Feishu (Lark) custom robot channel configuration
 */
export interface FeishuConfig {
  webhook: string;
  /** Secret for HMAC-SHA256 signature verification */
  secret?: string;
}

/**
 * DingTalk channel configuration (placeholder for future)
 */
export interface DingtalkConfig {
  webhook: string;
  secret?: string;
  /** @mention configuration for DingTalk messages */
  at?: {
    /** Mobile numbers to @mention */
    atMobiles?: string[];
    /** Whether to @mention all members */
    atAll?: boolean;
  };
}

/**
 * File channel configuration for local file-based message logging
 */
export interface FileConfig {
  /** Output file path (default: ~/.local/share/opencode/ul-opencode-event-messages.log) */
  filePath?: string;
  /** Max file size in bytes before rotation (default: 1048576 = 1MB) */
  maxSizeBytes?: number;
}

/**
 * Event subscription configuration
 */
export interface EventConfig {
  created?: boolean;       // 默认开启 - 新会话创建
  idle?: boolean;         // 默认开启 - 会话完成
  error?: boolean;        // 默认开启 - 会话出错
  question?: boolean;     // 默认开启 - AI提问
  permission?: boolean;   // 默认开启 - 权限确认
  status?: boolean;       // 默认关闭 - 状态变化
  command?: boolean;      // 默认关闭 - 命令执行
  fileEdited?: boolean;   // 默认关闭 - 文件修改
  todo?: boolean;         // 默认关闭 - Todo更新
}

/**
 * Channel-specific templates for different events
 */
export interface ChannelTemplates {
  created?: TemplateConfig;
  idle?: TemplateConfig;
  error?: TemplateConfig;
  question?: TemplateConfig;
  permission?: TemplateConfig;
  status?: TemplateConfig;
  command?: TemplateConfig;
  fileEdited?: TemplateConfig;
  todo?: TemplateConfig;
}

/**
 * Email template configuration
 */
export interface TemplateConfig {
  subject?: string;
  body?: string;
}

/**
 * Event payload structure
 */
export interface EventPayload {
  eventType: EventType;
  timestamp: string;
  projectName: string;
  /** 项目完整路径 */
  projectPath?: string;
  sessionId: string;
  message?: string;
  error?: string;
  duration?: string;
  /** question/permission 事件的标题（非会话级别标题，会话标题见 sessionTitle） */
  title?: string;           // question/permission 的标题
  questionText?: string;    // question 的完整问题文本
  options?: string;         // question 的选项摘要(JSON)
  permissionType?: string;  // permission 的类型(bash/edit等)
  statusType?: string;      // status 的类型(idle/busy/retry)
  commandName?: string;     // 执行的命令名
  arguments?: string;       // 命令参数
  filePath?: string;        // 被编辑的文件路径
  todoSummary?: string;     // todo列表摘要
  sessionType: SessionType;       // 会话类型分类 (main/subagent/unknown)
  parentSessionId?: string; // 父会话ID（子代理事件时提供）
  /** 会话标题（来自 SDK Session.title） */
  sessionTitle?: string;
  /** 本次会话累计费用（美元原始值） */
  sessionCost?: number;
  /** 本次会话累计 Token 用量 */
  sessionTokens?: TokenBreakdown;
  /** 所有会话累计总费用（美元原始值） */
  totalCost?: number;
  /** 所有会话累计总 Token 用量 */
  totalTokens?: TokenBreakdown;
  /** 最后使用的模型 ID */
  modelID?: string;
  /** 最后使用的提供商 ID */
  providerID?: string;
  /** 最后使用的模式 */
  mode?: string;
  /** 本次会话费用格式化字符串（含货币符号） */
  costFormatted?: string;
  /** 总费用格式化字符串（含货币符号） */
  totalCostFormatted?: string;
  /** 货币代码（如 USD、CNY） */
  currency?: string;
  /** 项目累计费用 */
  projectCost?: number;
  /** 项目累计 Token 用量 */
  projectTokens?: TokenBreakdown;
  /** API request count for current session (assistant messages count) */
  sessionRequestCount?: number;
  /** API request count including all sub-sessions */
  totalRequestCount?: number;
  /** API request count across all sessions in this project */
  projectRequestCount?: number;
  /** 项目累计费用格式化字符串（含货币符号） */
  projectCostFormatted?: string;
}

/**
 * Supported event types
 */
export type EventType = 'created' | 'idle' | 'error' | 'question' | 'permission' | 'status' | 'command' | 'fileEdited' | 'todo';

/**
 * Generic channel sender interface - abstracts sending logic for any channel
 */
export interface ChannelSender {
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * Formatted message body - channel-native message structure defined by each formatter
 */
export interface FormattedMessage {
  [key: string]: unknown;
}

/**
 * Channel formatter interface - converts generic subject/body into channel-specific format
 */
export interface ChannelFormatter {
  format(subject: string, body: string, payload: EventPayload): FormattedMessage;
}

/**
 * @deprecated Use ChannelSender instead. Kept for backward compatibility.
 * Legacy email sender interface with subject/body parameters.
 */
export interface EmailSender {
  send(subject: string, body: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Token usage breakdown - flattened from SDK AssistantMessage.tokens
 * (cache.read -> cacheRead, cache.write -> cacheWrite for template convenience)
 */
export interface TokenBreakdown {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/**
 * Token and cost data for a single assistant message
 */
export interface TokenData {
  /** 消息费用（美元） */
  cost: number;
  /** Token 用量明细 */
  tokens: TokenBreakdown;
  /** 模型 ID */
  modelID: string;
  /** 提供商 ID */
  providerID: string;
  /** 模式 */
  mode: string;
}

/**
 * Token and cost data aggregated for a session
 */
export interface SessionTokenData {
  /** 消息级 Token 数据（key 为 message ID） */
  messages: Map<string, TokenData>;
  /** 最后使用的模型 ID */
  lastModelID: string;
  /** 最后使用的提供商 ID */
  lastProviderID: string;
  /** 最后使用的模式 */
  lastMode: string;
  /** 项目路径（用于按项目聚合 token 数据） */
  projectPath?: string;
}

/**
 * Cached aggregate token data for a completed session.
 * Written to JSONL cache file on session completion (idle/error/status events).
 * Used for accurate project-level token aggregation across all historical sessions.
 */
export interface SessionCacheEntry {
  /** Session ID (unique key for deduplication) */
  sessionId: string;
  /** Project path for filtering during project-level aggregation */
  projectPath: string;
  /** Token usage aggregated via sumAllCompletedTokens */
  tokens: TokenBreakdown;
  /** Cumulative cost across all messages in the session */
  cost: number;
  /** Model ID from the last message */
  modelID: string;
  /** Provider ID from the last message */
  providerID: string;
  /** Mode from the last message */
  mode: string;
  /** Number of API requests (assistant messages) in this session */
  requestCount: number;
  /** ISO 8601 timestamp of when this cache entry was written */
  updatedAt: string;
}

/**
 * 费用计算配置（用户可配置）
 */
export interface CostConfig {
  /** 货币类型 */
  currency?: 'USD' | 'CNY';
  /** 汇率（1 USD = X CNY） */
  exchangeRate?: number;
  /** 小数位数（默认 4） */
  decimalPlaces?: number;
  /** 是否启用在线汇率获取（默认 false） */
  enableOnlineRate?: boolean;
}

/**
 * 解析后的费用配置（运行时使用，所有字段必填）
 */
export interface ResolvedCostConfig {
  /** 货币代码 */
  currency: string;
  /** 汇率 */
  exchangeRate: number;
  /** 小数位数 */
  decimalPlaces: number;
  /** 货币符号 */
  currencySymbol: string;
}

/** 支持的货币类型列表 */
export const SUPPORTED_CURRENCIES = ['USD', 'CNY'] as const;
