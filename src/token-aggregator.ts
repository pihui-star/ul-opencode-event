/**
 * Token Aggregation Module
 *
 * Applies a usage snapshot (session / total / project) onto an EventPayload
 * and formats the derived cost strings.
 *
 * Dependency direction: token-aggregator <- plugin-core
 * This module imports NO other internal modules (except types).
 */
import type { EventPayload, TokenBreakdown } from './types.js';
import type { UsageTotals } from './usage.js';

/**
 * Fill token/cost data into an EventPayload.
 *
 * @param payload   the payload to enrich
 * @param session   usage of the session that produced the event
 * @param total     usage of the session plus all of its descendants
 * @param project   usage of every session of the project
 */
export function fillTokenData(
  payload: EventPayload,
  session: UsageTotals,
  total: UsageTotals,
  project: UsageTotals,
  configLanguage?: string,
  configCost?: import('./types.js').CostConfig,
  resolveCostConfigFn?: typeof import('./cost.js').resolveCostConfig,
  formatCostFn?: typeof import('./cost.js').formatCost,
): void {
  // Session-level
  payload.sessionCost = session.cost;
  payload.sessionTokens = { ...session.tokens };
  payload.sessionRequestCount = session.requestCount;

  // Total-level (session + sub-sessions)
  payload.totalCost = total.cost;
  payload.totalTokens = { ...total.tokens };
  payload.totalRequestCount = total.requestCount;

  // Project-level
  payload.projectCost = project.cost;
  payload.projectTokens = { ...project.tokens };
  payload.projectRequestCount = project.requestCount;

  if (resolveCostConfigFn && formatCostFn) {
    const resolved = resolveCostConfigFn(configLanguage, configCost);
    payload.costFormatted = formatCostFn(session.cost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
    payload.totalCostFormatted = formatCostFn(total.cost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
    payload.projectCostFormatted = formatCostFn(project.cost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
    payload.currency = resolved.currency;
  }
}

/**
 * Zeroed token breakdown (used when a session has no usage data yet).
 */
export function zeroTokens(): TokenBreakdown {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}
