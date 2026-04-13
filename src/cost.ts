/**
 * Cost calculation and currency formatting module.
 * Pure functions for converting, formatting, and resolving cost configuration.
 */
import type { CostConfig, ResolvedCostConfig } from './types.js';

/** Default exchange rate: 1 USD = 7.25 CNY */
const DEFAULT_EXCHANGE_RATE = 7.25;

/** Default decimal places for cost display */
const DEFAULT_DECIMAL_PLACES = 4;

/** Currency symbol mapping */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '\u00a5', // ¥
};

/**
 * Get the display symbol for a currency code.
 * @param currency - Currency code (e.g. 'USD', 'CNY')
 * @returns Symbol string, or empty string for unknown currencies
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? '';
}

/**
 * Convert an amount from USD to the target currency.
 * - USD -> USD: no conversion, returns original amount
 * - USD -> CNY: multiplies by exchange rate
 * - Negative amounts are defensively clamped to 0
 *
 * @param costUSD - Cost in USD
 * @param targetCurrency - Target currency code
 * @param exchangeRate - Exchange rate (1 USD = X target)
 * @returns Converted amount
 */
export function convertCurrency(
  costUSD: number,
  targetCurrency: string,
  exchangeRate: number
): number {
  if (costUSD < 0) return 0;
  if (targetCurrency === 'USD') return costUSD;
  return costUSD * exchangeRate;
}

/**
 * Format a cost value as a currency string with symbol prefix.
 *
 * - USD: `$X.XXXX` (prefix symbol, original USD value)
 * - CNY: `¥X.XX` (prefix symbol, converted from USD via exchange rate)
 * - Zero cost: `$0` / `¥0` (no decimal places)
 * - Negative cost: defensively treated as zero
 *
 * @param costUSD - Cost in USD
 * @param currency - Target currency code
 * @param decimalPlaces - Number of decimal places
 * @param exchangeRate - Exchange rate for conversion (default: 7.25)
 * @returns Formatted cost string with currency symbol
 */
export function formatCost(
  costUSD: number,
  currency: string,
  decimalPlaces: number,
  exchangeRate: number = DEFAULT_EXCHANGE_RATE
): string {
  const symbol = getCurrencySymbol(currency);

  // Defensive: treat negative as zero
  if (costUSD <= 0) {
    return `${symbol}0`;
  }

  const converted = convertCurrency(costUSD, currency, exchangeRate);
  const formatted = converted.toFixed(decimalPlaces);
  return `${symbol}${formatted}`;
}

/**
 * Resolve cost configuration by merging defaults with user-provided config.
 *
 * Default logic:
 * - language 'zh' -> default currency CNY
 * - language 'en' or undefined -> default currency USD
 * - exchangeRate defaults to 7.25
 * - decimalPlaces defaults to 4
 * - User config fields override defaults
 *
 * @param language - Locale language ('zh' | 'en' | undefined)
 * @param costConfig - User-provided cost configuration
 * @returns Fully resolved cost configuration
 */
export function resolveCostConfig(
  language?: string,
  costConfig?: CostConfig
): ResolvedCostConfig {
  const defaultCurrency = language === 'zh' ? 'CNY' : 'USD';
  const currency = costConfig?.currency ?? defaultCurrency;
  const exchangeRate = costConfig?.exchangeRate ?? DEFAULT_EXCHANGE_RATE;
  const decimalPlaces = costConfig?.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  const currencySymbol = getCurrencySymbol(currency);

  return {
    currency,
    exchangeRate,
    decimalPlaces,
    currencySymbol,
  };
}
