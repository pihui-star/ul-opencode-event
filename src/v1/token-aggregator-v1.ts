/**
 * Token Aggregation Module
 * Handles all token/cost aggregation logic:
 * - Session-level aggregation (aggregateSessionTokens)
 * - Cumulative sum (sumAllCompletedTokens)
 * - Sub-session aggregation (aggregateSubSessions)
 * - Project-level fill (fillProjectData)
 * - Incremental project counter (projectAgg)
 *
 * Dependency direction: token-aggregator <- event-mapper <- plugin-core
 * This module imports NO other internal modules (except types/logger).
 */
import type { EventPayload, SessionTokenData, TokenBreakdown, SessionCacheEntry, SessionMeta } from '../types.js';

/**
 * Aggregate token data for a session from its SessionTokenData.
 * Cost is summed across all messages; token fields use the last message
 * (matches OpenCode UI behavior where TrackUsage uses = not +=).
 * Total excludes reasoning (matches OpenCode UI formula).
 */
export function aggregateSessionTokens(sessionData: SessionTokenData): { cost: number; tokens: TokenBreakdown } {
  const ZERO_TOKENS: TokenBreakdown = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (sessionData.messages.size === 0) {
    return { cost: 0, tokens: { ...ZERO_TOKENS } };
  }

  // Cost accumulates across all messages
  let cost = 0;
  for (const td of sessionData.messages.values()) {
    cost += td.cost;
  }

  // Token fields use the last message with non-zero total (Map preserves insertion order).
  // During streaming, a newly created assistant message may have token=0.
  // Fall back to the most recent completed message to avoid showing 0.
  const entries = [...sessionData.messages.values()];
  let bestTokens: TokenBreakdown | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const t = entries[i].tokens;
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) {
      bestTokens = t;
      break;
    }
  }
  if (!bestTokens) {
    // All messages have zero tokens (e.g. session just started)
    bestTokens = entries[entries.length - 1].tokens;
  }

  const input = bestTokens.input;
  const output = bestTokens.output;
  const reasoning = bestTokens.reasoning;
  const cacheRead = bestTokens.cacheRead;
  const cacheWrite = bestTokens.cacheWrite;
  // total excludes reasoning (matches OpenCode UI formula)
  const total = input + output + cacheRead + cacheWrite;

  return { cost, tokens: { input, output, reasoning, cacheRead, cacheWrite, total } };
}

/**
 * Sum token fields from ALL completed messages (total > 0) in a session.
 * Used for totalTokens to ensure it reflects accumulated work,
 * not affected by streaming intermediate states (token=0).
 */
