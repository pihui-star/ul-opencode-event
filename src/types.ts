/**
 * Notification Plugin Type Definitions
 * Supports multi-channel notification with SMTP, Feishu, and DingTalk
 */

/**
 * Supported locale languages for default notification templates
 */
export type LocaleType = 'zh' | 'en';

/**
 * Main configuration interface for the notification plugin
 */
export interface NotificationConfig {
  channels: Channel[];
  timezone?: string;        // IANA 时区标识符，如 "Asia/Shanghai"
  language?: LocaleType;           // 默认提示模板语言 (默认 'en')
  includeSubagentEvents?: boolean; // 是否包含子代理事件 (默认 false)
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
  title?: string;           // question/permission 的标题
  questionText?: string;    // question 的完整问题文本
  options?: string;         // question 的选项摘要(JSON)
  permissionType?: string;  // permission 的类型(bash/edit等)
  statusType?: string;      // status 的类型(idle/busy/retry)
  commandName?: string;     // 执行的命令名
  arguments?: string;       // 命令参数
  filePath?: string;        // 被编辑的文件路径
  todoSummary?: string;     // todo列表摘要
  isSubagent?: boolean;     // 是否为子代理事件
  parentSessionId?: string; // 父会话ID（子代理事件时提供）
}

/**
 * Supported event types
 */
export type EventType = 'created' | 'idle' | 'error' | 'question' | 'permission' | 'status' | 'command' | 'fileEdited' | 'todo';
