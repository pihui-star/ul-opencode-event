// tests/utils/sample-configs.ts
import type { NotificationConfig, Channel } from '../../src/types';

export const sampleSMTPConfig: NotificationConfig = {
  channels: [
    {
      type: 'smtp',
      enabled: true,
      name: 'Test Email',
      config: {
        host: 'smtp.test.com',
        port: 465,
        secure: true,
        auth: {
          user: 'test@test.com',
          pass: 'test-password',
        },
      },
      recipients: ['receiver@test.com'],
      events: {
        created: true,
        idle: true,
        error: true,
      },
      templates: {
        created: {
          subject: '[OpenCode] Task Started: {{projectName}}',
          body: 'Task started at {{timestamp}}',
        },
        idle: {
          subject: '[OpenCode] Task Completed: {{projectName}}',
          body: 'Task completed. Duration: {{duration}}',
        },
        error: {
          subject: '[OpenCode] Task Error: {{projectName}}',
          body: 'Error: {{error}}',
        },
      },
    },
  ],
};

export const sampleMultiChannelConfig: NotificationConfig = {
  channels: [
    {
      type: 'smtp',
      enabled: true,
      name: 'Primary Email',
      config: {
        host: 'smtp.primary.com',
        port: 465,
        secure: true,
        auth: { user: 'primary@test.com', pass: 'pass' },
      },
      recipients: ['primary@test.com'],
      events: { created: true, idle: true, error: true },
    },
    {
      type: 'smtp',
      enabled: true,
      name: 'Secondary Email',
      config: {
        host: 'smtp.secondary.com',
        port: 587,
        secure: false,
        auth: { user: 'secondary@test.com', pass: 'pass' },
      },
      recipients: ['secondary@test.com'],
      events: { idle: true, error: true },  // No 'created' event
    },
  ],
};

export const sampleDisabledChannelConfig: NotificationConfig = {
  channels: [
    {
      type: 'smtp',
      enabled: false,  // Disabled
      name: 'Disabled Email',
      config: {
        host: 'smtp.disabled.com',
        port: 465,
        secure: true,
        auth: { user: 'disabled@test.com', pass: 'pass' },
      },
      recipients: ['disabled@test.com'],
      events: { created: true, idle: true, error: true },
    },
  ],
};

export const emptyConfig: NotificationConfig = {
  channels: [],
};

export const minimalConfig: NotificationConfig = {
  channels: [
    {
      type: 'smtp',
      enabled: true,
      config: {
        host: 'smtp.minimal.com',
        port: 465,
        auth: { user: 'minimal@test.com', pass: 'pass' },
      },
      recipients: ['minimal@test.com'],
      events: {},
    },
  ],
};

export const sampleFileConfig: NotificationConfig = {
  channels: [
    {
      type: 'file',
      enabled: true,
      name: 'File Log',
      config: {
        filePath: '/tmp/test-messages.log',
        maxSizeBytes: 1024,
      },
      events: {
        created: true,
        idle: true,
        error: true,
      },
    },
  ],
};
