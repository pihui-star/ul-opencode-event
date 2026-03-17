import { describe, test, expect, mock, beforeEach } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import type { NotificationConfig, Channel } from '../src/types';

// Mock fs module
const mockFs = {
  existsSync: mock(() => false),
  readFileSync: mock(() => ''),
};

// Mock the fs module before importing config
mock.module('fs', () => mockFs);

// Import after mocking
const { loadConfig } = await import('../src/config');

describe('loadConfig', () => {
  beforeEach(() => {
    // Reset mocks
    mockFs.existsSync.mockClear();
    mockFs.readFileSync.mockClear();
    mockFs.existsSync.mockReturnValue(false);
  });

  describe('default config', () => {
    test('returns empty channels when no config files exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const config = loadConfig();
      
      expect(config).toEqual({ channels: [] });
    });

    test('returns empty channels when global config file does not exist', () => {
      mockFs.existsSync.mockImplementation((p: string) => {
        return !p.includes('.config');
      });
      
      const config = loadConfig();
      
      expect(config).toEqual({ channels: [] });
    });
  });

  describe('global config only', () => {
    test('loads config from ~/.config/opencode/ul-opencode-event.json', () => {
      const globalConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Global Email',
            config: {
              host: 'smtp.global.com',
              port: 465,
              auth: { user: 'global@test.com', pass: 'pass' },
            },
            recipients: ['admin@global.com'],
            events: { created: true, idle: true, error: true },
          },
        ],
      };

      const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === globalPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === globalPath) {
          return JSON.stringify(globalConfig);
        }
        throw new Error('File not found');
      });

      const config = loadConfig();

      expect(config.channels).toHaveLength(1);
      expect(config.channels[0].name).toBe('Global Email');
    });
  });

  describe('project config only', () => {
    test('loads config from .opencode/ul-opencode-event.json', () => {
      const projectConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Project Email',
            config: {
              host: 'smtp.project.com',
              port: 587,
              auth: { user: 'project@test.com', pass: 'pass' },
            },
            recipients: ['dev@project.com'],
            events: { created: true },
          },
        ],
      };

      const opencodePath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === opencodePath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === opencodePath) {
          return JSON.stringify(projectConfig);
        }
        throw new Error('File not found');
      });

      const config = loadConfig();

      expect(config.channels).toHaveLength(1);
      expect(config.channels[0].name).toBe('Project Email');
    });

    test('loads config from ./ul-opencode-event.json when .opencode/ul-opencode-event.json does not exist', () => {
      const projectConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Local Email',
            config: {
              host: 'smtp.local.com',
              port: 25,
              auth: { user: 'local@test.com', pass: 'pass' },
            },
            recipients: ['local@test.com'],
            events: { error: true },
          },
        ],
      };

      const opencodePath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      const localPath = path.join(process.cwd(), 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === localPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === localPath) {
          return JSON.stringify(projectConfig);
        }
        throw new Error('File not found');
      });

      const config = loadConfig();

      expect(config.channels).toHaveLength(1);
      expect(config.channels[0].name).toBe('Local Email');
    });
  });

  describe('merge: project channels append to global (different names)', () => {
    test('appends project channels when names are different', () => {
      const globalConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Global Email',
            config: {
              host: 'smtp.global.com',
              port: 465,
              auth: { user: 'global@test.com', pass: 'pass' },
            },
            recipients: ['admin@global.com'],
            events: { created: true },
          },
        ],
      };

      const projectConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Project Email',
            config: {
              host: 'smtp.project.com',
              port: 587,
              auth: { user: 'project@test.com', pass: 'pass' },
            },
            recipients: ['dev@project.com'],
            events: { idle: true },
          },
        ],
      };

      const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === globalPath || p === projectPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === globalPath) return JSON.stringify(globalConfig);
        if (p === projectPath) return JSON.stringify(projectConfig);
        throw new Error('File not found');
      });

      const config = loadConfig();

      expect(config.channels).toHaveLength(2);
      expect(config.channels.map(c => c.name)).toEqual(['Global Email', 'Project Email']);
    });
  });

  describe('merge: project channel overrides global (same name)', () => {
    test('overrides global channel when names match', () => {
      const globalConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Shared Email',
            config: {
              host: 'smtp.global.com',
              port: 465,
              auth: { user: 'global@test.com', pass: 'pass' },
            },
            recipients: ['admin@global.com'],
            events: { created: true },
          },
        ],
      };

      const projectConfig: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Shared Email',
            config: {
              host: 'smtp.project.com',
              port: 587,
              auth: { user: 'project@test.com', pass: 'pass' },
            },
            recipients: ['dev@project.com'],
            events: { idle: true, error: true },
          },
        ],
      };

      const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === globalPath || p === projectPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === globalPath) return JSON.stringify(globalConfig);
        if (p === projectPath) return JSON.stringify(projectConfig);
        throw new Error('File not found');
      });

      const config = loadConfig();

      expect(config.channels).toHaveLength(1);
      expect(config.channels[0].name).toBe('Shared Email');
      // Project config overrides global
      expect(config.channels[0].config).toEqual({
        host: 'smtp.project.com',
        port: 587,
        auth: { user: 'project@test.com', pass: 'pass' },
      });
      expect(config.channels[0].events).toEqual({ idle: true, error: true });
    });
  });

  describe('filtering disabled channels', () => {
    test('filters out channels with enabled: false', () => {
      const config: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            enabled: true,
            name: 'Enabled Email',
            config: {
              host: 'smtp.enabled.com',
              port: 465,
              auth: { user: 'enabled@test.com', pass: 'pass' },
            },
            recipients: ['admin@enabled.com'],
            events: { created: true },
          },
          {
            type: 'smtp',
            enabled: false,
            name: 'Disabled Email',
            config: {
              host: 'smtp.disabled.com',
              port: 465,
              auth: { user: 'disabled@test.com', pass: 'pass' },
            },
            recipients: ['admin@disabled.com'],
            events: { created: true },
          },
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === projectPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      const loadedConfig = loadConfig();

      expect(loadedConfig.channels).toHaveLength(1);
      expect(loadedConfig.channels[0].name).toBe('Enabled Email');
    });

    test('includes channels with enabled: undefined (defaults to true)', () => {
      const config: NotificationConfig = {
        channels: [
          {
            type: 'smtp',
            name: 'Default Enabled Email',
            config: {
              host: 'smtp.default.com',
              port: 465,
              auth: { user: 'default@test.com', pass: 'pass' },
            },
            recipients: ['admin@default.com'],
            events: { created: true },
          } as Channel,
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === projectPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      const loadedConfig = loadConfig();

      expect(loadedConfig.channels).toHaveLength(1);
      expect(loadedConfig.channels[0].name).toBe('Default Enabled Email');
    });
  });

  describe('validation', () => {
    test('throws error for unsupported channel type', () => {
      const config = {
        channels: [
          {
            type: 'feishu',
            enabled: true,
            name: 'Feishu Channel',
            config: {
              webhook: 'https://feishu.com/webhook',
            },
            events: { created: true },
          },
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === projectPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      expect(() => loadConfig()).toThrow('Unsupported channel type: "feishu". Supported types: smtp');
    });

    test('throws error for invalid channel type', () => {
      const config = {
        channels: [
          {
            type: 'invalid',
            enabled: true,
            name: 'Invalid Channel',
            config: {},
            events: { created: true },
          },
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === projectPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      expect(() => loadConfig()).toThrow('Unsupported channel type: "invalid". Supported types: smtp');
    });
  });

  describe('error handling', () => {
    test('handles malformed JSON gracefully', () => {
      const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
      
      mockFs.existsSync.mockImplementation((p: string) => {
        return p === globalPath;
      });
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === globalPath) return 'invalid json';
        throw new Error('File not found');
      });

      const config = loadConfig();

      // Should return default config when JSON is malformed
      expect(config).toEqual({ channels: [] });
    });
  });
});
