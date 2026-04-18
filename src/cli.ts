#!/usr/bin/env node
/**
 * CLI tool for testing notification channel configuration
 * 
 * Usage:
 *   npx @ulthon/ul-opencode-event test
 *   npx @ulthon/ul-opencode-event test --channel "My Channel"
 *   npx @ulthon/ul-opencode-event test --no-send  # Only verify connection, don't send email
 */
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Channel, SMTPConfig, DingtalkConfig, FeishuConfig, NotificationConfig } from './types.js';
import { generateSign, createDingTalkFormatter } from './dingtalk.js';
import { generateFeishuSign, createFeishuFormatter } from './feishu.js';

const CLI_PREFIX = '[ul-opencode-event-cli]';
const LOOKUP_TIMEOUT_MS = 1200;

/** Mock token data for CLI test messages */
const MOCK_TOKEN_DATA = {
  sessionCost: 0.05,
  sessionTokens: { input: 15000, output: 2500, reasoning: 800, cacheRead: 12000, cacheWrite: 3000, total: 32500 },
  totalCost: 0.05,
  totalTokens: { input: 15000, output: 2500, reasoning: 800, cacheRead: 12000, cacheWrite: 3000, total: 32500 },
  modelID: 'test-model',
  providerID: 'test-provider',
  mode: 'build',
  costFormatted: '$0.0500',
  totalCostFormatted: '$0.0500',
  currency: 'USD',
};

/** Build common EventPayload fields for test messages */
function buildTestPayload(timestamp: string) {
  return {
    eventType: 'idle' as const,
    timestamp,
    projectName: 'test',
    sessionId: 'cli-test',
    sessionType: 'main' as const,
    projectPath: process.cwd(),
    ...MOCK_TOKEN_DATA,
  };
}

/** Format token info as readable text for test messages */
function formatTokenInfo(): string {
  return `
Token Usage:
  Input: ${MOCK_TOKEN_DATA.sessionTokens.input.toLocaleString()}
  Output: ${MOCK_TOKEN_DATA.sessionTokens.output.toLocaleString()}
  Reasoning: ${MOCK_TOKEN_DATA.sessionTokens.reasoning.toLocaleString()}
  Cache Read: ${MOCK_TOKEN_DATA.sessionTokens.cacheRead.toLocaleString()}
  Cache Write: ${MOCK_TOKEN_DATA.sessionTokens.cacheWrite.toLocaleString()}
  Total: ${MOCK_TOKEN_DATA.sessionTokens.total.toLocaleString()}

Cost:
  Session Cost: ${MOCK_TOKEN_DATA.costFormatted}
  Total Cost: ${MOCK_TOKEN_DATA.totalCostFormatted}
  Currency: ${MOCK_TOKEN_DATA.currency}
  Model: ${MOCK_TOKEN_DATA.modelID}
  Provider: ${MOCK_TOKEN_DATA.providerID}
  Mode: ${MOCK_TOKEN_DATA.mode}`;
}

