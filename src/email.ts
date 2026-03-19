/**
 * Email sender module for SMTP-based notifications
 */
import * as nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Channel, SMTPConfig } from './types.js';
const LOOKUP_TIMEOUT_MS = 1200;

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

  const withTimeout = <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`lookup timeout after ${timeoutMs}ms`)), timeoutMs);
      task.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  };

  try {
    const addr = await withTimeout(lookup(host, { family: 4 }), LOOKUP_TIMEOUT_MS);
    return addr.address;
  } catch {}

  try {
    const addr = await withTimeout(lookup(host, { family: 6 }), LOOKUP_TIMEOUT_MS);
    return addr.address;
  } catch {}

  return null;
}

/**
 * Creates nodemailer transport options
 */
function buildTransportOptions(config: SMTPConfig, hostOverride?: string): object {
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

  return transportOptions;
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

  // Create and cache the primary transporter (connection reuse)
  const primaryTransport = nodemailer.createTransport(buildTransportOptions(config));
  primaryTransport.set('disableFileAccess', true);
  primaryTransport.set('disableUrlAccess', true);

  return {
    async send(subject: string, body: string): Promise<void> {
      const mailOptions = {
        from: `"${fromName}" <${config.auth.user}>`,
        to: channel.recipients!.join(', '),
        subject,
        html: body,
        text: body,
      };

      // Try pre-resolved host first if DNS resolution succeeded
      const preResolvedHost = await resolveHostViaLookup(config.host);
      if (preResolvedHost && preResolvedHost !== config.host) {
        try {
          // Create temporary transport for resolved IP (can't reuse for different host)
          const preResolvedTransport = nodemailer.createTransport(
            buildTransportOptions(config, preResolvedHost)
          );
          preResolvedTransport.set('disableFileAccess', true);
          preResolvedTransport.set('disableUrlAccess', true);
          await preResolvedTransport.sendMail(mailOptions);
          return;
        } catch {}
      }

      try {
        // Use cached primary transporter (connection reuse)
        await primaryTransport.sendMail(mailOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldRetryWithLookup(message)) {
          const resolvedHost = await resolveHostViaLookup(config.host);
          if (resolvedHost) {
            try {
              // Create temporary transport for fallback (different host)
              const fallbackTransport = nodemailer.createTransport(
                buildTransportOptions(config, resolvedHost)
              );
              fallbackTransport.set('disableFileAccess', true);
              fallbackTransport.set('disableUrlAccess', true);
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
