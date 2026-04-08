import { describe, test, expect } from 'bun:test';
import {
  getDefaultTemplates,
  getDefaultTimezone,
  isSupportedLocale,
  SUPPORTED_LOCALES,
} from '../src/locales';
import type { EventType } from '../src/types';

describe('SUPPORTED_LOCALES', () => {
  test('contains zh and en', () => {
    expect(SUPPORTED_LOCALES.zh).toBe('中文');
    expect(SUPPORTED_LOCALES.en).toBe('English');
    expect(Object.keys(SUPPORTED_LOCALES)).toEqual(['zh', 'en']);
  });
});

describe('isSupportedLocale', () => {
  test('returns true for zh', () => {
    expect(isSupportedLocale('zh')).toBe(true);
  });

  test('returns true for en', () => {
    expect(isSupportedLocale('en')).toBe(true);
  });

  test('returns false for unsupported locale', () => {
    expect(isSupportedLocale('ja')).toBe(false);
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
  });
});

describe('getDefaultTemplates', () => {
  test('returns English templates by default (no locale)', () => {
    const templates = getDefaultTemplates();
    expect(templates.created.subject).toContain('Task Started');
    expect(templates.created.subject).toContain('{{projectName}}');
  });

  test('returns English templates for "en"', () => {
    const templates = getDefaultTemplates('en');
    expect(templates.idle.subject).toContain('Task Completed');
    expect(templates.idle.subject).toContain('{{projectName}}');
    expect(templates.error.body).toContain('Error at');
  });

  test('returns Chinese templates for "zh"', () => {
    const templates = getDefaultTemplates('zh');
    expect(templates.idle.subject).toContain('任务已完成');
    expect(templates.idle.subject).toContain('{{projectName}}');
    expect(templates.error.body).toContain('错误信息');
  });

  test('falls back to English for unknown locale', () => {
    const templates = getDefaultTemplates('ja');
    expect(templates.created.subject).toContain('Task Started');
  });

  test('all event types are present for each locale', () => {
    const expectedEvents: EventType[] = [
      'created', 'idle', 'error', 'question', 'permission',
      'status', 'command', 'fileEdited', 'todo',
    ];

    for (const locale of ['zh', 'en']) {
      const templates = getDefaultTemplates(locale);
      for (const event of expectedEvents) {
        expect(templates[event]).toBeDefined();
        expect(templates[event].subject).toBeDefined();
        expect(templates[event].body).toBeDefined();
      }
    }
  });

  test('all subjects start with [{{projectName}}]', () => {
    const eventTypes: EventType[] = [
      'created', 'idle', 'error', 'question', 'permission',
      'status', 'command', 'fileEdited', 'todo',
    ];

    for (const locale of ['zh', 'en']) {
      const templates = getDefaultTemplates(locale);
      for (const event of eventTypes) {
        expect(templates[event].subject).toMatch(/^\[\{\{projectName\}\}\]/);
      }
    }
  });

  test('bodies do not contain sessionType or parentSessionId', () => {
    const eventTypes: EventType[] = [
      'created', 'idle', 'error', 'question', 'permission',
      'status', 'command', 'fileEdited', 'todo',
    ];

    for (const locale of ['zh', 'en']) {
      const templates = getDefaultTemplates(locale);
      for (const event of eventTypes) {
        expect(templates[event].body).not.toContain('{{sessionType}}');
        expect(templates[event].body).not.toContain('{{parentSessionId}}');
      }
    }
  });

  test('bodies do not contain old Project: or 项目: labels', () => {
    const eventTypes: EventType[] = [
      'created', 'idle', 'error', 'question', 'permission',
      'status', 'command', 'fileEdited', 'todo',
    ];

    for (const locale of ['zh', 'en']) {
      const templates = getDefaultTemplates(locale);
      for (const event of eventTypes) {
        const body = templates[event].body ?? '';
        expect(body).not.toContain('项目:');
        expect(body).not.toContain('Project:');
      }
    }
  });
});

describe('getDefaultTimezone', () => {
  test('returns Asia/Shanghai for zh', () => {
    expect(getDefaultTimezone('zh')).toBe('Asia/Shanghai');
  });

  test('returns America/New_York for en', () => {
    expect(getDefaultTimezone('en')).toBe('America/New_York');
  });

  test('returns undefined when no locale provided', () => {
    expect(getDefaultTimezone()).toBeUndefined();
  });

  test('returns undefined for unknown locale', () => {
    expect(getDefaultTimezone('ja')).toBeUndefined();
    expect(getDefaultTimezone('fr')).toBeUndefined();
  });
});
