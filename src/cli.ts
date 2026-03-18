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
import type { Channel, SMTPConfig, NotificationConfig } from './types.js';

const CLI_PREFIX = '[ul-opencode-event-cli]';

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

  // Check type
  if (channel.type !== 'smtp') {
    errors.push(`Unsupported channel type: "${channel.type}". Only "smtp" is supported.`);
    return { valid: false, errors };
  }

  // Check enabled
  if (channel.enabled === false) {
    errors.push('Channel is disabled (enabled: false)');
    return { valid: false, errors };
  }

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
 * Create SMTP transporter
 * Supports IPv4/IPv6 via localAddress option
 */
function createTransporter(channel: Channel): nodemailer.Transporter {
  const config = channel.config as SMTPConfig;

  const transportOptions: any = {
    host: config.host,
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

  return nodemailer.createTransport(transportOptions);
}

/**
 * Test SMTP connection
 */
async function testConnection(channel: Channel): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = createTransporter(channel);
    await transporter.verify();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Send test email
 */
async function sendTestEmail(channel: Channel): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const config = channel.config as SMTPConfig;
    const transporter = createTransporter(channel);
    const fromName = channel.name || 'OpenCode Notification Test';
    const timestamp = new Date().toISOString();

    const result = await transporter.sendMail({
      from: `"${fromName}" <${config.auth.user}>`,
      to: channel.recipients!.join(', '),
      subject: `[Test] OpenCode Notification Channel Test - ${timestamp}`,
      text: `This is a test email from OpenCode notification plugin.

Channel: ${channel.name || 'unnamed'}
Type: ${channel.type}
Time: ${timestamp}

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
        <hr>
        <p style="color: green;">If you received this email, your notification channel is configured correctly.</p>
      `,
    });

    return { success: true, messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

  // Step 2: Test connection
  const smtpConfig = channel.config as SMTPConfig;
  console.log(`\n  [2/3] Testing SMTP connection to ${smtpConfig.host}:${smtpConfig.port}...`);
  const connectionResult = await testConnection(channel);
  if (!connectionResult.success) {
    console.log(`  [FAIL] Connection failed: ${connectionResult.error}`);
    return false;
  }
  console.log(`  [OK] Connection successful`);

  // Step 3: Send test email (if not skipped)
  if (options.noSend) {
    console.log(`\n  [3/3] Skipping test email (--no-send flag)`);
    console.log(`\n  [SUCCESS] Channel "${channelName}" passed all tests (connection only)`);
    return true;
  }

  console.log(`\n  [3/3] Sending test email...`);
  const sendResult = await sendTestEmail(channel);
  if (!sendResult.success) {
    console.log(`  [FAIL] Failed to send test email: ${sendResult.error}`);
    return false;
  }
  console.log(`  [OK] Test email sent successfully`);
  console.log(`  Message ID: ${sendResult.messageId}`);

  console.log(`\n  [SUCCESS] Channel "${channelName}" passed all tests`);
  console.log(`  Please check the inbox of: ${channel.recipients?.join(', ')}`);
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

  return { channels: mergedChannels };
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
