import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { NotificationConfig, Channel, EventPayload, EventType } from '../src/types';

// Track sent messages for verification
interface SentMessage {
  channelName: string;
  subject: string;
  text: string;
}

const sentMessages: SentMessage[] = [];

// Mock network interfaces for testing getLocalIP
const mockNetworkInterfaces = {
  lo: [
    { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
  ],
  eth0: [
    { address: '192.168.1.100', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.1.100/24' },
    { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: 'fe80::1/64' },
  ],
};

// Mock node:os module to return fixed values
mock.module('node:os', () => ({
  default: {
    hostname: () => 'test-hostname',
    type: () => 'TestOS',
    platform: () => 'test-platform',
    release: () => '1.0.0-test',
    arch: () => 'x64',
    userInfo: () => ({ username: 'testuser' }),
    uptime: () => 90061,
    networkInterfaces: () => ({ ...mockNetworkInterfaces }),
  },
  hostname: () => 'test-hostname',
  type: () => 'TestOS',
  platform: () => 'test-platform',
  release: () => '1.0.0-test',
  arch: () => 'x64',
  userInfo: () => ({ username: 'testuser' }),
  uptime: () => 90061,
  networkInterfaces: () => ({ ...mockNetworkInterfaces }),
}));

// Mock updater module
mock.module('../src/updater', () => ({
  getCurrentVersion: () => '0.1.52',
}));

// Mock email module (handler needs at least one sender)
mock.module('../src/email', () => ({
  createEmailSender: async (channel: Channel) => {
    if (channel.enabled === false) return null;
    if (channel.type !== 'smtp') return null;
    if (!channel.recipients || channel.recipients.length === 0) return null;
    return {
      send: async (message: unknown) => {
        const msg = message as { subject?: string; text?: string };
        if (msg?.subject !== undefined && msg?.text !== undefined) {
          sentMessages.push({
            channelName: channel.name || 'unnamed',
            subject: msg.subject,
            text: msg.text,
          });
        }
      },
      close: async () => {},
    };
  },
}));

// Mock recorder (no-op)
mock.module('../src/recorder', () => ({
  recordEventVariables: () => {},
}));

// Import mocked os module directly (same object handler.ts uses)
import os from 'node:os';

// Import handler AFTER all mocks
import { createEventHandler, formatSystemUptime, getLocalIP } from '../src/handler';

function createMockChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    type: 'smtp',
    enabled: true,
    name: 'Test Channel',
    config: {
      host: 'smtp.test.com',
      port: 465,
      secure: true,
      auth: { user: 'test@test.com', pass: 'pass' },
    },
    recipients: ['receiver@test.com'],
    events: { created: true, idle: true, error: true },
    ...overrides,
  } as Channel;
}

function createPayload(eventType: EventType, overrides: Partial<EventPayload> = {}): EventPayload {
  return {
    eventType,
    timestamp: '2024-01-01T12:00:00Z',
    projectName: 'test-project',
    projectPath: '/test/project',
    sessionId: 'session-123',
    sessionType: 'main' as const,
    ...overrides,
  };
}

const SYSTEM_VAR_KEYS = [
  'hostname',
  'osType',
  'osPlatform',
  'osRelease',
  'osArch',
  'username',
  'nodeVersion',
  'pluginVersion',
] as const;

