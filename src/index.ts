/**
 * Notification Plugin Entry Point - Pure re-export thin shell
 * All logic has been split into focused modules:
 * - usage.ts: token/cost aggregation from the database + live events
 * - token-aggregator.ts: usage snapshot -> EventPayload
 * - event-mapper.ts: v2 server event to EventPayload conversion
 * - plugin-core.ts: v2 plugin definition (Plugin.define), lifecycle, tool
 */
export { setupPlugin, PLUGIN_ID } from './plugin-core.js';
export { default } from './plugin-core.js';
// Re-export types needed by consumers (tests, handler, etc.)
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
