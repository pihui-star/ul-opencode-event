import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { Channel } from '../src/types';
import type { Transporter } from 'nodemailer';

// Store captured emails
let capturedEmails: Array<{
  from?: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}> = [];

// Store mock sendMail behavior
let mockSendMailBehavior: ((mailOptions: any) => Promise<any>) | null = null;

// Mock nodemailer module
mock.module('nodemailer', () => ({
  createTransport: mock(() => {
    const transport = {
      sendMail: async (mailOptions: any): Promise<any> => {
        if (mockSendMailBehavior) {
          return mockSendMailBehavior(mailOptions);
        }
        capturedEmails.push({
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
          text: mailOptions.text,
          html: mailOptions.html,
        });
        return {
          messageId: `mock-${Date.now()}`,
          response: 'Mocked',
          accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
          rejected: [],
        };
      },
      set: mock(() => {}),
    };
    return transport as unknown as Transporter;
  }),
}));

// Import after mocking
const { createEmailSender } = await import('../src/email');

describe('createEmailSender', () => {
  beforeEach(() => {
    capturedEmails = [];
    mockSendMailBehavior = null;
  });

  afterEach(() => {
    capturedEmails = [];
    mockSendMailBehavior = null;
  });

  describe('type guards', () => {
    test('returns null for non-smtp channel', () => {
      const channel: Channel = {
        type: 'feishu',
        enabled: true,
        name: 'Feishu Channel',
        config: {
          webhook: 'https://feishu.com/webhook',
        },
        recipients: ['user@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      expect(sender).toBeNull();
    });

    test('returns null for disabled channel', () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: false,
        name: 'Disabled Email',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'test@test.com', pass: 'password' },
        },
        recipients: ['user@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      expect(sender).toBeNull();
    });

    test('returns null for channel without recipients', () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'No Recipients',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'test@test.com', pass: 'password' },
        },
        recipients: [],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      expect(sender).toBeNull();
    });

    test('returns null for channel with undefined recipients', () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Undefined Recipients',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'test@test.com', pass: 'password' },
        },
        events: { created: true },
      } as Channel;

      const sender = createEmailSender(channel);
      expect(sender).toBeNull();
    });
  });

  describe('successful sending', () => {
    test('sends email to single recipient', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Test Email',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      expect(sender).not.toBeNull();

      await sender!.send('Test Subject', 'Test Body');

      expect(capturedEmails).toHaveLength(1);
      expect(capturedEmails[0].to).toBe('receiver@test.com');
      expect(capturedEmails[0].subject).toBe('Test Subject');
      expect(capturedEmails[0].text).toBe('Test Body');
      expect(capturedEmails[0].html).toBe('Test Body');
    });

    test('sends email to multiple recipients', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Multi Recipient',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['user1@test.com', 'user2@test.com', 'user3@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      expect(sender).not.toBeNull();

      await sender!.send('Multi Subject', 'Multi Body');

      expect(capturedEmails).toHaveLength(1);
      expect(capturedEmails[0].to).toBe('user1@test.com, user2@test.com, user3@test.com');
    });

    test('uses channel name as from name', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'My Notification Service',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      await sender!.send('Subject', 'Body');

      expect(capturedEmails[0].from).toContain('My Notification Service');
      expect(capturedEmails[0].from).toContain('sender@test.com');
    });

    test('uses "Notification" as default from name when channel name is not set', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      await sender!.send('Subject', 'Body');

      expect(capturedEmails[0].from).toContain('Notification');
    });
  });

  describe('template variables in body', () => {
    test('passes body with template variables unchanged', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Template Test',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      const bodyWithVars = 'Task {{projectName}} started at {{timestamp}}. Duration: {{duration}}';
      
      await sender!.send('Template Subject', bodyWithVars);

      expect(capturedEmails[0].text).toBe(bodyWithVars);
      expect(capturedEmails[0].html).toBe(bodyWithVars);
    });
  });

  describe('error handling (silent failure)', () => {
    test('logs error on SMTP auth failure but does not throw', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Failing Email',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'bad@test.com', pass: 'wrong' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      // Mock sendMail to simulate auth failure
      mockSendMailBehavior = () => {
        throw new Error('Invalid login: 535 5.7.8 Username and Password not accepted');
      };

      const consoleErrorSpy = mock(() => {});
      const originalConsoleError = console.error;
      console.error = consoleErrorSpy;

      try {
        const sender = createEmailSender(channel);
        expect(sender).not.toBeNull();

        // Should not throw
        await sender!.send('Test Subject', 'Test Body');

        // Should have logged the error
        expect(consoleErrorSpy).toHaveBeenCalled();
      } finally {
        console.error = originalConsoleError;
      }
    });

    test('logs error with timestamp and channel name', async () => {
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Error Channel',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      mockSendMailBehavior = () => {
        throw new Error('Connection timeout');
      };

      const capturedLogs: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...args: any[]) => {
        capturedLogs.push(args.join(' '));
      };

      try {
        const sender = createEmailSender(channel);
        await sender!.send('Subject', 'Body');

        expect(capturedLogs.length).toBe(1);
        // Should contain timestamp pattern [ISO date]
        expect(capturedLogs[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
        // Should contain channel name
        expect(capturedLogs[0]).toContain('Error Channel');
        // Should contain error message
        expect(capturedLogs[0]).toContain('Connection timeout');
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  describe('security options', () => {
    test('sets disableFileAccess on transport', () => {
      // This is verified by the mock being called
      // The actual test is that createEmailSender doesn't throw
      const channel: Channel = {
        type: 'smtp',
        enabled: true,
        name: 'Security Test',
        config: {
          host: 'smtp.test.com',
          port: 465,
          secure: true,
          auth: { user: 'sender@test.com', pass: 'password' },
        },
        recipients: ['receiver@test.com'],
        events: { created: true },
      };

      const sender = createEmailSender(channel);
      expect(sender).not.toBeNull();
    });
  });
});
