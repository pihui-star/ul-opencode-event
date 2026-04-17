import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { NotificationConfig, Channel, SessionType, CostConfig } from './types.js';
import { DEFAULT_SESSION_TYPES, SUPPORTED_CURRENCIES } from './types.js';
import { logger } from './logger.js';

const SUPPORTED_CHANNEL_TYPES = ['smtp', 'dingtalk', 'feishu', 'file'] as const;

/**
 * Default configuration returned when no config files exist
 */
const DEFAULT_CONFIG: NotificationConfig = {
  channels: [],
};

/**
 * Load and parse a JSON config file if it exists
 */
function loadConfigFile(filePath: string): NotificationConfig | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as NotificationConfig;
    if (!Array.isArray(config.channels)) {
      logger.error(`Invalid config format in ${filePath}: "channels" must be an array`);
      return null;
    }
    logger.debug(`Loaded config: ${filePath} (${config.channels.length} channels)`);
    return config;
  } catch (error) {
    logger.error(`Failed to parse config file: ${filePath}: ${error}`);
    return null;
  }
}

/**
 * Validate channel types and filter out unsupported ones
 * Warns for unknown types, returns only supported channels
 * @returns Filtered array containing only channels with supported types
 */
function validateAndFilterChannels(channels: Channel[]): Channel[] {
  return channels.filter((channel) => {
    if (!SUPPORTED_CHANNEL_TYPES.includes(channel.type as typeof SUPPORTED_CHANNEL_TYPES[number])) {
      logger.warn(
        `Unknown channel type: "${channel.type}" in channel "${channel.name}". Supported types: ${SUPPORTED_CHANNEL_TYPES.join(', ')}. Skipping.`
      );
      return false;
    }
    return true;
  });
}

/**
 * Validate and normalize includeSessionTypes config value.
 * Returns valid SessionType array with illegal values filtered out.
 */
function validateIncludeSessionTypes(types?: unknown): SessionType[] {
  const VALID_TYPES: SessionType[] = ['main', 'subagent', 'unknown'];

  // null/undefined → default
  if (types === null || types === undefined) {
    return [...DEFAULT_SESSION_TYPES];
  }

  // non-array → warn + default
  if (!Array.isArray(types)) {
    logger.warn(`includeSessionTypes must be an array, got ${typeof types}. Using default.`);
    return [...DEFAULT_SESSION_TYPES];
  }

  // empty array → default
  if (types.length === 0) {
    return [...DEFAULT_SESSION_TYPES];
  }

  // filter + validate each item
  const result: SessionType[] = [];
  for (const item of types) {
    if (typeof item === 'string' && VALID_TYPES.includes(item as SessionType)) {
      result.push(item as SessionType);
    } else {
      logger.warn(`Invalid session type "${item}" in includeSessionTypes. Valid values: ${VALID_TYPES.join(', ')}`);
    }
  }

  // all invalid → default
  if (result.length === 0) {
    return [...DEFAULT_SESSION_TYPES];
  }

  return result;
}

/**
 * Deep merge channels by name
 * - If project channel name matches global channel name, project overrides global
 * - If no name match, project channels are appended to global channels
 */
function mergeChannels(
  globalChannels: Channel[] | undefined,
  projectChannels: Channel[] | undefined
): Channel[] {
  if (!globalChannels?.length && !projectChannels?.length) {
    return [];
  }
  if (!globalChannels?.length) {
    return projectChannels ?? [];
  }
  if (!projectChannels?.length) {
    return globalChannels;
  }

  const result: Channel[] = [...globalChannels];
  
  for (const projectChannel of projectChannels) {
    const existingIndex = result.findIndex(
      (c) => c.name !== undefined && c.name === projectChannel.name
    );
    
    if (existingIndex >= 0) {
      // Override global channel with project channel (same name)
      logger.debug(`Channel '${projectChannel.name}' merged from project + global`);
      result[existingIndex] = projectChannel;
    } else {
      // Append project channel (no name match)
      result.push(projectChannel);
    }
  }
  
  return result;
}

