/**
 * Notification Plugin Entry Point
 *
 * One package that works with both OpenCode 1.x and 2.x:
 *
 * - OpenCode 2.x reads `setup(ctx)` from the default export
 *   (the `Plugin.define()` shape).
 * - OpenCode 1.x (>= 1.18.29) reads `server(input)` from the same default
 *   export (the `{ id, server }` shape).
 *
 * Both implementations share the channel stack (handler / formatters /
 * locales / templates); only the event plumbing differs.
 */
import { Plugin } from '@opencode/plugin';
import { PLUGIN_ID, setupPlugin } from './plugin-core.js';
import { createV1Plugin } from './v1/plugin-v1.js';

export default {
  ...Plugin.define({ id: PLUGIN_ID, setup: setupPlugin }),
  server: createV1Plugin,
};

// Re-export types needed by consumers (tests, handler, etc.)
// NOTE: do not export runtime functions here - OpenCode 1.x treats every
// exported function as a plugin factory when the default export is not
// recognized.
export type {
  EventPayload,
  EventType,
  SessionType,
  SessionTokenData,
  SessionMeta,
  TokenData,
  TokenBreakdown,
  SessionCacheEntry,
} from './types.js';
