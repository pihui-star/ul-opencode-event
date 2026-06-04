import { describe, test, expect, mock, beforeEach } from 'bun:test';
import * as path from 'path';
import * as os from 'os';

// Mock fs module
const mockFs = {
  existsSync: mock(() => false),
  readFileSync: mock(() => ''),
};

mock.module('fs', () => mockFs);

const { loadConfig, validateCustomVariables } = await import('../src/config');
const { logger } = await import('../src/logger');

describe('validateCustomVariables', () => {
  test('returns empty object for undefined input', () => {
    expect(validateCustomVariables(undefined)).toEqual({});
  });

  test('returns empty object for empty object input', () => {
    expect(validateCustomVariables({})).toEqual({});
  });

  test('preserves valid key-value pairs', () => {
    const input = { env: 'dev', region: 'us', app_name: 'test' };
    expect(validateCustomVariables(input)).toEqual(input);
  });

  test('filters out keys with hyphens (invalid VARIABLE_NAME_REGEX)', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      const input = { 'my-var': 'value', validKey: 'ok' };
      const result = validateCustomVariables(input);

      expect(result).toEqual({ validKey: 'ok' });
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = warnSpy.mock.calls[0][0] as string;
      expect(warnMsg).toContain('my-var');
      expect(warnMsg).toContain('invalid key');
    } finally {
      logger.warn = origWarn;
    }
  });

  test('filters out keys with spaces', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      const input = { 'my key': 'value', validKey: 'ok' };
      const result = validateCustomVariables(input);

      expect(result).toEqual({ validKey: 'ok' });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      logger.warn = origWarn;
    }
  });

  test('filters out non-string values (number)', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      const input = { count: 123, name: 'test' } as Record<string, unknown>;
      const result = validateCustomVariables(input);

      expect(result).toEqual({ name: 'test' });
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = warnSpy.mock.calls[0][0] as string;
      expect(warnMsg).toContain('count');
      expect(warnMsg).toContain('not a string');
    } finally {
      logger.warn = origWarn;
    }
  });

  test('filters out non-string values (boolean)', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      const input = { active: true, name: 'test' } as Record<string, unknown>;
      const result = validateCustomVariables(input);

      expect(result).toEqual({ name: 'test' });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      logger.warn = origWarn;
    }
  });

  test('filters out non-string values (null)', () => {
    const input = { name: null, env: 'dev' } as Record<string, unknown>;
    const result = validateCustomVariables(input);
    expect(result).toEqual({ env: 'dev' });
  });

  test('filters out non-string values (object)', () => {
    const input = { nested: { a: 1 }, env: 'dev' } as Record<string, unknown>;
    const result = validateCustomVariables(input);
    expect(result).toEqual({ env: 'dev' });
  });

  test('allows underscore-prefixed keys', () => {
    const input = { _private: 'secret', __dunder: 'value' };
    expect(validateCustomVariables(input)).toEqual(input);
  });

  test('allows numeric-only keys', () => {
    const input = { version2: 'v2' };
    expect(validateCustomVariables(input)).toEqual(input);
  });

  test('handles multiple invalid entries - returns only valid ones', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      const input = {
        'my-var': 'hyphen',
        valid: 'ok',
        count: 42,
        name: 'test',
        'space key': 'bad',
      } as Record<string, unknown>;
      const result = validateCustomVariables(input);

      expect(result).toEqual({ valid: 'ok', name: 'test' });
    } finally {
      logger.warn = origWarn;
    }
  });
});

describe('loadConfig - customVariables merge', () => {
  beforeEach(() => {
    mockFs.existsSync.mockClear();
    mockFs.readFileSync.mockClear();
    mockFs.existsSync.mockReturnValue(false);
  });

  // Helper: set up global + project config files
  function setupGlobalAndProject(globalCfg: Record<string, unknown>, projectCfg: Record<string, unknown>): void {
    const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
    const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
    mockFs.existsSync.mockImplementation((p: string) => p === globalPath || p === projectPath);
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === globalPath) return JSON.stringify(globalCfg);
      if (p === projectPath) return JSON.stringify(projectCfg);
      throw new Error('File not found');
    });
  }

  function setupProjectConfig(config: Record<string, unknown>): void {
    const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
    mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === projectPath) return JSON.stringify(config);
      throw new Error('File not found');
    });
  }

  function setupGlobalConfig(config: Record<string, unknown>): void {
    const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
    mockFs.existsSync.mockImplementation((p: string) => p === globalPath);
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === globalPath) return JSON.stringify(config);
      throw new Error('File not found');
    });
  }

  test('basic merge: global + project, project overrides same key', () => {
    setupGlobalAndProject(
      { channels: [], customVariables: { env: 'dev', region: 'us' } },
      { channels: [], customVariables: { env: 'prod' } },
    );

    const config = loadConfig();

    expect(config.customVariables).toEqual({ env: 'prod', region: 'us' });
  });

  test('only global has customVariables - preserved', () => {
    setupGlobalConfig({ channels: [], customVariables: { env: 'dev', region: 'us' } });

    const config = loadConfig();

    expect(config.customVariables).toEqual({ env: 'dev', region: 'us' });
  });

  test('only project has customVariables - preserved', () => {
    setupProjectConfig({ channels: [], customVariables: { env: 'prod', team: 'backend' } });

    const config = loadConfig();

    expect(config.customVariables).toEqual({ env: 'prod', team: 'backend' });
  });

  test('neither has customVariables - result is undefined', () => {
    setupProjectConfig({ channels: [] });

    const config = loadConfig();

    expect(config.customVariables).toBeUndefined();
  });

  test('invalid keys are filtered during merge', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      setupProjectConfig({
        channels: [],
        customVariables: {
          'my-var': 'filtered',
          validKey: 'kept',
          another_valid: 'also kept',
        },
      });

      const config = loadConfig();

      expect(config.customVariables).toEqual({ validKey: 'kept', another_valid: 'also kept' });
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = warnSpy.mock.calls[0][0] as string;
      expect(warnMsg).toContain('my-var');
    } finally {
      logger.warn = origWarn;
    }
  });

  test('non-string values are filtered during merge', () => {
    const warnSpy = mock(() => {});
    const origWarn = logger.warn;
    logger.warn = warnSpy;

    try {
      setupProjectConfig({
        channels: [],
        customVariables: {
          count: 123,
          active: true,
          name: 'valid',
        },
      });

      const config = loadConfig();

      expect(config.customVariables).toEqual({ name: 'valid' });
    } finally {
      logger.warn = origWarn;
    }
  });

  test('valid input fully preserved after merge', () => {
    setupGlobalAndProject(
      { channels: [], customVariables: { env: 'dev', region: 'us', version: '1.0' } },
      { channels: [], customVariables: { env: 'prod', team: 'backend' } },
    );

    const config = loadConfig();

    expect(config.customVariables).toEqual({
      env: 'prod',
      region: 'us',
      version: '1.0',
      team: 'backend',
    });
  });

  test('all entries filtered -> customVariables undefined in result', () => {
    setupProjectConfig({
      channels: [],
      customVariables: {
        'bad-key': 'value',
        count: 42,
      },
    });

    const config = loadConfig();

    expect(config.customVariables).toBeUndefined();
  });
});
