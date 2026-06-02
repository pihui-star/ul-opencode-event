/**
 * DNS pre-resolution utilities
 *
 * Shared between email.ts and cli.ts to avoid duplication.
 *
 * In environments with proxy/TUN mode (e.g., Clash, V2Ray), DNS may be hijacked
 * to return fake IPs (e.g., 198.18.x.x). We proactively resolve DNS before creating
 * the transport to bypass proxy interference.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const LOOKUP_TIMEOUT_MS = 1200;

/**
 * Wrap a promise with a timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lookup timeout after ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * Resolve hostname via DNS lookup with timeout, trying IPv4 first then IPv6.
 * Returns null if resolution fails or host is already an IP.
 *
 * This uses node:dns/promises.lookup directly (not nodemailer's internal resolver)
 * to get real IP addresses even when system DNS is proxied/hijacked.
 */
export async function resolveHostViaLookup(host: string): Promise<string | null> {
  if (isIP(host) !== 0) {
    return host;
  }

  // Try IPv4 first (most SMTP servers support it)
  try {
    const addr = await withTimeout(lookup(host, { family: 4 }), LOOKUP_TIMEOUT_MS);
    return addr.address;
  } catch {
    // IPv4 failed, try IPv6
  }

  try {
    const addr = await withTimeout(lookup(host, { family: 6 }), LOOKUP_TIMEOUT_MS);
    return addr.address;
  } catch {
    // Both failed
  }

  return null;
}

/**
 * Check if an error message suggests we should retry with a pre-resolved IP address.
 * Covers DNS failures AND connection-refused errors (proxy TUN fake IP scenario).
 */
export function shouldRetryWithLookup(message: string): boolean {
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
