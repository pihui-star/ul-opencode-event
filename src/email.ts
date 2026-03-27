/**
 * Email sender module for SMTP-based notifications
 *
 * nodemailer is loaded lazily to avoid top-level import issues
 * that can conflict with oh-my-opencode's bundled nodemailer.
 */
import * as dns from 'dns';
import * as net from 'net';
import type { Channel, SMTPConfig } from './types.js';

const LOG_PREFIX = '[ul-opencode-event]';
const DEBUG_ENABLED = process.env.UL_OPENCODE_EVENT_DEBUG === '1' || process.env.UL_OPENCODE_EVENT_DEBUG === 'true';

// Lazy-loaded nodemailer cache
let nodemailerModule: typeof import('nodemailer') | null = null;

async function getNodemailer() {
  if (!nodemailerModule) {
    nodemailerModule = await import('nodemailer');
  }
  return nodemailerModule;
}

export interface EmailSender {
  send: (subject: string, body: string) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Resolve hostname via DNS lookup, returning the first resolved address.
 * Returns null if resolution fails.
 */
async function resolveHostViaLookup(host: string): Promise<string | null> {
  try {
    const result = await dns.promises.lookup(host);
    return result.address;
  } catch {
    return null;
  }
}

/**
 * Check if an error message suggests DNS resolution failure,
 * indicating we should retry with a pre-resolved IP address.
 */
function shouldRetryWithLookup(errorMessage: string): boolean {
  const retryPatterns = [
    'getaddrinfo',
    'ENOTFOUND',
    'EAI_AGAIN',
    'lookup',
    'dns',
  ];
  return retryPatterns.some((pattern) => errorMessage.toLowerCase().includes(pattern));
}

/**
 * Build nodemailer transport options, optionally using a pre-resolved host.
 */
function buildTransportOptions(
  config: SMTPConfig,
  resolvedHost?: string
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    host: resolvedHost || config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
  };

  if (config.localAddress) {
    options.localAddress = config.localAddress;
  }

  if (resolvedHost && resolvedHost !== config.host) {
    options.tls = {
      servername: config.host,
    };
  }

  return options;
}

/**
 * Create an email sender for the given SMTP channel.
 * nodemailer is imported dynamically to avoid blocking the plugin loading.
 */
export async function createEmailSender(channel: Channel): Promise<EmailSender | null> {
  if (channel.type !== 'smtp') {
    return null;
  }

  if (channel.enabled === false) {
    return null;
  }

  if (!channel.recipients || channel.recipients.length === 0) {
    return null;
  }

  const config = channel.config as SMTPConfig;
  const fromName = channel.name || 'Notification';
  const fromAddress = config.auth.user;

  // Load nodemailer lazily
  const nodemailer = await getNodemailer();

  // Create primary transporter
  const transporter = nodemailer.createTransport(buildTransportOptions(config));
  transporter.set('disableFileAccess', true);
  transporter.set('disableUrlAccess', true);

  return {
    send: async (subject: string, body: string): Promise<void> => {
      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: channel.recipients!.join(', '),
        subject,
        text: body,
      };

      // Try primary transport first (connection reuse)
      try {
        await transporter.sendMail(mailOptions);
        if (DEBUG_ENABLED) {
          console.info(`${LOG_PREFIX} [${fromName}] Email sent successfully`);
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (shouldRetryWithLookup(message)) {
          // DNS failure - retry with pre-resolved IP
          const resolvedHost = await resolveHostViaLookup(config.host);
          if (resolvedHost && !net.isIP(config.host)) {
            let fallbackTransport: import('nodemailer').Transporter | null = null;
            try {
              fallbackTransport = nodemailer.createTransport(
                buildTransportOptions(config, resolvedHost)
              );
              fallbackTransport.set('disableFileAccess', true);
              fallbackTransport.set('disableUrlAccess', true);
              await fallbackTransport.sendMail(mailOptions);
              if (DEBUG_ENABLED) {
                console.info(`${LOG_PREFIX} [${fromName}] Email sent via fallback (resolved: ${resolvedHost})`);
              }
              return;
            } catch {
              // Fallback also failed, fall through to silent error logging
            } finally {
              fallbackTransport?.close();
            }
          }
        }

        // Silent failure: log error but don't throw
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] [${fromName}] Failed to send email:`, error);
      }
    },

    close: async (): Promise<void> => {
      transporter.close();
    },
  };
}
