import { describe, test, expect } from 'bun:test';
import { VARIABLE_NAME_REGEX } from '../src/types.js';
import type { NotificationConfig } from '../src/types.js';

describe('VARIABLE_NAME_REGEX', () => {
  test('accepts valid variable names', () => {
    expect(VARIABLE_NAME_REGEX.test('hostname')).toBe(true);
    expect(VARIABLE_NAME_REGEX.test('my_var')).toBe(true);
    expect(VARIABLE_NAME_REGEX.test('var123')).toBe(true);
    expect(VARIABLE_NAME_REGEX.test('MyVar')).toBe(true);
  });

  test('rejects invalid variable names', () => {
    expect(VARIABLE_NAME_REGEX.test('my-var')).toBe(false);
    expect(VARIABLE_NAME_REGEX.test('my.var')).toBe(false);
    expect(VARIABLE_NAME_REGEX.test('my var')).toBe(false);
    expect(VARIABLE_NAME_REGEX.test('my@var')).toBe(false);
  });
});

describe('NotificationConfig.customVariables type', () => {
  test('can construct config with customVariables', () => {
    const config: NotificationConfig = {
      channels: [],
      customVariables: {
        hostname: 'server-01',
        env_name: 'production',
      },
    };
    expect(config.customVariables).toEqual({
      hostname: 'server-01',
      env_name: 'production',
    });
  });

  test('customVariables is optional', () => {
    const config: NotificationConfig = {
      channels: [],
    };
    expect(config.customVariables).toBeUndefined();
  });
});