/**
 * Filter channels to only include enabled ones
 * A channel is enabled if enabled is true or undefined (defaults to true)
 */
function filterEnabledChannels(channels: Channel[]): Channel[] {
  return channels.filter((channel) => channel.enabled !== false);
}

/**
 * Get global config file path: ~/.config/opencode/ul-opencode-event.json
 */
function getGlobalConfigPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'ul-opencode-event.json');
}

/**
 * Get project config file path
 * Priority: .opencode/ul-opencode-event.json > ./ul-opencode-event.json
 */
function getProjectConfigPath(): string | null {
  const opencodePath = path.join(process.cwd(), '.opencode', 'ul-opencode-event.json');
  if (fs.existsSync(opencodePath)) {
    return opencodePath;
  }
  
  const localPath = path.join(process.cwd(), 'ul-opencode-event.json');
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  
  return null;
}

/**
 * Currency symbol mapping
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CNY: '\u00a5',
};

const DEFAULT_EXCHANGE_RATE = 7.25;
const DEFAULT_DECIMAL_PLACES = 4;

/**
 * Resolve cost config with defaults and validation.
 * Warns on invalid values and falls back to defaults (never throws).
 */
function resolveCostConfig(
  merged: {
    currency?: string;
    exchangeRate?: number;
    decimalPlaces?: number;
    enableOnlineRate?: boolean;
  },
  language?: string,
): CostConfig {
  // 1. Resolve currency: explicit > inferred from language > USD
  let currency = merged.currency;
  if (!currency) {
    currency = language === 'zh' ? 'CNY' : 'USD';
  }
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    logger.warn(
      `Unsupported currency "${merged.currency}". Supported: ${(SUPPORTED_CURRENCIES as readonly string[]).join(', ')}. Defaulting to USD.`,
    );
    currency = 'USD';
  }

  // 2. Resolve exchangeRate
  let exchangeRate = merged.exchangeRate ?? DEFAULT_EXCHANGE_RATE;
  if (typeof exchangeRate !== 'number' || exchangeRate <= 0 || !Number.isFinite(exchangeRate)) {
    logger.warn(
      `Invalid exchangeRate "${merged.exchangeRate}". Must be a positive number. Defaulting to ${DEFAULT_EXCHANGE_RATE}.`,
    );
    exchangeRate = DEFAULT_EXCHANGE_RATE;
  }

  // 3. Resolve decimalPlaces
  let decimalPlaces = merged.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  if (
    typeof decimalPlaces !== 'number' ||
    decimalPlaces < 1 ||
    decimalPlaces > 8 ||
    !Number.isInteger(decimalPlaces)
  ) {
    logger.warn(
      `Invalid decimalPlaces "${merged.decimalPlaces}". Must be integer 1-8. Defaulting to ${DEFAULT_DECIMAL_PLACES}.`,
    );
    decimalPlaces = DEFAULT_DECIMAL_PLACES;
  }

  // 4. enableOnlineRate defaults to false
  const enableOnlineRate = merged.enableOnlineRate ?? false;

  return {
    currency: currency as CostConfig['currency'],
    exchangeRate,
    decimalPlaces,
    enableOnlineRate,
  };
}

/**
 * Load and merge notification configuration
 * 
 * Config locations (in order of priority):
 * 1. Project-level: .opencode/ul-opencode-event.json or ./ul-opencode-event.json
 * 2. Global: ~/.config/opencode/ul-opencode-event.json
 * 
 * Merge strategy:
 * - Channels are merged by `name` field
 * - If names match, project channel overrides global channel
 * - If no name match, project channels are appended to global channels
 * 
 * Filtering:
 * - Only returns channels where enabled is true (or undefined, which defaults to true)
 * - Channels with enabled: false are excluded
 * 
 * Validation:
 * - Unknown channel types are warned and filtered out (not an error)
 * 
 * @returns Merged and filtered configuration, or default config if no files exist
 */
