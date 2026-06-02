import { describe, it, expect } from 'bun:test';
import type { TokenBreakdown } from '../src/types';
import { calcCacheHitRate } from '../src/handler.js';

// ---------------------------------------------------------------------------
// Pure function tests for calcCacheHitRate
// ---------------------------------------------------------------------------

describe('calcCacheHitRate', () => {
  function makeTokenBreakdown(overrides: Partial<TokenBreakdown> = {}): TokenBreakdown {
    return {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      ...overrides,
    };
  }

  it('normal calculation: cacheRead=800, total=1000 -> "80.0%"', () => {
    const tokens = makeTokenBreakdown({ cacheRead: 800, total: 1000 });
    expect(calcCacheHitRate(tokens)).toBe('80.0%');
  });

  it('100% hit: cacheRead equals total -> "100.0%"', () => {
    const tokens = makeTokenBreakdown({ cacheRead: 1000, total: 1000 });
    expect(calcCacheHitRate(tokens)).toBe('100.0%');
  });

  it('0% hit: cacheRead=0, total=1000 -> "0.0%"', () => {
    const tokens = makeTokenBreakdown({ cacheRead: 0, total: 1000 });
    expect(calcCacheHitRate(tokens)).toBe('0.0%');
  });

  it('total=0 -> "N/A"', () => {
    const tokens = makeTokenBreakdown({ cacheRead: 0, total: 0 });
    expect(calcCacheHitRate(tokens)).toBe('N/A');
  });

  it('undefined input -> "N/A"', () => {
    expect(calcCacheHitRate(undefined)).toBe('N/A');
  });

  it('large numbers: cacheRead=9342976, total=10476071 -> correct toFixed(1) precision', () => {
    const tokens = makeTokenBreakdown({ cacheRead: 9342976, total: 10476071 });
    const result = calcCacheHitRate(tokens);
    // 9342976 / 10476071 * 100 = 89.1933... -> "89.2%"
    const expected = (9342976 / 10476071 * 100).toFixed(1) + '%';
    expect(result).toBe(expected);
    // Verify it is one-decimal-place precision
    expect(result).toMatch(/^\d+\.\d%$/);
  });

  it('negative cacheRead -> "N/A"', () => {
    const tokens = makeTokenBreakdown({ cacheRead: -100, total: 1000 });
    expect(calcCacheHitRate(tokens)).toBe('N/A');
  });
});
