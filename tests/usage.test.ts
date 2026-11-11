import { describe, test, expect } from 'bun:test';
import {
  aggregateUsage,
  mergeLiveUsage,
  collectDescendants,
  createLiveUsage,
  zeroTotals,
  addTotals,
  type UsageRow,
  type LiveUsage,
} from '../src/usage';

function row(overrides: Partial<UsageRow> & { sessionId: string }): UsageRow {
  return {
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    requestCount: 0,
    ...overrides,
  };
}

function tokens(input: number, output: number, cacheRead = 0, cacheWrite = 0) {
  return { input, output, reasoning: 0, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

describe('usage aggregation', () => {
  test('single session: project totals equal the session totals', () => {
    const rows = new Map<string, UsageRow>([
      ['s1', row({ sessionId: 's1', cost: 0.5, tokens: tokens(100, 20), requestCount: 3 })],
    ]);

    const result = aggregateUsage(rows, 's1');

    expect(result.session.cost).toBe(0.5);
    expect(result.session.tokens.total).toBe(120);
    expect(result.session.requestCount).toBe(3);
    expect(result.total.cost).toBe(0.5);
    expect(result.project.cost).toBe(0.5);
    expect(result.project.requestCount).toBe(3);
  });

  test('multi-session project aggregation sums every session of the project', () => {
    const rows = new Map<string, UsageRow>([
      ['s1', row({ sessionId: 's1', cost: 0.1, tokens: tokens(10, 1), requestCount: 1 })],
      ['s2', row({ sessionId: 's2', cost: 0.2, tokens: tokens(20, 2), requestCount: 2 })],
      ['s3', row({ sessionId: 's3', cost: 0.3, tokens: tokens(30, 3), requestCount: 3 })],
    ]);

    const result = aggregateUsage(rows, 's1');

    expect(result.project.cost).toBeCloseTo(0.6, 10);
    expect(result.project.tokens.input).toBe(60);
    expect(result.project.tokens.output).toBe(6);
    expect(result.project.requestCount).toBe(6);
    // session/total only cover the requested session
    expect(result.total.cost).toBeCloseTo(0.1, 10);
  });

  test('total includes descendant sessions recursively', () => {
    const rows = new Map<string, UsageRow>([
      ['main', row({ sessionId: 'main', cost: 1, tokens: tokens(100, 10), requestCount: 2 })],
      ['child', row({ sessionId: 'child', parentID: 'main', cost: 2, tokens: tokens(200, 20), requestCount: 3 })],
      ['grandchild', row({ sessionId: 'grandchild', parentID: 'child', cost: 4, tokens: tokens(400, 40), requestCount: 4 })],
      ['other', row({ sessionId: 'other', cost: 8, tokens: tokens(800, 80), requestCount: 8 })],
    ]);

    const result = aggregateUsage(rows, 'main');

    expect(result.session.cost).toBe(1);
    expect(result.total.cost).toBe(7);
    expect(result.total.tokens.input).toBe(700);
    expect(result.total.requestCount).toBe(9);
    // project covers everything in the directory
    expect(result.project.cost).toBe(15);
  });

  test('collectDescendants returns the full descendant chain', () => {
    const rows = new Map<string, UsageRow>([
      ['a', row({ sessionId: 'a' })],
      ['b', row({ sessionId: 'b', parentID: 'a' })],
      ['c', row({ sessionId: 'c', parentID: 'b' })],
      ['d', row({ sessionId: 'd', parentID: 'c' })],
    ]);

    const descendants = collectDescendants(rows, 'a');
    expect(descendants.sort()).toEqual(['b', 'c', 'd']);
  });

  test('unknown session yields zeroed totals', () => {
    const rows = new Map<string, UsageRow>([['s1', row({ sessionId: 's1', cost: 5 })]]);
    const result = aggregateUsage(rows, 'missing');

    expect(result.session).toEqual(zeroTotals());
    expect(result.total).toEqual(zeroTotals());
    expect(result.project.cost).toBe(5);
  });
});

describe('live usage overlay', () => {
  test('live values replace the database row of the same session', () => {
    const rows = new Map<string, UsageRow>([
      ['s1', row({ sessionId: 's1', cost: 1, tokens: tokens(100, 10), requestCount: 2 })],
    ]);

    const live = new Map<string, LiveUsage>([
      [
        's1',
        {
          absolute: { cost: 3, tokens: tokens(300, 30) },
          stepCost: 0,
          stepTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          stepCount: 0,
        },
      ],
    ]);

    mergeLiveUsage(rows, live);

    expect(rows.get('s1')!.cost).toBe(3);
    expect(rows.get('s1')!.tokens.input).toBe(300);
    // database request count is kept when no steps were observed
    expect(rows.get('s1')!.requestCount).toBe(2);
  });

  test('observed steps override the request count', () => {
    const rows = new Map<string, UsageRow>([
      ['s1', row({ sessionId: 's1', cost: 1, tokens: tokens(100, 10), requestCount: 2 })],
    ]);

    const live = createLiveUsage();
    live.stepCount = 5;
    live.stepCost = 2;
    live.stepTokens = tokens(200, 20);
    mergeLiveUsage(rows, new Map([['s1', live]]));

    expect(rows.get('s1')!.requestCount).toBe(5);
    expect(rows.get('s1')!.cost).toBe(2);
    expect(rows.get('s1')!.tokens.input).toBe(200);
  });

  test('live sessions missing from the database are added', () => {
    const rows = new Map<string, UsageRow>();
    const live = createLiveUsage();
    live.absolute = { cost: 0.25, tokens: tokens(10, 1) };
    mergeLiveUsage(rows, new Map([['new', live]]));

    expect(rows.get('new')!.cost).toBe(0.25);
    expect(rows.get('new')!.tokens.total).toBe(11);
  });
});

describe('helpers', () => {
  test('addTotals merges costs, tokens and request counts', () => {
    const a = { cost: 1, tokens: tokens(10, 5), requestCount: 2 };
    const b = { cost: 2, tokens: tokens(20, 5, 3), requestCount: 3 };
    const merged = addTotals(a, b);

    expect(merged.cost).toBe(3);
    expect(merged.tokens.input).toBe(30);
    expect(merged.tokens.cacheRead).toBe(3);
    expect(merged.tokens.total).toBe(30 + 10 + 3);
    expect(merged.requestCount).toBe(5);
  });
});
