/**
 * Email sender module for SMTP-based notifications
 *
 * nodemailer is loaded lazily to avoid top-level import issues
 * that can conflict with oh-my-opencode's bundled nodemailer.
 *
 * DNS Pre-Resolution Strategy:
 * In environments with proxy/TUN mode (e.g., Clash, V2Ray), DNS may be hijacked
 * to return fake IPs (e.g., 198.18.x.x). We proactively resolve DNS before creating
 * the transport to bypass proxy interference, matching cli.ts behavior.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { logger, DEBUG_ENABLED } from './logger.js';
import type { Channel, ChannelSender, SMTPConfig } from './types.js';

const LOOKUP_TIMEOUT_MS = 1200;

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
 * Resolve hostname via DNS lookup with timeout, trying IPv4 first then IPv6.
 * Returns null if resolution fails or host is already an IP.
 *
 * This uses node:dns/promises.lookup directly (not nodemailer's internal resolver)
 * to get real IP addresses even when system DNS is proxied/hijacked.
 */
async function resolveHostViaLookup(host: string): Promise<string | null> {
  if (isIP(host) !== 0) {
    return host;
  }

  const withTimeout = <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`lookup timeout after ${timeoutMs}ms`)), timeoutMs);
      task.then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); }
      );
    });
  };

  // Try IPv4 first (most SMTP servers support it)
  try {
    const addr = await withTimeout(lookup(host, { family: 4 }), LOOKUP_TIMEOUT_MS);
    logger.debug(`DNS resolved ${host} -> ${addr.address}`);
    return addr.address;
  } catch {
    // IPv4 failed, try IPv6
  }

  try {
    const addr = await withTimeout(lookup(host, { family: 6 }), LOOKUP_TIMEOUT_MS);
    logger.debug(`DNS resolved ${host} -> ${addr.address}`);
    return addr.address;
  } catch {
    // Both failed
  }

  logger.debug(`DNS lookup failed for ${host}, using original (fallback)`);
  return null;
}

/**
 * Check if an error message suggests we should retry with a pre-resolved IP address.
 * Covers DNS failures AND connection-refused errors (proxy TUN fake IP scenario).
 */
function shouldRetryWithLookup(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('econnrefused') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout') ||
    normalized.includes('querya etimeout') ||
    normalized.includes('queryaaaa etimeout') ||
    normalized.includes('enotfound') ||
    normalized.includes('eai_again') ||
    normalized.includes('getaddrinfo')
  );
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
    secure: config.secure ?? (config.port === 465),
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
 * Create a nodemailer transporter, preferring pre-resolved IP when available.
 */
function createTransporter(
  nodemailer: typeof import('nodemailer'),
  config: SMTPConfig,
  resolvedHost?: string
): import('nodemailer').Transporter {
  const transporter = nodemailer.createTransport(buildTransportOptions(config, resolvedHost));
  transporter.set('disableFileAccess', true);
  transporter.set('disableUrlAccess', true);
  return transporter;
}

/**
 * Create an email sender for the given SMTP channel.
 * nodemailer is imported dynamically to avoid blocking the plugin loading.
 *
 * Proactively resolves DNS at creation time to handle proxy/TUN environments
 * where DNS may be hijacked (e.g., 198.18.x.x fake IPs from Clash).
 */
export async function createEmailSender(channel: Channel): Promise<ChannelSender | null> {
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

  // Proactive DNS pre-resolution (same strategy as cli.ts)
  // This ensures we use real IP addresses even in proxy/TUN environments
  const preResolvedHost = await resolveHostViaLookup(config.host);

  // Create primary transporter with pre-resolved IP if available
  const transporter = createTransporter(nodemailer, config, preResolvedHost || undefined);

  return {
    send: async (message: unknown, legacyBody?: unknown): Promise<void> => {
      let subject: string;
      let body: string;

      // Format 1: New ChannelSender format from formatter layer ({ subject, text })
      if (message && typeof message === 'object') {
        const msg = message as { subject?: string; text?: string };
        if (typeof msg.subject === 'string' && typeof msg.text === 'string') {
          subject = msg.subject;
          body = msg.text;
        } else {
          return;
        }
      }
      // Format 2: Legacy EmailSender format (direct call with two args)
      else if (typeof message === 'string') {
        subject = message;
        body = typeof legacyBody === 'string' ? legacyBody : '';
      }
      else {
        return;
      }

      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: channel.recipients!.join(', '),
        subject,
        text: body,
      };

      // Strategy 1: Try pre-resolved transport first (bypasses proxy DNS hijacking)
      if (preResolvedHost && preResolvedHost !== config.host) {
        try {
          await transporter.sendMail(mailOptions);
          if (DEBUG_ENABLED) {
            logger.debug(`[${fromName}] Email sent successfully (pre-resolved: ${preResolvedHost})`);
          }
          return;
        } catch (preResolveError) {
          const preResolveMessage = preResolveError instanceof Error ? preResolveError.message : String(preResolveError);
          if (DEBUG_ENABLED) {
            logger.warn(`[${fromName}] Pre-resolved send failed (${preResolveMessage}), trying hostname...`);
          }

          // Strategy 2: Fallback to hostname-based transport
          try {
            const hostTransporter = createTransporter(nodemailer, config);
            await hostTransporter.sendMail(mailOptions);
            if (DEBUG_ENABLED) {
              logger.debug(`[${fromName}] Email sent via hostname fallback`);
            }
            return;
          } finally {
            // hostTransporter will be GC'd; no explicit close needed for one-off sends
          }
        }
      }

      // Strategy 3: No pre-resolution available or same as hostname, use direct transport
      try {
        await transporter.sendMail(mailOptions);
        if (DEBUG_ENABLED) {
          logger.debug(`[${fromName}] Email sent successfully`);
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Strategy 4: On connection/DNS errors, attempt fresh DNS resolution as last resort
        if (shouldRetryWithLookup(message)) {
          const resolvedHost = await resolveHostViaLookup(config.host);
          if (resolvedHost && resolvedHost !== config.host && resolvedHost !== preResolvedHost) {
            let fallbackTransport: import('nodemailer').Transporter | null = null;
            try {
              fallbackTransport = createTransporter(nodemailer, config, resolvedHost);
              await fallbackTransport.sendMail(mailOptions);
              if (DEBUG_ENABLED) {
                logger.debug(`[${fromName}] Email sent via emergency fallback (resolved: ${resolvedHost})`);
              }
              return;
            } catch {
              // Emergency fallback also failed
            } finally {
              fallbackTransport?.close();
            }
          }
        }

        // Silent failure: log error but don't throw
        logger.error(`[${fromName}] Failed to send email: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    close: async (): Promise<void> => {
      transporter.close();
    },
  };
}
