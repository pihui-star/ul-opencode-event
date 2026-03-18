/**
 * Notification Plugin Type Definitions
 * Supports multi-channel notification with SMTP, Feishu, and DingTalk
 */

/**
 * Main configuration interface for the notification plugin
 */
export interface NotificationConfig {
  channels: Channel[];
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
  created?: boolean;
  idle?: boolean;
  error?: boolean;
}

/**
 * Channel-specific templates for different events
 */
export interface ChannelTemplates {
  created?: TemplateConfig;
  idle?: TemplateConfig;
  error?: TemplateConfig;
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
}

/**
 * Supported event types
 */
export type EventType = 'created' | 'idle' | 'error';
