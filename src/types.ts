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
  includeSessionTypes?: SessionType[]; // 包含的会话类型 (默认 ['main'])
  /** 自动更新开关（默认 true） */
  auto_update?: boolean;
}

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
 * Phase 1: Only SMTP is implemented
 */
export type ChannelType = 'smtp' | 'feishu' | 'dingtalk';

/**
 * Union type for channel-specific configurations
 */
export type ChannelConfig = SMTPConfig | FeishuConfig | DingtalkConfig;

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
 * Feishu channel configuration (placeholder for future)
 */
export interface FeishuConfig {
  webhook: string;
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
