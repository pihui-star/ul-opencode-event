/**
 * Multi-language default prompt templates for notifications.
 *
 * Each locale provides a complete set of templates for all event types.
 * The template variables ({{variableName}}) are language-agnostic and
 * shared across all locales — only the surrounding text is translated.
 */
import type { TemplateConfig, EventType } from './types.js';

export type LocaleType = 'zh' | 'en';

/** All supported locales with their display names */
export const SUPPORTED_LOCALES: Record<LocaleType, string> = {
  zh: '中文',
  en: 'English',
} as const;

/** Default timezone inferred from locale */
const LOCALE_TIMEZONE: Record<LocaleType, string> = {
  zh: 'Asia/Shanghai',
  en: 'America/New_York',
} as const;

/**
 * Default notification templates organized by locale.
 *
 * Structure: Record<locale, Record<eventType, TemplateConfig>>
 */
const localeTemplates: Record<LocaleType, Record<EventType, TemplateConfig>> = {
  en: {
    created: {
      subject: '[OpenCode] Task Started - {{projectName}}',
      body:
        'Task started at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    idle: {
      subject: '[OpenCode] Task Completed - {{projectName}}',
      body:
        'Task completed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nMessage: {{message}}\nDuration: {{duration}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    error: {
      subject: '[OpenCode] Task Error - {{projectName}}',
      body:
        'Error at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nError: {{error}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    question: {
      subject: '[OpenCode] Question - {{projectName}}',
      body:
        'OpenCode has a question at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nQuestion: {{title}}\n{{questionText}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    permission: {
      subject: '[OpenCode] Permission Required - {{projectName}}',
      body:
        'Permission needed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\n{{title}} ({{permissionType}})\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    status: {
      subject: '[OpenCode] Status Change - {{projectName}}',
      body:
        'Session status changed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nStatus: {{statusType}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    command: {
      subject: '[OpenCode] Command Executed - {{projectName}}',
      body:
        'Command executed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nCommand: {{commandName}} {{arguments}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    fileEdited: {
      subject: '[OpenCode] File Edited - {{projectName}}',
      body:
        'File edited at {{timestamp}}\nProject: {{projectName}}\nFile: {{filePath}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
    todo: {
      subject: '[OpenCode] Todos Updated - {{projectName}}',
      body:
        'Todos updated at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\n{{todoSummary}}\nAgent Type: {{isSubagent}}\nParent Session: {{parentSessionId}}',
    },
  },

  zh: {
    created: {
      subject: '[OpenCode] 任务已启动 - {{projectName}}',
      body:
        '任务启动时间: {{timestamp}}\n项目: {{projectName}}\n会话: {{sessionId}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    idle: {
      subject: '[OpenCode] 任务已完成 - {{projectName}}',
      body:
        '任务完成时间: {{timestamp}}\n项目: {{projectName}}\n会话: {{sessionId}}\n消息: {{message}}\n耗时: {{duration}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    error: {
      subject: '[OpenCode] 任务出错 - {{projectName}}',
      body:
        '错误发生时间: {{timestamp}}\n项目: {{projectName}}\n会话: {{sessionId}}\n错误信息: {{error}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    question: {
      subject: '[OpenCode] AI 提问 - {{projectName}}',
      body:
        'OpenCode 在 {{timestamp}} 向您提问\n项目: {{projectName}}\n会话: {{sessionId}}\n问题: {{title}}\n{{questionText}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    permission: {
      subject: '[OpenCode] 需要权限确认 - {{projectName}}',
      body:
        '{{timestamp}} 需要权限确认\n项目: {{projectName}}\n会话: {{sessionId}}\n{{title}} ({{permissionType}})\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    status: {
      subject: '[OpenCode] 状态变更 - {{projectName}}',
      body:
        '会话状态变更时间: {{timestamp}}\n项目: {{projectName}}\n会话: {{sessionId}}\n状态: {{statusType}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    command: {
      subject: '[OpenCode] 命令已执行 - {{projectName}}',
      body:
        '命令执行时间: {{timestamp}}\n项目: {{projectName}}\n会话: {{sessionId}}\n命令: {{commandName}} {{arguments}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    fileEdited: {
      subject: '[OpenCode] 文件已编辑 - {{projectName}}',
      body:
        '文件编辑时间: {{timestamp}}\n项目: {{projectName}}\n文件: {{filePath}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
    todo: {
      subject: '[OpenCode] Todo 已更新 - {{projectName}}',
      body:
        'Todo 更新时间: {{timestamp}}\n项目: {{projectName}}\n会话: {{sessionId}}\n{{todoSummary}}\n代理类型: {{isSubagent}}\n父会话: {{parentSessionId}}',
    },
  },
};

/**
 * Get the default templates for a given locale.
 * Falls back to English if the locale is not recognized.
 *
 * @param locale - Locale identifier ('zh' or 'en')
 * @returns Template set for the specified locale
 */
export function getDefaultTemplates(locale?: string): Record<EventType, TemplateConfig> {
  const key = (locale ?? 'en') as LocaleType;
  return localeTemplates[key] ?? localeTemplates.en;
}

/**
 * Validate whether a locale string is supported.
 *
 * @param locale - Locale string to validate
 * @returns true if the locale is supported
 */
export function isSupportedLocale(locale: string): locale is LocaleType {
  return locale in localeTemplates;
}

/**
 * Get the default timezone for a given locale.
 * Used when timezone is not explicitly configured but language is set.
 *
 * @param locale - Locale identifier ('zh' or 'en')
 * @returns IANA timezone string, or undefined if locale is unrecognized
 */
export function getDefaultTimezone(locale?: string): string | undefined {
  if (!locale) return undefined;
  const key = locale as LocaleType;
  return LOCALE_TIMEZONE[key];
}
