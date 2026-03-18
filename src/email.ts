/**
 * Email sender module for SMTP-based notifications
 */
import * as nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Channel, SMTPConfig } from './types.js';

export interface EmailSender {
  send: (subject: string, body: string) => Promise<void>;
}

function shouldRetryWithLookup(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('querya etimeout') ||
    normalized.includes('queryaaaa etimeout') ||
    normalized.includes('enotfound') ||
    normalized.includes('eai_again')
  );
}

async function resolveHostViaLookup(host: string): Promise<string | null> {
  if (isIP(host) !== 0) {
    return host;
  }

  try {
    const addr = await lookup(host, { family: 4 });
    return addr.address;
  } catch {}

  try {
    const addr = await lookup(host, { family: 6 });
    return addr.address;
  } catch {}

  return null;
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

  const createTransport = (hostOverride?: string): nodemailer.Transporter => {
    const host = hostOverride || config.host;
    const transportOptions: any = {
      host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.auth.user,
        pass: config.auth.pass,
      },
    };

    if (config.localAddress) {
      transportOptions.localAddress = config.localAddress;
    }

    if (hostOverride && hostOverride !== config.host) {
      transportOptions.tls = {
        servername: config.host,
      };
    }

    const transport = nodemailer.createTransport(transportOptions);
    transport.set('disableFileAccess', true);
    transport.set('disableUrlAccess', true);
    return transport;
  };

  return {
    async send(subject: string, body: string): Promise<void> {
      const mailOptions = {
        from: `"${fromName}" <${config.auth.user}>`,
        to: channel.recipients!.join(', '),
        subject,
        html: body,
        text: body,
      };

      try {
        const transport = createTransport();
        await transport.sendMail(mailOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldRetryWithLookup(message)) {
          const resolvedHost = await resolveHostViaLookup(config.host);
          if (resolvedHost) {
            try {
              const fallbackTransport = createTransport(resolvedHost);
              await fallbackTransport.sendMail(mailOptions);
              return;
            } catch {}
          }
        }

        // Silent failure: log error but don't throw
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${fromName}] Failed to send email:`, error);
      }
    },
  };
}
