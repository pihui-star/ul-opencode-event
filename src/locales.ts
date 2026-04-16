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
      subject: '[{{projectName}}] Task Started',
      body:
        'Task started at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})',
    },
    idle: {
      subject: '[{{projectName}}] Task Completed',
      body:
        'Task completed at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\nMessage: {{message}}\nDuration: {{duration}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    error: {
      subject: '[{{projectName}}] Task Error',
      body:
        'Error at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\nError: {{error}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    question: {
      subject: '[{{projectName}}] Question',
      body:
        'OpenCode has a question at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\nQuestion: {{title}}\n{{questionText}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    permission: {
      subject: '[{{projectName}}] Permission Required',
      body:
        'Permission needed at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\n{{title}} ({{permissionType}})\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    status: {
      subject: '[{{projectName}}] Status Change',
      body:
        'Session status changed at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\nStatus: {{statusType}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    command: {
      subject: '[{{projectName}}] Command Executed',
      body:
        'Command executed at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\nCommand: {{commandName}} {{arguments}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    fileEdited: {
      subject: '[{{projectName}}] File Edited',
      body:
        'File edited at {{timestamp}}\nFile: {{filePath}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    todo: {
      subject: '[{{projectName}}] Todos Updated',
      body:
        'Todos updated at {{timestamp}}\nSession: {{sessionTitle}} ({{sessionId}})\n{{todoSummary}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
  },

  zh: {
    created: {
      subject: '[{{projectName}}] 任务已启动',
      body:
        '任务启动时间: {{timestamp}}\n会话: {{sessionTitle}} ({{sessionId}})',
    },
    idle: {
      subject: '[{{projectName}}] 任务已完成',
      body:
        '任务完成时间: {{timestamp}}\n会话: {{sessionTitle}} ({{sessionId}})\n消息: {{message}}\n耗时: {{duration}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    error: {
      subject: '[{{projectName}}] 任务出错',
      body:
        '错误发生时间: {{timestamp}}\n会话: {{sessionTitle}} ({{sessionId}})\n错误信息: {{error}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    question: {
      subject: '[{{projectName}}] AI 提问',
      body:
        'OpenCode 在 {{timestamp}} 向您提问\n会话: {{sessionTitle}} ({{sessionId}})\n问题: {{title}}\n{{questionText}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    permission: {
      subject: '[{{projectName}}] 需要权限确认',
      body:
        '{{timestamp}} 需要权限确认\n会话: {{sessionTitle}} ({{sessionId}})\n{{title}} ({{permissionType}})\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    status: {
      subject: '[{{projectName}}] 状态变更',
      body:
        '会话状态变更时间: {{timestamp}}\n会话: {{sessionTitle}} ({{sessionId}})\n状态: {{statusType}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    command: {
      subject: '[{{projectName}}] 命令已执行',
      body:
        '命令执行时间: {{timestamp}}\n会话: {{sessionTitle}} ({{sessionId}})\n命令: {{commandName}} {{arguments}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    fileEdited: {
      subject: '[{{projectName}}] 文件已编辑',
      body:
        '文件编辑时间: {{timestamp}}\n文件: {{filePath}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
    },
    todo: {
      subject: '[{{projectName}}] Todo 已更新',
      body:
        'Todo 更新时间: {{timestamp}}\n会话: {{sessionTitle}} ({{sessionId}})\n{{todoSummary}}\n\nToken({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}',
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
