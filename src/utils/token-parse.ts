import type { TokenBreakdown } from '../types.js';

/**
 * Raw SDK token shape from AssistantMessage.tokens
 */
export interface SdkTokens {
  input?: number | null;
  output?: number | null;
  reasoning?: number | null;
  cache?: { read?: number | null; write?: number | null } | null;
}

/**
 * Coerce a value to a safe integer (0 for null / undefined / NaN).
 */
function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse SDK token fields into standardized TokenBreakdown.
 * Handles null/undefined/NaN by coercing to 0.
 */
export function parseTokenFields(raw: SdkTokens | undefined): TokenBreakdown {
  const input = safeNum(raw?.input);
  const output = safeNum(raw?.output);
  const reasoning = safeNum(raw?.reasoning);
  const cacheRead = safeNum(raw?.cache?.read);
  const cacheWrite = safeNum(raw?.cache?.write);
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

/**
 * Safely parse message cost value.
 */
export function parseMessageCost(raw: { cost?: number | null } | undefined): number {
  return safeNum(raw?.cost);
}