export function sumAllCompletedTokens(sessionData: SessionTokenData): TokenBreakdown {
  const ZERO_TOKENS: TokenBreakdown = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (sessionData.messages.size === 0) {
    return { ...ZERO_TOKENS };
  }

  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  for (const td of sessionData.messages.values()) {
    const t = td.tokens;
    // Only accumulate messages with non-zero usage (skip streaming intermediates)
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) {
      input += t.input;
      output += t.output;
      reasoning += t.reasoning;
      cacheRead += t.cacheRead;
      cacheWrite += t.cacheWrite;
    }
  }

  // total excludes reasoning (matches OpenCode UI formula)
  return { input, output, reasoning, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/**
 * Collect all descendant session IDs recursively (children, grandchildren, etc.)
 */
export function collectDescendantSessionIds(parentId: string, sessionMap: Map<string, SessionMeta>): string[] {
  const descendants: string[] = [];
  for (const [sid, sInfo] of sessionMap) {
    if (sInfo.parentID === parentId) {
      descendants.push(sid);
      descendants.push(...collectDescendantSessionIds(sid, sessionMap));
    }
  }
  return descendants;
}

/**
 * Fill token/cost data into an EventPayload from tokenDataMap.
 * Computes sessionCost and formatted strings.
 * Skips session.created events (no token data at creation time).
 */
export function fillTokenData(
  payload: EventPayload,
  tokenDataMap?: Map<string, SessionTokenData>,
  configLanguage?: string,
  configCost?: import('../types.js').CostConfig,
  resolveCostConfigFn?: typeof import('../cost.js').resolveCostConfig,
  formatCostFn?: typeof import('../cost.js').formatCost,
): void {
  if (!tokenDataMap) return;
  if (payload.eventType === 'created') return;

  const sessionId = payload.sessionId;
  const sessionData = tokenDataMap.get(sessionId);

  // Empty session (no message.updated events) gets all-zero token data
  const ZERO_TOKENS: TokenBreakdown = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (!sessionData) {
    payload.sessionCost = 0;
    payload.sessionTokens = { ...ZERO_TOKENS };
    payload.totalCost = 0;
    payload.totalTokens = { ...ZERO_TOKENS };
    payload.sessionRequestCount = 0;
    payload.totalRequestCount = 0;
    if (resolveCostConfigFn && formatCostFn) {
      const resolved = resolveCostConfigFn(configLanguage, configCost);
      payload.costFormatted = formatCostFn(0, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
      payload.totalCostFormatted = payload.costFormatted;
      payload.currency = resolved.currency;
    }
    return;
  }

  // Session-level aggregation
  const sessionAgg = aggregateSessionTokens(sessionData);
  payload.sessionCost = sessionAgg.cost;
  payload.sessionTokens = sessionAgg.tokens;
  payload.modelID = sessionData.lastModelID;
  payload.providerID = sessionData.lastProviderID;
  payload.mode = sessionData.lastMode;

  // Request count: session-level (assistant messages count)
  payload.sessionRequestCount = sessionData.messages.size;
  // Initialize total to session level (sub-sessions will be added by aggregateSubSessions)
  payload.totalRequestCount = sessionData.messages.size;

  // Total tokens use cumulative sum of all completed messages (reliable during streaming)
  // sub-sessions added later by aggregateSubSessions
  payload.totalCost = sessionAgg.cost;
  payload.totalTokens = sumAllCompletedTokens(sessionData);

  // Cost formatting
  if (resolveCostConfigFn && formatCostFn) {
    const resolved = resolveCostConfigFn(configLanguage, configCost);
    payload.costFormatted = formatCostFn(sessionAgg.cost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
    payload.totalCostFormatted = payload.costFormatted;
    payload.currency = resolved.currency;
  }
}

/**
 * Scans tokenDataMap for all descendant sessions (children, grandchildren, etc.)
 * of the current session and aggregates their token data.
 */
export function aggregateSubSessions(
  payload: EventPayload,
  tokenDataMap: Map<string, SessionTokenData>,
  sessionMap: Map<string, SessionMeta>,
  configLanguage?: string,
  configCost?: import('../types.js').CostConfig,
  resolveCostConfigFn?: typeof import('../cost.js').resolveCostConfig,
  formatCostFn?: typeof import('../cost.js').formatCost,
): void {
  const sessionId = payload.sessionId;
  if (payload.sessionCost === undefined) return;

  let totalCost = payload.sessionCost;
  const tt = payload.totalTokens!;
  let totalInput = tt.input;
  let totalOutput = tt.output;
  let totalReasoning = tt.reasoning;
  let totalCacheRead = tt.cacheRead;
  let totalCacheWrite = tt.cacheWrite;
  let totalRequestCount = payload.totalRequestCount ?? 0;

  // Collect ALL descendants (direct children + grandchildren + deeper)
  const descendantIds = collectDescendantSessionIds(sessionId, sessionMap);
  for (const descendantId of descendantIds) {
    const sData = tokenDataMap.get(descendantId);
    if (!sData) continue;
    const subCost = [...sData.messages.values()].reduce((sum, td) => sum + td.cost, 0);
    const subTokens = sumAllCompletedTokens(sData);
    totalCost += subCost;
    totalInput += subTokens.input;
    totalOutput += subTokens.output;
    totalReasoning += subTokens.reasoning;
    totalCacheRead += subTokens.cacheRead;
    totalCacheWrite += subTokens.cacheWrite;
    totalRequestCount += sData.messages.size;
  }

  payload.totalCost = totalCost;
  payload.totalTokens = {
    input: totalInput,
    output: totalOutput,
    reasoning: totalReasoning,
    cacheRead: totalCacheRead,
    cacheWrite: totalCacheWrite,
    total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
  };
  payload.totalRequestCount = totalRequestCount;

  // Re-format totalCostFormatted with the aggregated total
  if (resolveCostConfigFn && formatCostFn) {
    const resolved = resolveCostConfigFn(configLanguage, configCost);
    payload.totalCostFormatted = formatCostFn(totalCost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
  }
}

/**
 * Fill project-level token/cost data into an EventPayload.
 * Reads from incrementally maintained projectAgg counter (O(1)).
 */
export function fillProjectData(
  payload: EventPayload,
  _tokenDataMap: Map<string, SessionTokenData>,
  _projectPath: string,
  configLanguage?: string,
  configCost?: import('../types.js').CostConfig,
  resolveCostConfigFn?: typeof import('../cost.js').resolveCostConfig,
  formatCostFn?: typeof import('../cost.js').formatCost,
  _sessionCache?: Map<string, SessionCacheEntry>,
): void {
  // Direct O(1) read from incrementally maintained projectAgg counter
  payload.projectCost = projectAgg.cost;
  payload.projectTokens = {
    input: projectAgg.input,
    output: projectAgg.output,
    reasoning: projectAgg.reasoning,
    cacheRead: projectAgg.cacheRead,
    cacheWrite: projectAgg.cacheWrite,
    total: projectAgg.total,
  };
  payload.projectRequestCount = projectAgg.requestCount;

  if (resolveCostConfigFn && formatCostFn) {
    const resolved = resolveCostConfigFn(configLanguage, configCost);
    payload.projectCostFormatted = formatCostFn(projectAgg.cost, resolved.currency, resolved.decimalPlaces, resolved.exchangeRate);
  }
}

/**
 * Incremental project-level aggregation counter.
 * Updated on each message.updated (delta), initialized from preload + sessionCache.
 * Replaces O(N) full-scan in fillProjectData with O(1) read.
 */
export let projectAgg = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, requestCount: 0 };

/**
 * Reset projectAgg to zero state (used on plugin init and test reset).
 */
export function resetProjectAgg(): void {
  projectAgg = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, requestCount: 0 };
}

/**
 * Seed the project-level counter with an absolute snapshot (v1 startup restore).
 */
export function seedProjectAgg(snapshot: {
  cost: number;
  tokens: TokenBreakdown;
  requestCount: number;
}): void {
  projectAgg.cost += snapshot.cost;
  projectAgg.input += snapshot.tokens.input;
  projectAgg.output += snapshot.tokens.output;
  projectAgg.reasoning += snapshot.tokens.reasoning;
  projectAgg.cacheRead += snapshot.tokens.cacheRead;
  projectAgg.cacheWrite += snapshot.tokens.cacheWrite;
  projectAgg.total += snapshot.tokens.total;
  projectAgg.requestCount += snapshot.requestCount;
}
