import { describe, test, expect } from 'bun:test';
import {
  formatCost,
  convertCurrency,
  getCurrencySymbol,
  resolveCostConfig,
} from '../src/cost.js';
import type { CostConfig, ResolvedCostConfig } from '../src/types.js';

// ====== formatCost ======

describe('formatCost', () => {
  test('USD with 4 decimal places', () => {
    expect(formatCost(0.0423, 'USD', 4)).toBe('$0.0423');
  });

  test('CNY with 2 decimal places and exchange rate', () => {
    const result = formatCost(0.0423, 'CNY', 2, 7.25);
    // 0.0423 * 7.25 = 0.306675, toFixed(2) = '0.31'
    expect(result).toContain('\u00a5'); // ¥
    expect(result).toContain('0.31');
  });

  test('USD zero cost', () => {
    expect(formatCost(0, 'USD', 4)).toBe('$0');
  });

  test('CNY zero cost', () => {
    expect(formatCost(0, 'CNY', 2)).toBe('\u00a50'); // ¥0
  });

  test('negative cost defensive handling', () => {
    const result = formatCost(-0.05, 'USD', 4);
    // 防御性处理：负数视为 0
    expect(result).toBe('$0');
  });

  test('large number handling', () => {
    const result = formatCost(1234.5678, 'USD', 2);
    expect(result).toBe('$1234.57');
  });

  test('CNY large number with exchange rate', () => {
    const result = formatCost(100, 'CNY', 2, 7.25);
    // 100 * 7.25 = 725
    expect(result).toBe('\u00a5725.00');
  });

  test('USD with 2 decimal places rounding', () => {
    expect(formatCost(0.999, 'USD', 2)).toBe('$1.00');
  });
});

// ====== convertCurrency ======

describe('convertCurrency', () => {
  test('USD to CNY with rate', () => {
    expect(convertCurrency(1, 'CNY', 7.25)).toBe(7.25);
  });

  test('USD to USD no conversion', () => {
    expect(convertCurrency(1, 'USD', 7.25)).toBe(1);
  });

  test('CNY target with rate multiplies', () => {
    expect(convertCurrency(10, 'CNY', 7.25)).toBe(72.5);
  });

  test('zero amount returns zero', () => {
    expect(convertCurrency(0, 'CNY', 7.25)).toBe(0);
  });

  test('negative amount returns 0 (defensive)', () => {
    expect(convertCurrency(-5, 'CNY', 7.25)).toBe(0);
  });
});

// ====== getCurrencySymbol ======

describe('getCurrencySymbol', () => {
  test('USD returns dollar sign', () => {
    expect(getCurrencySymbol('USD')).toBe('$');
  });

  test('CNY returns yuan sign', () => {
    expect(getCurrencySymbol('CNY')).toBe('\u00a5'); // ¥
  });

  test('unknown currency returns empty string', () => {
    expect(getCurrencySymbol('EUR')).toBe('');
  });
});

// ====== resolveCostConfig ======

describe('resolveCostConfig', () => {
  test('zh locale defaults to CNY', () => {
    const result = resolveCostConfig('zh', undefined);
    expect(result.currency).toBe('CNY');
    expect(result.exchangeRate).toBe(7.25);
    expect(result.decimalPlaces).toBe(4);
    expect(result.currencySymbol).toBe('\u00a5');
  });

  test('en locale defaults to USD', () => {
    const result = resolveCostConfig('en', undefined);
    expect(result.currency).toBe('USD');
    expect(result.exchangeRate).toBe(7.25);
    expect(result.decimalPlaces).toBe(4);
    expect(result.currencySymbol).toBe('$');
  });

  test('explicit currency overrides language default', () => {
    const result = resolveCostConfig('zh', { currency: 'USD' });
    expect(result.currency).toBe('USD');
    expect(result.currencySymbol).toBe('$');
  });

  test('undefined language defaults to USD', () => {
    const result = resolveCostConfig(undefined, undefined);
    expect(result.currency).toBe('USD');
    expect(result.currencySymbol).toBe('$');
  });

  test('explicit exchangeRate overrides default', () => {
    const result = resolveCostConfig('zh', { exchangeRate: 7.0 });
    expect(result.exchangeRate).toBe(7.0);
  });

  test('explicit decimalPlaces overrides default', () => {
    const result = resolveCostConfig('en', { decimalPlaces: 2 });
    expect(result.decimalPlaces).toBe(2);
  });

  test('full config override', () => {
    const config: CostConfig = {
      currency: 'CNY',
      exchangeRate: 7.1,
      decimalPlaces: 2,
    };
    const result = resolveCostConfig('en', config);
    expect(result.currency).toBe('CNY');
    expect(result.exchangeRate).toBe(7.1);
    expect(result.decimalPlaces).toBe(2);
    expect(result.currencySymbol).toBe('\u00a5');
  });
});
