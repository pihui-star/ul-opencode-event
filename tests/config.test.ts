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

      expect(() => loadConfig()).toThrow('Unsupported channel type: "feishu". Supported types: smtp, dingtalk');
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

      expect(() => loadConfig()).toThrow('Unsupported channel type: "invalid". Supported types: smtp, dingtalk');
    });
  });

  describe('dingtalk channel', () => {
    test('valid dingtalk config with webhook passes loadConfig without error', () => {
      const config = {
        channels: [
          {
            type: 'dingtalk',
            enabled: true,
            name: 'DingTalk Bot',
            config: {
              webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
            },
            events: { created: true, idle: true, error: true },
          },
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');

      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      const result = loadConfig();

      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].type).toBe('dingtalk');
      expect(result.channels[0].name).toBe('DingTalk Bot');
      expect(result.channels[0].config).toEqual({
        webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test-token',
      });
    });

    test('type "dingtalk" is accepted as supported channel type (no "Unsupported" error)', () => {
      const config = {
        channels: [
          {
            type: 'dingtalk',
            enabled: true,
            name: 'DT Channel',
            config: { webhook: 'https://oapi.dingtalk.com/robot/send?token=abc' },
            events: { idle: true },
          },
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');

      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      // Should NOT throw - dingtalk is a supported type
      expect(() => loadConfig()).not.toThrow();
    });

    test('type "feishu" still throws "Unsupported channel type" error', () => {
      const config = {
        channels: [
          {
            type: 'feishu',
            enabled: true,
            name: 'Feishu Bot',
            config: { webhook: 'https://open.feishu.cn/webhook' },
            events: { created: true },
          },
        ],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');

      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      expect(() => loadConfig()).toThrow(/Unsupported channel type: "feishu"/);
    });

    test('global + project dingtalk config merges by name (project overrides)', () => {
      const globalConfig = {
        channels: [
          {
            type: 'dingtalk',
            enabled: true,
            name: 'Team DingTalk',
            config: {
              webhook: 'https://oapi.dingtalk.com/robot/send?access_token=global-token',
            },
            events: { created: true },
          },
        ],
      };

      const projectConfig = {
        channels: [
          {
            type: 'dingtalk',
            enabled: true,
            name: 'Team DingTalk',
            config: {
              webhook: 'https://oapi.dingtalk.com/robot/send?access_token=project-token',
            },
            events: { idle: true, error: true },
          },
        ],
      };

      const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');

      mockFs.existsSync.mockImplementation((p: string) => p === globalPath || p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === globalPath) return JSON.stringify(globalConfig);
        if (p === projectPath) return JSON.stringify(projectConfig);
        throw new Error('File not found');
      });

      const result = loadConfig();

      // Same name → project overrides global
      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].name).toBe('Team DingTalk');
      expect(result.channels[0].config.webhook).toBe(
        'https://oapi.dingtalk.com/robot/send?access_token=project-token'
      );
      expect(result.channels[0].events).toEqual({ idle: true, error: true });
    });

    test('global + project dingtalk config with different names appends both', () => {
      const globalConfig = {
        channels: [
          {
            type: 'dingtalk',
            enabled: true,
            name: 'Global DT',
            config: { webhook: 'https://oapi.dingtalk.com/robot/send?token=g' },
            events: { created: true },
          },
        ],
      };

      const projectConfig = {
        channels: [
          {
            type: 'dingtalk',
            enabled: true,
            name: 'Project DT',
            config: { webhook: 'https://oapi.dingtalk.com/robot/send?token=p' },
            events: { error: true },
          },
        ],
      };

      const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');

      mockFs.existsSync.mockImplementation((p: string) => p === globalPath || p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === globalPath) return JSON.stringify(globalConfig);
        if (p === projectPath) return JSON.stringify(projectConfig);
        throw new Error('File not found');
      });

      const result = loadConfig();

      // Different names → both kept
      expect(result.channels).toHaveLength(2);
      expect(result.channels.map(c => c.name)).toEqual(['Global DT', 'Project DT']);
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

  describe('projectName field', () => {
    test('projectName from config file is not returned by loadConfig (not yet in merge logic)', () => {
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
        projectName: 'my-awesome-project',
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');

      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(projectConfig);
        throw new Error('File not found');
      });

      const config = loadConfig();

      // projectName is defined in NotificationConfig type but loadConfig() 
      // does not yet include it in the return object merge logic.
      // The index.ts plugin reads it via: config.projectName || path.basename(ctx.directory)
      expect(config.projectName).toBeUndefined();
      // Channels are still loaded correctly
      expect(config.channels).toHaveLength(1);
      expect(config.channels[0].name).toBe('Project Email');
    });
  });

  describe('includeSessionTypes merge', () => {
    test('global includeSessionTypes preserved when project does not set it', () => {
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
        includeSessionTypes: ['main'],
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
        // includeSessionTypes intentionally omitted
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

      // Global value should be preserved
      expect(config.includeSessionTypes).toEqual(['main']);
    });

    test('project includeSessionTypes overrides global value', () => {
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
        includeSessionTypes: ['main'],
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
        includeSessionTypes: ['main', 'subagent'], // Project overrides global
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

      // Project value should override global
      expect(config.includeSessionTypes).toEqual(['main', 'subagent']);
    });

    test('includeSessionTypes defaults to ["main"] when neither global nor project sets it', () => {
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
        // No includeSessionTypes
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
        // No includeSessionTypes
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

      // Should always output valid array, defaulting to ['main']
      expect(config.includeSessionTypes).toEqual(['main']);
    });
  });

  describe('validateIncludeSessionTypes (via loadConfig)', () => {
    test('filters invalid values and warns', () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      try {
        const rawConfig = {
          channels: [],
          includeSessionTypes: ['main', 'foobar'],
        };

        const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
        mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p === projectPath) return JSON.stringify(rawConfig);
          throw new Error('File not found');
        });

        const result = loadConfig();

        expect(result.includeSessionTypes).toEqual(['main']);
        expect(warnSpy).toHaveBeenCalled();
        const warnMsg = warnSpy.mock.calls[0][0] as string;
        expect(warnMsg).toContain('Invalid session type');
        expect(warnMsg).toContain('foobar');
      } finally {
        console.warn = origWarn;
      }
    });

    test('empty array returns default', () => {
      const config: NotificationConfig = {
        channels: [],
        includeSessionTypes: [],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      const result = loadConfig();

      expect(result.includeSessionTypes).toEqual(['main']);
    });

    test('undefined returns default', () => {
      const config: NotificationConfig = {
        channels: [],
        // includeSessionTypes omitted
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      const result = loadConfig();

      expect(result.includeSessionTypes).toEqual(['main']);
    });

    test('all valid types pass through', () => {
      const config: NotificationConfig = {
        channels: [],
        includeSessionTypes: ['main', 'subagent', 'unknown'],
      };

      const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
      mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
      mockFs.readFileSync.mockImplementation((p: string) => {
        if (p === projectPath) return JSON.stringify(config);
        throw new Error('File not found');
      });

      const result = loadConfig();

      expect(result.includeSessionTypes).toEqual(['main', 'subagent', 'unknown']);
    });

    test('non-array value returns default with warning', () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      try {
        // Use a raw object to bypass TypeScript type checking for invalid value
        const rawConfig = {
          channels: [],
          includeSessionTypes: 'invalid-string',
        };

        const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
        mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p === projectPath) return JSON.stringify(rawConfig);
          throw new Error('File not found');
        });

        const result = loadConfig();

        expect(result.includeSessionTypes).toEqual(['main']);
        expect(warnSpy).toHaveBeenCalled();
        const warnMsg = warnSpy.mock.calls[0][0] as string;
        expect(warnMsg).toContain('must be an array');
      } finally {
        console.warn = origWarn;
      }
    });

    test('all invalid values returns default', () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      try {
        const config: NotificationConfig = {
          channels: [],
          includeSessionTypes: ['foo', 'bar'] as unknown as ('main' | 'subagent' | 'unknown')[],
        };

        const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
        mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p === projectPath) return JSON.stringify(config);
          throw new Error('File not found');
        });

        const result = loadConfig();

        expect(result.includeSessionTypes).toEqual(['main']);
        // Should have warned for each invalid item
        expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        console.warn = origWarn;
      }
    });
  });

  describe('includeSubagentEvents deprecation warning', () => {
    test('warns when old field present in global config', () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      try {
        const globalConfig = {
          channels: [],
          includeSubagentEvents: true,
        };

        const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
        mockFs.existsSync.mockImplementation((p: string) => p === globalPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p === globalPath) return JSON.stringify(globalConfig);
          throw new Error('File not found');
        });

        loadConfig();

        expect(warnSpy).toHaveBeenCalled();
        const warnMsg = warnSpy.mock.calls[0][0] as string;
        expect(warnMsg).toContain('deprecated');
        expect(warnMsg).toContain('includeSubagentEvents');
      } finally {
        console.warn = origWarn;
      }
    });

    test('warns when old field present in project config', () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      try {
        const projectConfig = {
          channels: [],
          includeSubagentEvents: false,
        };

        const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
        mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p === projectPath) return JSON.stringify(projectConfig);
          throw new Error('File not found');
        });

        loadConfig();

        expect(warnSpy).toHaveBeenCalled();
        const warnMsg = warnSpy.mock.calls[0][0] as string;
        expect(warnMsg).toContain('deprecated');
      } finally {
        console.warn = origWarn;
      }
    });

    test('new field takes priority when both present', () => {
      const warnSpy = mock(() => {});
      const origWarn = console.warn;
      console.warn = warnSpy;

      try {
        const config = {
          channels: [],
          includeSubagentEvents: true,
          includeSessionTypes: ['main'],
        };

        const projectPath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
        mockFs.existsSync.mockImplementation((p: string) => p === projectPath);
        mockFs.readFileSync.mockImplementation((p: string) => {
          if (p === projectPath) return JSON.stringify(config);
          throw new Error('File not found');
        });

        const result = loadConfig();

        // Result uses includeSessionTypes value
        expect(result.includeSessionTypes).toEqual(['main']);
        // Deprecation warning still fired
        expect(warnSpy).toHaveBeenCalled();
        const deprecationWarnings = warnSpy.mock.calls.filter(
          (call: unknown[]) => (call[0] as string).includes('deprecated')
        );
        expect(deprecationWarnings.length).toBeGreaterThan(0);
      } finally {
        console.warn = origWarn;
      }
    });
  });
});