interface TestOptions {
  channelName?: string;
  noSend: boolean;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Usage: npx @ulthon/ul-opencode-event test [options]

Options:
  --channel <name>   Test only the channel with this name
  --no-send          Only verify connection, don't send test email
  --help             Show this help message

Examples:
  npx @ulthon/ul-opencode-event test
  npx @ulthon/ul-opencode-event test --channel "Primary Email"
  npx @ulthon/ul-opencode-event test --no-send
`);
}

/**
 * Parse command line arguments
 */
function parseArgs(): { command: string | null; options: TestOptions } {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    noSend: false,
  };

  let command: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === '--channel') {
      options.channelName = args[++i];
    } else if (arg === '--no-send') {
      options.noSend = true;
    } else if (!arg.startsWith('-')) {
      command = arg;
    }
  }

  return { command, options };
}

/**
 * Validate channel configuration
 */
function validateChannel(channel: Channel): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check enabled
  if (channel.enabled === false) {
    errors.push('Channel is disabled (enabled: false)');
    return { valid: false, errors };
  }

  // Dispatch by channel type
  if (channel.type === 'dingtalk') {
    return validateDingtalkChannel(channel, errors);
  }

  if (channel.type === 'feishu') {
    return validateFeishuChannel(channel, errors);
  }

  if (channel.type !== 'smtp') {
    errors.push(`Unsupported channel type: "${channel.type}". Supported types: "smtp", "dingtalk", "feishu".`);
    return { valid: false, errors };
  }

  // SMTP validation
  // Check recipients
  if (!channel.recipients || channel.recipients.length === 0) {
    errors.push('No recipients configured');
    return { valid: false, errors };
  }

  // Check SMTP config
  const config = channel.config as SMTPConfig;
  if (!config.host) {
    errors.push('SMTP host is missing');
  }
  if (!config.port) {
    errors.push('SMTP port is missing');
  }
  if (!config.auth?.user) {
    errors.push('SMTP auth.user is missing');
  }
  if (!config.auth?.pass) {
    errors.push('SMTP auth.pass is missing');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate DingTalk channel configuration
 */
function validateDingtalkChannel(channel: Channel, errors: string[]): { valid: boolean; errors: string[] } {
  const config = channel.config as DingtalkConfig;

  // Check webhook URL
  if (!config.webhook || !config.webhook.trim()) {
    errors.push('DingTalk webhook URL is missing');
  } else {
    const webhookUrl = config.webhook.trim();
    try {
      new URL(webhookUrl);
    } catch {
      errors.push(`DingTalk webhook URL is invalid: "${webhookUrl}"`);
    }
  }

  // Check secret (optional but must be non-empty string if provided)
  if (config.secret !== undefined && typeof config.secret === 'string' && !config.secret.trim()) {
    errors.push('DingTalk secret must be a non-empty string');
  }

  // Check @mention config structure
  if (config.at !== undefined) {
    if (typeof config.at !== 'object' || config.at === null || Array.isArray(config.at)) {
      errors.push('DingTalk at config must be an object with optional atMobiles/atAll fields');
    } else {
      if (config.at.atMobiles !== undefined && !Array.isArray(config.at.atMobiles)) {
        errors.push('DingTalk at.atMobiles must be a string array');
      }
      if (config.at.atAll !== undefined && typeof config.at.atAll !== 'boolean') {
        errors.push('DingTalk at.atAll must be a boolean');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Feishu channel configuration
 */
function validateFeishuChannel(channel: Channel, errors: string[]): { valid: boolean; errors: string[] } {
  const config = channel.config as FeishuConfig;

  // Check webhook URL
  if (!config.webhook || !config.webhook.trim()) {
    errors.push('Feishu webhook URL is missing');
  } else {
    const webhookUrl = config.webhook.trim();
    try {
      new URL(webhookUrl);
    } catch {
      errors.push(`Feishu webhook URL is invalid: "${webhookUrl}"`);
    }
  }

  // Check secret (optional but must be non-empty string if provided)
  if (config.secret !== undefined && typeof config.secret === 'string' && !config.secret.trim()) {
    errors.push('Feishu secret must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create SMTP transporter
 * Supports IPv4/IPv6 via localAddress option
 */
function createTransporter(channel: Channel, hostOverride?: string): nodemailer.Transporter {
  const config = channel.config as SMTPConfig;
  const host = hostOverride || config.host;

  const transportOptions: any = {
    host,
    port: config.port,
    secure: config.secure ?? (config.port === 465),
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
  };

  // Add localAddress for IPv4/IPv6 control
  // - "0.0.0.0" or specific IPv4 to force IPv4
  // - "::" or specific IPv6 to force IPv6
  if (config.localAddress) {
    transportOptions.localAddress = config.localAddress;
  }

  if (hostOverride && hostOverride !== config.host) {
    transportOptions.tls = {
      servername: config.host,
    };
  }

  return nodemailer.createTransport(transportOptions);
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
 * Test channel connection (SMTP or DingTalk)
 */
async function testConnection(channel: Channel): Promise<{ success: boolean; error?: string; info?: string }> {
  // DingTalk connection test
  if (channel.type === 'dingtalk') {
    return testDingtalkConnection(channel);
  }

  // Feishu connection test
  if (channel.type === 'feishu') {
    return testFeishuConnection(channel);
  }

  // SMTP connection test (existing logic)
  const config = channel.config as SMTPConfig;
  const preResolvedHost = await resolveHostViaLookup(config.host);
  if (preResolvedHost && preResolvedHost !== config.host) {
    try {
      const preResolvedTransporter = createTransporter(channel, preResolvedHost);
      await preResolvedTransporter.verify();
      return {
        success: true,
        info: `DNS pre-resolved: ${config.host} -> ${preResolvedHost}`,
      };
    } catch (preResolveError) {
      const preResolveMessage = preResolveError instanceof Error ? preResolveError.message : String(preResolveError);
      try {
        const transporter = createTransporter(channel);
        await transporter.verify();
        return {
          success: true,
          info: `DNS pre-resolve verify failed (${preResolveMessage}), hostname verify succeeded`,
        };
      } catch (hostError) {
        const hostMessage = hostError instanceof Error ? hostError.message : String(hostError);
        return { success: false, error: `${preResolveMessage}; hostname verify failed: ${hostMessage}` };
      }
    }
  }

  try {
    const transporter = createTransporter(channel);
    await transporter.verify();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldRetryWithLookup(message)) {
      return { success: false, error: message };
    }

    const resolvedHost = await resolveHostViaLookup(config.host);
    if (!resolvedHost) {
      return { success: false, error: `${message}; lookup() fallback failed for ${config.host}` };
    }

    try {
      const fallbackTransporter = createTransporter(channel, resolvedHost);
      await fallbackTransporter.verify();
      return {
        success: true,
        info: `DNS fallback used: ${config.host} -> ${resolvedHost}`,
      };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return { success: false, error: `${message}; fallback verify failed: ${fallbackMessage}` };
    }
  }
}

/**
 * Test DingTalk webhook connection by sending a minimal message
 */
async function testDingtalkConnection(channel: Channel): Promise<{ success: boolean; error?: string; info?: string }> {
  const config = channel.config as DingtalkConfig;
  const webhookUrl = config.webhook.trim();

  // Build URL with signing if secret is configured
  let targetUrl = webhookUrl;
  if (config.secret) {
    const timestamp = String(Date.now());
    const sign = await generateSign(config.secret, timestamp);
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}timestamp=${encodeURIComponent(timestamp)}&sign=${encodeURIComponent(sign)}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: 'connection test' } }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    let result: { errcode?: number; errmsg?: string };
    try {
      result = (await response.json()) as { errcode?: number; errmsg?: string };
    } catch {
      return { success: false, error: 'Failed to parse DingTalk API response' };
    }

    if (result.errcode !== undefined && result.errcode !== 0) {
      return { success: false, error: `DingTalk API error: errcode=${result.errcode}, errmsg=${result.errmsg ?? 'unknown'}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('abort')) {
      return { success: false, error: 'DingTalk connection timed out (10s)' };
    }
    return { success: false, error: message };
  }
}