describe('handler static system variables', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
  });

  test('all 8 static system variables render in templates', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'System Var Test',
          templates: {
            created: {
              subject: '{{hostname}}',
              body: [
                `hostname={{hostname}}`,
                `osType={{osType}}`,
                `osPlatform={{osPlatform}}`,
                `osRelease={{osRelease}}`,
                `osArch={{osArch}}`,
                `username={{username}}`,
                `nodeVersion={{nodeVersion}}`,
                `pluginVersion={{pluginVersion}}`,
              ].join('|'),
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('test-hostname');
    const text = sentMessages[0].text;
    expect(text).toContain('hostname=test-hostname|');
    expect(text).toContain('osType=TestOS|');
    expect(text).toContain('osPlatform=test-platform|');
    expect(text).toContain('osRelease=1.0.0-test|');
    expect(text).toContain('osArch=x64|');
    expect(text).toContain('username=testuser|');
    // nodeVersion comes from process.version (not mockable), verify format v\d+
    expect(text).toMatch(/nodeVersion=v\d+\.\d+\.\d+/);
    expect(text).toContain('pluginVersion=0.1.52');
  });

  test('each static variable is a non-empty string', async () => {
    // Use a template that renders each variable individually
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Non-Empty Test',
          templates: {
            idle: {
              subject: 'check',
              body: [
                'hostname={{hostname}}',
                'osType={{osType}}',
                'osPlatform={{osPlatform}}',
                'osRelease={{osRelease}}',
                'osArch={{osArch}}',
                'username={{username}}',
                'nodeVersion={{nodeVersion}}',
                'pluginVersion={{pluginVersion}}',
              ].join('\n'),
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1m' }));

    expect(sentMessages.length).toBe(1);
    const lines = sentMessages[0].text.split('\n');
    expect(lines.length).toBe(8);

    for (const line of lines) {
      const [key, value] = line.split('=');
      expect(SYSTEM_VAR_KEYS).toContain(key);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test('static variables are cached - multiple handle() calls return same values', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Cache Test',
          templates: {
            created: { subject: '{{hostname}}-{{pluginVersion}}', body: '{{username}}' },
            idle: { subject: '{{hostname}}-{{pluginVersion}}', body: '{{username}}' },
            error: { subject: '{{hostname}}-{{pluginVersion}}', body: '{{username}}' },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);

    // Call handle() multiple times with different event types
    await handler.handle('created', createPayload('created'));
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1m' }));
    await handler.handle('error', createPayload('error', { error: 'Oops' }));

    expect(sentMessages.length).toBe(3);

    // All calls should produce the same static variable values
    const subjects = sentMessages.map(m => m.subject);
    const bodies = sentMessages.map(m => m.text);

    expect(subjects.every(s => s === subjects[0])).toBe(true);
    expect(bodies.every(b => b === bodies[0])).toBe(true);

    // Verify the values are from mocks (not real system)
    expect(subjects[0]).toBe('test-hostname-0.1.52');
    expect(bodies[0]).toBe('testuser');
  });

  test('static variables coexist with event variables in templates', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Mixed Test',
          templates: {
            idle: {
              subject: '[{{projectName}}] on {{hostname}} ({{pluginVersion}})',
              body: '{{username}}@{{hostname}} {{osType}}/{{osArch}} - {{message}} ({{duration}})',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', {
      message: 'Build succeeded',
      duration: '3m',
    }));

    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].subject).toBe('[test-project] on test-hostname (0.1.52)');
    expect(sentMessages[0].text).toBe('testuser@test-hostname TestOS/x64 - Build succeeded (3m)');
  });
});

describe('formatSystemUptime', () => {
  test('0 seconds -> "0m"', () => {
    expect(formatSystemUptime(0)).toBe('0m');
  });

  test('45 seconds -> "0m 45s"', () => {
    expect(formatSystemUptime(45)).toBe('0m 45s');
  });

  test('3661 seconds -> "1h 1m 1s"', () => {
    expect(formatSystemUptime(3661)).toBe('1h 1m 1s');
  });

  test('90061 seconds -> "1d 1h 1m 1s"', () => {
    expect(formatSystemUptime(90061)).toBe('1d 1h 1m 1s');
  });

  test('60 seconds -> "1m"', () => {
    expect(formatSystemUptime(60)).toBe('1m');
  });

  test('3600 seconds -> "1h 0m"', () => {
    expect(formatSystemUptime(3600)).toBe('1h 0m');
  });

  test('86400 seconds -> "1d 0m"', () => {
    expect(formatSystemUptime(86400)).toBe('1d 0m');
  });

  test('negative seconds are treated as absolute value', () => {
    expect(formatSystemUptime(-45)).toBe('0m 45s');
  });
});

