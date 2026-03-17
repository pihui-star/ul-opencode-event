/**
 * Email sender module for SMTP-based notifications
 */
import * as nodemailer from 'nodemailer';
import type { Channel, SMTPConfig } from './types';

export interface EmailSender {
  send: (subject: string, body: string) => Promise<void>;
}

/**
 * Creates an email sender for the given SMTP channel
 * @param channel - The channel configuration (must be SMTP type)
 * @returns EmailSender instance or null if channel is invalid/disabled
 */
export function createEmailSender(channel: Channel): EmailSender | null {
  // Type guard: return null for non-smtp channels
  if (channel.type !== 'smtp') {
    return null;
  }

  // Return null for disabled channels
  if (channel.enabled === false) {
    return null;
  }

  // Return null if no recipients configured
  if (!channel.recipients || channel.recipients.length === 0) {
    return null;
  }

  const config = channel.config as SMTPConfig;
  const fromName = channel.name || 'Notification';

  // Create nodemailer transport with SMTP config
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
  });

  // Set security options
  transport.set('disableFileAccess', true);
  transport.set('disableUrlAccess', true);

  return {
    async send(subject: string, body: string): Promise<void> {
      try {
        await transport.sendMail({
          from: `"${fromName}" <${config.auth.user}>`,
          to: channel.recipients!.join(', '),
          subject,
          html: body,
          text: body,
        });
      } catch (error) {
        // Silent failure: log error but don't throw
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${fromName}] Failed to send email:`, error);
      }
    },
  };
}
