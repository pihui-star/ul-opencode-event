/**
 * Webhook utility functions shared across channel senders.
 *
 * Provides HMAC-SHA256 signing and HTTP POST helpers used by
 * DingTalk, Feishu, and other webhook-based notification channels.
 */

/**
 * HMAC-SHA256 signing using Web Crypto API.
 * Returns base64-encoded signature.
 *
 * Replaces the fragile `btoa(String.fromCharCode(...new Uint8Array(signature)))` pattern
 * with a chunk-based conversion that avoids potential stack overflow on large data.
 *
 * @param key - The HMAC key
 * @param data - The data to sign
 * @returns Base64-encoded HMAC-SHA256 signature
 */
export async function hmacSha256Base64(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));

  // Convert ArrayBuffer to base64 using chunks to avoid stack overflow on large data
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * POST JSON to a webhook URL with timeout.
 *
 * @param url - Target URL
 * @param body - Request body (will be JSON.stringify'd)
 * @param timeoutMs - Timeout in milliseconds (default 10s)
 * @returns Fetch Response object
 */
export async function webhookPost(url: string, body: unknown, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}