describe('getLocalIP', () => {
  test('returns "127.0.0.1" when no interfaces available', () => {
    const original = os.networkInterfaces;
    os.networkInterfaces = () => ({});
    try {
      expect(getLocalIP()).toBe('127.0.0.1');
    } finally {
      os.networkInterfaces = original;
    }
  });

  test('returns "127.0.0.1" when only internal interfaces exist', () => {
    const original = os.networkInterfaces;
    os.networkInterfaces = () => ({
      lo: [
        { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
      ],
    });
    try {
      expect(getLocalIP()).toBe('127.0.0.1');
    } finally {
      os.networkInterfaces = original;
    }
  });

  test('skips virtual network interfaces (docker, wsl, etc.)', () => {
    const original = os.networkInterfaces;
    os.networkInterfaces = () => ({
      'docker0': [
        { address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '02:42:00:00:00:00', internal: false, cidr: '172.17.0.1/16' },
      ],
      'WSL': [
        { address: '172.20.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '172.20.0.1/16' },
      ],
      'vEthernet (WSL)': [
        { address: '172.21.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '172.21.0.1/16' },
      ],
      'tun0': [
        { address: '10.8.0.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '10.8.0.1/24' },
      ],
      'vmnet1': [
        { address: '192.168.87.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.87.1/24' },
      ],
      'vnic1': [
        { address: '192.168.99.1', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.99.1/24' },
      ],
    });
    try {
      expect(getLocalIP()).toBe('127.0.0.1');
    } finally {
      os.networkInterfaces = original;
    }
  });

  test('returns real interface IP when available', () => {
    const original = os.networkInterfaces;
    os.networkInterfaces = () => ({
      'lo': [
        { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
      ],
      'eth0': [
        { address: '192.168.1.100', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.1.100/24' },
      ],
    });
    try {
      expect(getLocalIP()).toBe('192.168.1.100');
    } finally {
      os.networkInterfaces = original;
    }
  });

  test('skips virtual interfaces and returns real one', () => {
    const original = os.networkInterfaces;
    os.networkInterfaces = () => ({
      'docker0': [
        { address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '02:42:00:00:00:00', internal: false, cidr: '172.17.0.1/16' },
      ],
      'eth0': [
        { address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '10.0.0.5/24' },
      ],
    });
    try {
      expect(getLocalIP()).toBe('10.0.0.5');
    } finally {
      os.networkInterfaces = original;
    }
  });
});

describe('handler dynamic system variables', () => {
  beforeEach(() => {
    sentMessages.length = 0;
  });

  afterEach(() => {
    sentMessages.length = 0;
  });

  test('processPid is a numeric string', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Pid Test',
          templates: {
            created: { subject: 'pid={{processPid}}', body: 'test' },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    const pidMatch = sentMessages[0].subject.match(/^pid=(\d+)$/);
    expect(pidMatch).not.toBeNull();
    expect(Number.isFinite(Number(pidMatch![1]))).toBe(true);
  });

  test('systemUptime contains time unit', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'Uptime Test',
          templates: {
            created: { subject: 'uptime={{systemUptime}}', body: 'test' },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    // With mock returning 90061, formatSystemUptime returns "1d 1h 1m 1s"
    expect(sentMessages[0].subject).toBe('uptime=1d 1h 1m 1s');
  });

  test('localIP is IPv4 format or fallback', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'IP Test',
          templates: {
            created: { subject: 'ip={{localIP}}', body: 'test' },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('created', createPayload('created'));

    expect(sentMessages.length).toBe(1);
    const ip = sentMessages[0].subject.replace('ip=', '');
    // Either a valid IPv4 or the fallback 127.0.0.1
    expect(ip).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/);
  });

  test('all dynamic variables render together', async () => {
    const config: NotificationConfig = {
      channels: [
        createMockChannel({
          name: 'All Dynamic Test',
          templates: {
            idle: {
              subject: '{{hostname}} dynamic',
              body: 'pid={{processPid}} uptime={{systemUptime}} ip={{localIP}}',
            },
          },
        }),
      ],
    };

    const handler = createEventHandler(config);
    await handler.handle('idle', createPayload('idle', { message: 'Done', duration: '1m' }));

    expect(sentMessages.length).toBe(1);
    const text = sentMessages[0].text;
    expect(text).toMatch(/pid=\d+/);
    expect(text).toMatch(/uptime=\d+[dhm](?: \d+[dhms])*/);
    expect(text).toMatch(/ip=(\d{1,3}\.){3}\d{1,3}/);
  });
});
