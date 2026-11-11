/**
 * OpenCode v1 event adapter.
 *
 * Converts a v1 SDK event (`event.properties`) into the v2 event envelope
 * (`{ type, data }`) so the shared event mapper can be reused by both
 * implementations.
 *
 * Mapping:
 * | v1 event          | v2 event                |
 * |-------------------|-------------------------|
 * | session.created   | session.created         |
 * | session.idle      | session.idle            |
 * | session.error     | session.execution.failed|
 * | session.status    | session.status          |
 * | question.asked    | form.created            |
 * | permission.updated| permission.asked        |
 * | command.executed  | session.shell.ended     |
 * | file.edited       | filesystem.changed      |
 * | todo.updated      | todo.updated            |
 */

/** v1 SDK event (subset). */
export interface V1Event {
  type: string;
  properties?: Record<string, unknown>;
}

/** v2 event envelope used by the shared event mapper. */
export interface V2Event {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Adapt a v1 event to the v2 envelope.
 * Returns null when the event has no notification equivalent.
 */
export function adaptV1Event(event: V1Event): V2Event | null {
  const props = (event.properties ?? {}) as Record<string, unknown>;
  const sessionID = typeof props.sessionID === 'string' ? props.sessionID : '';

  switch (event.type) {
    case 'session.created': {
      const info = (props.info ?? {}) as {
        id?: string;
        title?: string;
        parentID?: string;
      };
      return {
        type: 'session.created',
        data: {
          sessionID: info.id ?? sessionID,
          title: info.title,
          parentID: info.parentID,
        },
      };
    }

    case 'session.idle':
      return { type: 'session.idle', data: { sessionID } };

    case 'session.error':
      return {
        type: 'session.execution.failed',
        data: { sessionID, error: props.error },
      };

    case 'session.status':
      return {
        type: 'session.status',
        data: { sessionID, status: props.status },
      };

    case 'question.asked': {
      const questions = (props.questions ?? []) as Array<{
        header?: string;
        question?: string;
        options?: unknown;
      }>;
      const first = questions[0];
      return {
        type: 'form.created',
        data: {
          form: {
            id: '',
            sessionID,
            title: first?.header,
            fields: questions.map((q) => ({
              label: q.header,
              description: q.question,
              options: q.options,
            })),
          },
        },
      };
    }

    case 'permission.updated': {
      const perm = props as { title?: string; type?: string };
      return {
        type: 'permission.asked',
        data: {
          sessionID,
          action: perm.type,
          resources: perm.title ? [perm.title] : [],
          message: perm.title,
        },
      };
    }

    case 'command.executed': {
      const cmd = props as { name?: string; arguments?: string };
      return {
        type: 'session.shell.ended',
        data: {
          sessionID,
          shell: { command: cmd.name, status: cmd.arguments },
        },
      };
    }

    case 'file.edited':
      return {
        type: 'filesystem.changed',
        data: { file: props.file, event: 'change' },
      };

    case 'todo.updated':
      return { type: 'todo.updated', data: { sessionID, todos: props.todos } };

    default:
      return null;
  }
}
