/**
 * Notification Plugin Entry Point - Pure re-export thin shell
 * All logic has been split into focused modules:
 * - token-aggregator.ts: Token/cost aggregation functions + projectAgg state
 * - event-mapper.ts: SDK event to EventPayload conversion
 * - plugin-core.ts: NotificationPlugin, plugin lifecycle, test helpers
 */
export { NotificationPlugin } from './plugin-core.js';
export { default } from './plugin-core.js';
// Re-export types needed by consumers (tests, handler, etc.)
export type { EventPayload, EventType, SessionType, SessionTokenData, TokenData, TokenBreakdown, SessionCacheEntry } from './types.js';