/**
 * Test Feishu webhook connection by sending a minimal text message
 */
async function testFeishuConnection(channel: Channel): Promise<{ success: boolean; error?: string; info?: string }> {
  const config = channel.config as FeishuConfig;
  const webhookUrl = config.webhook.trim();

  // Build message body with signing if secret is configured
  const body: Record<string, unknown> = {
    msg_type: 'text',
    content: { text: 'connection test' },
  };

  if (config.secret) {
    // Feishu uses second-level timestamp
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = await generateFeishuSign(config.secret, timestamp);
    body.timestamp = timestamp;
    body.sign = sign;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    let result: { code?: number; msg?: string };
    try {
      result = (await response.json()) as { code?: number; msg?: string };
    } catch {
      return { success: false, error: 'Failed to parse Feishu API response' };
    }

    if (result.code !== undefined && result.code !== 0) {
      return { success: false, error: `Feishu API error: code=${result.code}, msg=${result.msg ?? 'unknown'}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('abort')) {
      return { success: false, error: 'Feishu connection timed out (10s)' };
    }
    return { success: false, error: message };
  }
}

/**
 * Send test email
 */
async function sendTestEmail(channel: Channel): Promise<{ success: boolean; error?: string; messageId?: string; info?: string }> {
  const config = channel.config as SMTPConfig;
  const fromName = channel.name || 'OpenCode Notification Test';
  const timestamp = new Date().toISOString();
  const mailOptions = {
    from: `"${fromName}" <${config.auth.user}>`,
    to: channel.recipients!.join(', '),
    subject: `[Test] OpenCode Notification Channel Test - ${timestamp}`,
    text: `This is a test email from OpenCode notification plugin.

Channel: ${channel.name || 'unnamed'}
Type: ${channel.type}
Time: ${timestamp}
${formatTokenInfo()}

If you received this email, your notification channel is configured correctly.`,
    html: `
        <h2>OpenCode Notification Channel Test</h2>
        <p>This is a test email from OpenCode notification plugin.</p>
        <hr>
        <ul>
          <li><strong>Channel:</strong> ${channel.name || 'unnamed'}</li>
          <li><strong>Type:</strong> ${channel.type}</li>
          <li><strong>Time:</strong> ${timestamp}</li>
        </ul>
        <h3>Token Usage</h3>
        <ul>
          <li><strong>Input:</strong> ${MOCK_TOKEN_DATA.sessionTokens.input.toLocaleString()}</li>
          <li><strong>Output:</strong> ${MOCK_TOKEN_DATA.sessionTokens.output.toLocaleString()}</li>
          <li><strong>Reasoning:</strong> ${MOCK_TOKEN_DATA.sessionTokens.reasoning.toLocaleString()}</li>
          <li><strong>Cache Read:</strong> ${MOCK_TOKEN_DATA.sessionTokens.cacheRead.toLocaleString()}</li>
          <li><strong>Cache Write:</strong> ${MOCK_TOKEN_DATA.sessionTokens.cacheWrite.toLocaleString()}</li>
          <li><strong>Total:</strong> ${MOCK_TOKEN_DATA.sessionTokens.total.toLocaleString()}</li>
        </ul>
        <h3>Cost</h3>
        <ul>
          <li><strong>Session Cost:</strong> ${MOCK_TOKEN_DATA.costFormatted}</li>
          <li><strong>Total Cost:</strong> ${MOCK_TOKEN_DATA.totalCostFormatted}</li>
          <li><strong>Currency:</strong> ${MOCK_TOKEN_DATA.currency}</li>
          <li><strong>Model:</strong> ${MOCK_TOKEN_DATA.modelID}</li>
          <li><strong>Provider:</strong> ${MOCK_TOKEN_DATA.providerID}</li>
          <li><strong>Mode:</strong> ${MOCK_TOKEN_DATA.mode}</li>
        </ul>
        <hr>
        <p style="color: green;">If you received this email, your notification channel is configured correctly.</p>
      `,
  };

  const preResolvedHost = await resolveHostViaLookup(config.host);
  if (preResolvedHost && preResolvedHost !== config.host) {
    try {
      const preResolvedTransporter = createTransporter(channel, preResolvedHost);
      const result = await preResolvedTransporter.sendMail(mailOptions);
      return {
        success: true,
        messageId: result.messageId,
        info: `DNS pre-resolved: ${config.host} -> ${preResolvedHost}`,
      };
    } catch (preResolveError) {
      const preResolveMessage = preResolveError instanceof Error ? preResolveError.message : String(preResolveError);
      try {
        const transporter = createTransporter(channel);
        const result = await transporter.sendMail(mailOptions);
        return {
          success: true,
          messageId: result.messageId,
          info: `DNS pre-resolve send failed (${preResolveMessage}), hostname send succeeded`,
        };
      } catch (hostError) {
        const hostMessage = hostError instanceof Error ? hostError.message : String(hostError);
        return { success: false, error: `${preResolveMessage}; hostname send failed: ${hostMessage}` };
      }
    }
  }

  try {
    const transporter = createTransporter(channel);
    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldRetryWithLookup(message)) {
      return { success: false, error: message };
    }

    const resolvedHost = await resolveHostViaLookup(config.host);
    if (!resolvedHost) {
      return { success: false, error: `${message}; lookup() fallback failed for ${config.host}` };
    }

    try {
      const fallbackTransporter = createTransporter(channel, resolvedHost);
      const result = await fallbackTransporter.sendMail(mailOptions);
      return {
        success: true,
        messageId: result.messageId,
        info: `DNS fallback used: ${config.host} -> ${resolvedHost}`,
      };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return { success: false, error: `${message}; fallback send failed: ${fallbackMessage}` };
    }
  }
}

/**
 * Send test message via DingTalk webhook
 */
async function sendTestDingTalkMessage(channel: Channel): Promise<{ success: boolean; error?: string; messageId?: string; info?: string }> {
  const config = channel.config as DingtalkConfig;
  const timestamp = new Date().toISOString();
  const channelName = channel.name || 'DingTalk Test';

  // Use DingTalk formatter to generate a properly formatted test message
  const formatter = createDingTalkFormatter(config);
  const testBody = `This is a test message from OpenCode notification plugin.

Channel: ${channelName}
Type: ${channel.type}
Time: ${timestamp}
${formatTokenInfo()}

If you received this message, your DingTalk notification channel is configured correctly.`;

  const formattedMessage = formatter.format(
    `[Test] OpenCode Notification Channel Test - ${timestamp}`,
    testBody,
    buildTestPayload(timestamp)
  );

  // Build URL with signing if secret is configured
  let targetUrl = config.webhook.trim();
  if (config.secret) {
    const ts = String(Date.now());
    const sign = await generateSign(config.secret, ts);
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}timestamp=${encodeURIComponent(ts)}&sign=${encodeURIComponent(sign)}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formattedMessage),
      signal: controller.signal,
    });

    clearTimeout(timer);

    let result: { errcode?: number; errmsg?: string };
    try {
      result = (await response.json()) as { errcode?: number; errmsg?: string };
    } catch {
      return { success: false, error: 'Failed to parse DingTalk API response' };
    }

    if (result.errcode !== undefined && result.errcode !== 0) {
      return { success: false, error: `DingTalk API error: errcode=${result.errcode}, errmsg=${result.errmsg ?? 'unknown'}` };
    }

    return { success: true, messageId: `dingtalk-${timestamp}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('abort')) {
      return { success: false, error: 'DingTalk send timed out (10s)' };
    }
    return { success: false, error: message };
  }
}

/**
 * Send test message via Feishu webhook
 */
async function sendTestFeishuMessage(channel: Channel): Promise<{ success: boolean; error?: string; messageId?: string; info?: string }> {
  const config = channel.config as FeishuConfig;
  const timestamp = new Date().toISOString();
  const channelName = channel.name || 'Feishu Test';

  // Use Feishu formatter to generate a properly formatted test message
  const formatter = createFeishuFormatter(config);
  const testBody = `This is a test message from OpenCode notification plugin.

Channel: ${channelName}
Type: ${channel.type}
Time: ${timestamp}
${formatTokenInfo()}

If you received this message, your Feishu notification channel is configured correctly.`;

  const formattedMessage = formatter.format(
    `[Test] OpenCode Notification Channel Test - ${timestamp}`,
    testBody,
    buildTestPayload(timestamp)
  );

  // Build body with signing if secret is configured
  const body: Record<string, unknown> = { ...formattedMessage };
  if (config.secret) {
    // Feishu uses second-level timestamp
    const ts = String(Math.floor(Date.now() / 1000));
    const sign = await generateFeishuSign(config.secret, ts);
    body.timestamp = ts;
    body.sign = sign;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(config.webhook.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    let result: { code?: number; msg?: string };
    try {
      result = (await response.json()) as { code?: number; msg?: string };
    } catch {
      return { success: false, error: 'Failed to parse Feishu API response' };
    }

    if (result.code !== undefined && result.code !== 0) {
      return { success: false, error: `Feishu API error: code=${result.code}, msg=${result.msg ?? 'unknown'}` };
    }

    return { success: true, messageId: `feishu-${timestamp}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('abort')) {
      return { success: false, error: 'Feishu send timed out (10s)' };
    }
    return { success: false, error: message };
  }
}

/**
 * Test a single channel
 */
async function testChannel(channel: Channel, options: TestOptions): Promise<boolean> {
  const channelName = channel.name || 'unnamed';
  console.log(`\n${CLI_PREFIX} Testing channel: "${channelName}"`);
  console.log(`  Type: ${channel.type}`);
  console.log(`  Recipients: ${channel.recipients?.join(', ') || 'none'}`);

  // Step 1: Validate configuration
  console.log(`\n  [1/3] Validating configuration...`);
  const validation = validateChannel(channel);
  if (!validation.valid) {
    console.log(`  [FAIL] Configuration validation failed:`);
    validation.errors.forEach(err => console.log(`    - ${err}`));
    return false;
  }
  console.log(`  [OK] Configuration is valid`);

  // Step 2: Test connection (type-specific output)
  const isDingtalk = channel.type === 'dingtalk';
  const isFeishu = channel.type === 'feishu';
  if (isDingtalk) {
    const dtConfig = channel.config as DingtalkConfig;
    console.log(`\n  [2/3] Testing DingTalk webhook: ${dtConfig.webhook}...`);
  } else if (isFeishu) {
    const fsConfig = channel.config as FeishuConfig;
    console.log(`\n  [2/3] Testing Feishu webhook: ${fsConfig.webhook}...`);
  } else {
    const smtpConfig = channel.config as SMTPConfig;
    console.log(`\n  [2/3] Testing SMTP connection to ${smtpConfig.host}:${smtpConfig.port}...`);
  }

  const connectionResult = await testConnection(channel);
  if (!connectionResult.success) {
    console.log(`  [FAIL] Connection failed: ${connectionResult.error}`);
    return false;
  }
  console.log(`  [OK] Connection successful`);
  if (connectionResult.info) {
    console.log(`  [INFO] ${connectionResult.info}`);
  }

  // Step 3: Send test message (if not skipped)
  if (options.noSend) {
    const skipLabel = isDingtalk || isFeishu ? 'test message' : 'test email';
    console.log(`\n  [3/3] Skipping ${skipLabel} (--no-send flag)`);
    console.log(`\n  [SUCCESS] Channel "${channelName}" passed all tests (connection only)`);
    return true;
  }

  if (isDingtalk) {
    console.log(`\n  [3/3] Sending test message to DingTalk...`);
    const sendResult = await sendTestDingTalkMessage(channel);
    if (!sendResult.success) {
      console.log(`  [FAIL] Failed to send test message: ${sendResult.error}`);
      return false;
    }
    console.log(`  [OK] Test message sent successfully`);
    if (sendResult.info) {
      console.log(`  [INFO] ${sendResult.info}`);
    }
    console.log(`  Message ID: ${sendResult.messageId}`);

    console.log(`\n  [SUCCESS] Channel "${channelName}" passed all tests`);
    console.log(`  Please check your DingTalk group chat.`);
  } else if (isFeishu) {
    console.log(`\n  [3/3] Sending test message to Feishu...`);
    const sendResult = await sendTestFeishuMessage(channel);
    if (!sendResult.success) {
      console.log(`  [FAIL] Failed to send test message: ${sendResult.error}`);
      return false;
    }
    console.log(`  [OK] Test message sent successfully`);
    if (sendResult.info) {
      console.log(`  [INFO] ${sendResult.info}`);
    }
    console.log(`  Message ID: ${sendResult.messageId}`);

    console.log(`\n  [SUCCESS] Channel "${channelName}" passed all tests`);
    console.log(`  Please check your Feishu group chat.`);
  } else {
    console.log(`\n  [3/3] Sending test email...`);
    const sendResult = await sendTestEmail(channel);
    if (!sendResult.success) {
      console.log(`  [FAIL] Failed to send test email: ${sendResult.error}`);
      return false;
    }
    console.log(`  [OK] Test email sent successfully`);
    if (sendResult.info) {
      console.log(`  [INFO] ${sendResult.info}`);
    }
    console.log(`  Message ID: ${sendResult.messageId}`);

    console.log(`\n  [SUCCESS] Channel "${channelName}" passed all tests`);
    console.log(`  Please check the inbox of: ${channel.recipients?.join(', ')}`);
  }

  return true;
}

/**
 * Load configuration (simplified version that loads from file)
 * This is similar to config.ts but returns all channels including disabled ones
 */
function loadConfigForTesting(): NotificationConfig {

  // Config file paths
  const globalPath = path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
  const projectOpencodePath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
  const projectLocalPath = path.join(process.cwd(), 'ul-opencode-event.json');

  let globalConfig: NotificationConfig | null = null;
  let projectConfig: NotificationConfig | null = null;

  // Load global config
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf-8');
      globalConfig = JSON.parse(content);
      console.log(`${CLI_PREFIX} Loaded global config: ${globalPath}`);
    } catch (error) {
      console.error(`${CLI_PREFIX} Failed to parse global config: ${globalPath}`, error);
    }
  }

  // Load project config
  const projectPath = fs.existsSync(projectOpencodePath) ? projectOpencodePath :
                      fs.existsSync(projectLocalPath) ? projectLocalPath : null;
  if (projectPath) {
    try {
      const content = fs.readFileSync(projectPath, 'utf-8');
      projectConfig = JSON.parse(content);
      console.log(`${CLI_PREFIX} Loaded project config: ${projectPath}`);
    } catch (error) {
      console.error(`${CLI_PREFIX} Failed to parse project config: ${projectPath}`, error);
    }
  }

  // If no configs found
  if (!globalConfig && !projectConfig) {
    console.error(`${CLI_PREFIX} No configuration file found.`);
    console.error(`${CLI_PREFIX} Checked locations:`);
    console.error(`  - ${globalPath}`);
    console.error(`  - ${projectOpencodePath}`);
    console.error(`  - ${projectLocalPath}`);
    process.exit(1);
  }

  // Merge channels (project overrides global by name)
  const globalChannels = globalConfig?.channels || [];
  const projectChannels = projectConfig?.channels || [];

  const mergedChannels = [...globalChannels];
  for (const projectChannel of projectChannels) {
    if (projectChannel.name) {
      const existingIndex = mergedChannels.findIndex(c => c.name === projectChannel.name);
      if (existingIndex >= 0) {
        mergedChannels[existingIndex] = projectChannel;
        continue;
      }
    }
    mergedChannels.push(projectChannel);
  }

  // Merge top-level fields (language, timezone) — project config takes priority
  const mergedLanguage = projectConfig?.language ?? globalConfig?.language;
  const mergedTimezone = projectConfig?.timezone ?? globalConfig?.timezone;

  return {
    channels: mergedChannels,
    ...(mergedLanguage !== undefined && { language: mergedLanguage }),
    ...(mergedTimezone !== undefined && { timezone: mergedTimezone }),
  };
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const { command, options } = parseArgs();

  if (command !== 'test') {
    console.error(`${CLI_PREFIX} Unknown command: "${command || '(none)'}"`);
    printUsage();
    process.exit(1);
  }

  console.log(`${CLI_PREFIX} Starting channel test...`);

  // Load configuration
  const config = loadConfigForTesting();

  if (config.channels.length === 0) {
    console.error(`${CLI_PREFIX} No channels configured.`);
    process.exit(1);
  }

  // Filter channels by name if specified
  let channelsToTest = config.channels;
  if (options.channelName) {
    channelsToTest = config.channels.filter(c => c.name === options.channelName);
    if (channelsToTest.length === 0) {
      console.error(`${CLI_PREFIX} No channel found with name: "${options.channelName}"`);
      console.error(`${CLI_PREFIX} Available channels:`);
      config.channels.forEach(c => console.error(`  - ${c.name || 'unnamed'}`));
      process.exit(1);
    }
  }

  console.log(`${CLI_PREFIX} Found ${channelsToTest.length} channel(s) to test`);

  // Test each channel
  let successCount = 0;
  let failCount = 0;

  for (const channel of channelsToTest) {
    const success = await testChannel(channel, options);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  console.log(`\n${CLI_PREFIX} Test Summary:`);
  console.log(`  Passed: ${successCount}`);
  console.log(`  Failed: ${failCount}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

// Run CLI
main().catch(error => {
  console.error(`${CLI_PREFIX} Unexpected error:`, error);
  process.exit(1);
});