export function loadConfig(): NotificationConfig {
  // Load global config
  const globalConfigPath = getGlobalConfigPath();
  const globalConfig = loadConfigFile(globalConfigPath);
  
  // Load project config
  const projectConfigPath = getProjectConfigPath();
  const projectConfig = projectConfigPath ? loadConfigFile(projectConfigPath) : null;
  
  // If no configs exist, return default with auto-injected file channel
  if (!globalConfig && !projectConfig) {
    logger.debug(`No config found. Checked: ${globalConfigPath}, ${path.join(process.cwd(), '.opencode', 'ul-opencode-event.json')}, ${path.join(process.cwd(), 'ul-opencode-event.json')}`);
    return {
      channels: [{
        type: 'file',
        enabled: true,
        name: 'default-file',
        config: {
          filePath: path.join(os.homedir(), '.local', 'share', 'opencode', 'ul-opencode-event-messages.log'),
          maxSizeBytes: 1048576,
        },
        events: {
          created: true,
          idle: true,
          error: true,
          question: true,
          permission: true,
          status: true,
          command: true,
          fileEdited: true,
          todo: true,
        },
      }],
    };
  }
  
  // Merge channels
  const mergedChannels = mergeChannels(
    globalConfig?.channels,
    projectConfig?.channels
  );
  
  // Filter enabled channels
  const enabledChannels = filterEnabledChannels(mergedChannels);
  
  // Validate and filter supported channel types
  const channels = validateAndFilterChannels(enabledChannels);

  // Auto-inject default file channel if not explicitly configured
  if (!channels.some(ch => ch.type === 'file')) {
    channels.push({
      type: 'file',
      enabled: true,
      name: 'default-file',
      config: {
        filePath: path.join(os.homedir(), '.local', 'share', 'opencode', 'ul-opencode-event-messages.log'),
        maxSizeBytes: 1048576,
      },
      events: {
        created: true,
        idle: true,
        error: true,
        question: true,
        permission: true,
        status: true,
        command: true,
        fileEdited: true,
        todo: true,
      },
    });
  }
  
  // Merge top-level fields (language, timezone) — project config takes priority
  const mergedLanguage = projectConfig?.language ?? globalConfig?.language;
  const mergedTimezone = projectConfig?.timezone ?? globalConfig?.timezone;
  const mergedAutoUpdate = projectConfig?.auto_update ?? globalConfig?.auto_update;

  // Merge includeSessionTypes — project overrides global
  const rawIncludeSessionTypes = projectConfig?.includeSessionTypes ?? globalConfig?.includeSessionTypes;

  // Merge cost config — project overrides global field-by-field
  const mergedCostRaw = {
    currency: projectConfig?.cost?.currency ?? globalConfig?.cost?.currency,
    exchangeRate: projectConfig?.cost?.exchangeRate ?? globalConfig?.cost?.exchangeRate,
    decimalPlaces: projectConfig?.cost?.decimalPlaces ?? globalConfig?.cost?.decimalPlaces,
    enableOnlineRate: projectConfig?.cost?.enableOnlineRate ?? globalConfig?.cost?.enableOnlineRate,
  };

  // Deprecation warning for old field
  for (const rawConfig of [globalConfig, projectConfig] as Array<typeof globalConfig>) {
    if (rawConfig && 'includeSubagentEvents' in rawConfig) {
      logger.warn(
        `"includeSubagentEvents" is deprecated. Use "includeSessionTypes" instead (e.g., ["main", "subagent"]).`
      );
    }
  }

  return {
    channels: channels,
    ...(mergedLanguage !== undefined && { language: mergedLanguage }),
    ...(mergedTimezone !== undefined && { timezone: mergedTimezone }),
    ...(mergedAutoUpdate !== undefined ? { auto_update: mergedAutoUpdate } : { auto_update: true }),
    includeSessionTypes: validateIncludeSessionTypes(rawIncludeSessionTypes),
    cost: resolveCostConfig(mergedCostRaw, mergedLanguage),
  };
}
