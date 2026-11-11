/**
 * Event Mapper Module (OpenCode v2)
 * Converts v2 server events to internal EventPayload format.
 *
 * v2 event envelope: `{ type: string, data: {...} }` (v1 used `properties`).
 *
 * Token/cost data is NOT filled here - it is injected by the plugin core
 * from the usage snapshot (database + live events).
 */
import type { EventPayload, EventType, SessionType, SessionMeta } from './types.js';

/**
 * OpenCode v2 server event (subset we care about).
 * The full union lives in @opencode/client; we only need type + data.
 */
export interface V2Event {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Resolve session type from session metadata.
 * - undefined/missing -> 'unknown' (race condition or filesystem event)
 * - has parentID -> 'subagent' (child of main session)
 * - no parentID -> 'main' (primary user session)
 */
export function resolveSessionType(sessionInfo?: SessionMeta): SessionType {
  if (!sessionInfo) return 'unknown';
  if (sessionInfo.parentID !== undefined && sessionInfo.parentID !== '') return 'subagent';
  return 'main';
}

/**
 * Convert an OpenCode v2 event to the internal EventPayload.
 * Returns null when the event type is not mapped to a notification.
 */
export function eventToPayload(
  event: V2Event,
  projectName: string,
  sessionInfo: SessionMeta | undefined,
  timezone: string | undefined,
  projectPath: string | undefined,
): EventPayload | null {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const sessionID = typeof data.sessionID === 'string' ? data.sessionID : '';

  const basePayload = {
    timestamp: formatTimestamp(new Date().toISOString(), timezone),
    projectName,
    projectPath,
    sessionId: sessionID,
    sessionTitle: undefined,
  };

  const sessionCommon = {
    sessionTitle: sessionInfo?.title,
    sessionType: resolveSessionType(sessionInfo),
    parentSessionId: sessionInfo?.parentID ?? undefined,
  };

  switch (event.type) {
    case 'session.created': {
      const created = data as {
        sessionID?: string;
        title?: string;
        parentID?: string;
      };
      const parentID = created.parentID ?? sessionInfo?.parentID;
      return {
        ...basePayload,
        eventType: 'created',
        sessionId: created.sessionID ?? sessionID,
        sessionTitle: created.title ?? sessionInfo?.title,
        sessionType: resolveSessionType(sessionInfo ?? (parentID ? { id: created.sessionID ?? '', parentID } : undefined)),
        parentSessionId: parentID,
      };
    }

    case 'session.idle': {
      return {
        ...basePayload,
        eventType: 'idle',
        message: 'Task completed successfully',
        duration: sessionInfo?.createdAt ? formatDuration(Date.now() - sessionInfo.createdAt) : undefined,
        ...sessionCommon,
      };
    }

    case 'session.execution.failed': {
      const failed = data as { error?: unknown };
      return {
        ...basePayload,
        eventType: 'error',
        error: failed.error ? formatError(failed.error) : 'Unknown error',
        ...sessionCommon,
      };
    }

    case 'session.status': {
      const statusEvent = data as { status?: { type?: string } };
      const statusType = statusEvent.status?.type;
      // status(idle) 等价于任务完成（session.idle），让 idle 通道能接住该信号
      const effectiveEventType: EventType = statusType === 'idle' ? 'idle' : 'status';
      return {
        ...basePayload,
        eventType: effectiveEventType,
        statusType,
        message: effectiveEventType === 'idle' ? 'Task completed successfully' : undefined,
        duration:
          effectiveEventType === 'idle' && sessionInfo?.createdAt
            ? formatDuration(Date.now() - sessionInfo.createdAt)
            : undefined,
        ...sessionCommon,
      };
    }

    case 'permission.asked': {
      const perm = data as { action?: string; resources?: string[]; message?: string };
      const resource = perm.resources?.[0];
      const title = perm.message ?? (resource ? `${perm.action ?? 'permission'}: ${resource}` : perm.action);
      return {
        ...basePayload,
        eventType: 'permission',
        title,
        permissionType: perm.action,
        ...sessionCommon,
      };
    }

    case 'form.created': {
      // v2 中 AI 提问以表单(form)形式出现
      const form = (data.form ?? {}) as Record<string, unknown>;
      const question = extractFormQuestion(form);
      return {
        ...basePayload,
        eventType: 'question',
        sessionId: typeof form.sessionID === 'string' ? form.sessionID : sessionID,
        title: question.title,
        questionText: question.questionText,
        options: question.options,
        ...sessionCommon,
      };
    }

    case 'session.shell.ended': {
      const shell = (data.shell ?? {}) as { command?: string; status?: string; exit?: number };
      return {
        ...basePayload,
        eventType: 'command',
        commandName: shell.command,
        arguments: shell.status ?? (shell.exit !== undefined ? `exit=${shell.exit}` : undefined),
        ...sessionCommon,
      };
    }

    case 'filesystem.changed': {
      const fsEvent = data as { file?: string };
      return {
        ...basePayload,
        eventType: 'fileEdited',
        filePath: fsEvent.file,
        ...sessionCommon,
      };
    }

    default:
      return null;
  }
}

/**
 * Extract the first question of a v2 form payload.
 * v2 form fields shape varies by field type; handled defensively.
 */
function extractFormQuestion(form: Record<string, unknown>): {
  title?: string;
  questionText?: string;
  options?: string;
} {
  const rawFields = form.fields;
  const first = Array.isArray(rawFields)
    ? rawFields[0]
    : rawFields && typeof rawFields === 'object'
      ? Object.values(rawFields as Record<string, unknown>)[0]
      : undefined;
  const field = (first ?? {}) as Record<string, unknown>;

  const title = pickString(form, ['title']) ?? pickString(field, ['label', 'name', 'title']);
  const questionText =
    pickString(field, ['description', 'instructions', 'prompt', 'question']) ?? pickString(form, ['description']);

  const rawOptions = field.options ?? field.choices ?? field.values;
  let options: string | undefined;
  if (Array.isArray(rawOptions) && rawOptions.length > 0) {
    options = JSON.stringify(rawOptions);
  }

  return { title, questionText, options };
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format timestamp with optional timezone conversion.
 * When timezone is not configured, returns original ISO string (backward compatible).
 * When timezone is configured, returns localized time string using Intl.DateTimeFormat.
 * Invalid timezone strings gracefully fall back to UTC.
 */
export function formatTimestamp(isoString: string, timezone?: string): string {
  if (!timezone) {
    return isoString;
  }
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Format error object to string
 */
export function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error) return String((error as { message: unknown }).message);
    return JSON.stringify(error);
  }
  return String(error);
}
