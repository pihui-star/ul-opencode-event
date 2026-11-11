/**
 * Plugin Core Module (OpenCode v2)
 *
 * Implements the OpenCode v2 plugin contract:
 *   export default Plugin.define({ id, setup(ctx) })
 *
 * - Events: ctx.event.subscribe() replaces the v1 `event` hook
 * - Tools : ctx.tool.transform() replaces the v1 `tool` map
 * - Cleanup: the function returned by setup() is called when the plugin unloads
 *
 * Token/cost data source:
 *   OpenCode database (`session_v2`) as primary source, live server events
 *   (`session.usage.updated` / `session.step.ended`) as the fresher overlay.
 */
import { Plugin } from '@opencode/plugin';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from './config.js';
import { createEventHandler, type EventHandler } from './handler.js';
import { getDefaultTimezone } from './locales.js';
import type { EventPayload, SessionMeta, SessionCacheEntry, NotificationConfig } from './types.js';
import { DEFAULT_SESSION_TYPES } from './types.js';
import { logger, DEBUG_ENABLED } from './logger.js';
import { runAutoUpdate, getCurrentVersion } from './updater.js';
import { loadSessionCache, buildCacheEntry, writeCacheEntry, cacheToUsageRows } from './session-cache.js';
import { parseTokenFields } from './utils/token-parse.js';
import { fillTokenData } from './token-aggregator.js';
import { eventToPayload, type V2Event } from './event-mapper.js';
import {
  readProjectUsage,
  readSessionDirectory,
  mergeLiveUsage,
  aggregateUsage,
  createLiveUsage,
  type LiveUsage,
} from './usage.js';

/** Stable plugin id - also used as the plugin storage scope. */
export const PLUGIN_ID = 'ul-opencode-event';

/** Server events the plugin subscribes to. */
const SUBSCRIBED_EVENT_TYPES = [
  'session.created',
  'session.idle',
  'session.execution.failed',
  'session.status',
  'session.usage.updated',
  'session.step.ended',
  'session.model.selected',
  'session.agent.selected',
  'session.renamed',
  'permission.asked',
  'form.created',
  'session.shell.ended',
  'filesystem.changed',
] as const;

/** Events that trigger a notification. */
const NOTIFICATION_EVENT_TYPES = new Set<string>([
  'session.created',
  'session.idle',
  'session.execution.failed',
  'session.status',
  'permission.asked',
  'form.created',
  'session.shell.ended',
  'filesystem.changed',
]);

/**
 * Events already processed by one of the plugin instances.
 *
 * OpenCode instantiates a plugin once per location and every instance
 * receives the whole event stream, so a notification would be sent once per
 * instance. Claiming the event id keeps it to exactly one notification.
 */
const claimedEventIds = new Set<string>();
const CLAIMED_EVENT_LIMIT = 1000;

/**
 * Claim an event for processing. Returns false when another instance
 * already handled it.
 */
function claimEvent(event: V2Event): boolean {
  const id = (event as unknown as { id?: string }).id;
  if (!id) return true;
  if (claimedEventIds.has(id)) return false;
  claimedEventIds.add(id);
  if (claimedEventIds.size > CLAIMED_EVENT_LIMIT) {
    const oldest = claimedEventIds.values().next().value;
    if (oldest) claimedEventIds.delete(oldest);
  }
  return true;
}

/** Directory holding the cross-process event claim markers. */
const CLAIM_DIR_NAME = 'ul-opencode-event-claims';
/** Marker files older than this are removed. */
const CLAIM_TTL_MS = 60 * 60 * 1000;
let lastClaimPrune = 0;

/**
 * Claim an event across processes.
 *
 * OpenCode may run one server process per location, so in-memory state cannot
 * guarantee "exactly once". A marker file created with exclusive access can.
 * Used as a backstop for events that carry no location information.
 */
async function claimEventOnDisk(eventId: string, baseDir: string): Promise<boolean> {
  try {
    const fs = (await import('node:fs')).default ?? (await import('node:fs'));
    const dir = path.join(baseDir, CLAIM_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, eventId.replace(/[^a-zA-Z0-9._-]/g, '_'));
    const fd = fs.openSync(file, 'wx');
    fs.closeSync(fd);

    // Prune expired markers from time to time
    const now = Date.now();
    if (now - lastClaimPrune > 60_000) {
      lastClaimPrune = now;
      try {
        for (const name of fs.readdirSync(dir)) {
          const marker = path.join(dir, name);
          try {
            if (now - fs.statSync(marker).mtimeMs > CLAIM_TTL_MS) {
              fs.rmSync(marker, { force: true });
            }
          } catch {
            // ignore individual failures
          }
        }
      } catch {
        // ignore pruning failures
      }
    }
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') return false;
    // Fail open - the claim mechanism must never block a notification
    return true;
  }
}

/**
 * Normalize a directory for comparison (case-insensitive on Windows).
 */
function normalizeDir(dir: string): string {
  const normalized = path.normalize(dir);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Minimal shape of the v2 Session.Info we rely on. */
interface SessionInfoLike {
  id: string;
  title?: string;
  parentID?: string;
  agent?: string;
  model?: { id?: string; providerID?: string };
  time?: { created?: number | string };
  location?: { directory?: string };
}

function toSessionMeta(info: SessionInfoLike): SessionMeta {
  const meta: SessionMeta = {
    id: info.id,
    title: info.title,
    parentID: info.parentID,
    directory: info.location?.directory,
    modelID: info.model?.id,
    providerID: info.model?.providerID,
    mode: info.agent,
  };
  const created = info.time?.created;
  if (typeof created === 'number') {
    meta.createdAt = created;
  } else if (typeof created === 'string') {
    const parsed = Date.parse(created);
    if (!Number.isNaN(parsed)) meta.createdAt = parsed;
  }
  return meta;
}

/**
 * Plugin setup - called by OpenCode when the plugin is loaded.
 */
export async function setupPlugin(ctx: Plugin.Context): Promise<(() => void) | void> {
  let config: NotificationConfig;
  try {
    config = loadConfig();
  } catch (error) {
    logger.error(`Failed to initialize plugin config: ${error}`);
    logger.error('ul-opencode-event Config Error: 配置加载失败, 详见日志: ~/.local/share/opencode/ul-opencode-event.log');
    runAutoUpdate(ctx, true).catch((err: unknown) => {
      logger.error(`Auto-update check failed: ${err}`);
    });
    return;
  }

  if (config.channels.length === 0) {
    logger.warn('Plugin loaded but no enabled channels found');
    return;
  }

  const { resolveCostConfig, formatCost } = await import('./cost.js');
  const eventHandler: EventHandler = createEventHandler(config);

  const directory = ctx.location.directory;
  const baseDir = process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode');
  const timezone = config.timezone ?? getDefaultTimezone(config.language);
  const allowedSessionTypes = config.includeSessionTypes ?? DEFAULT_SESSION_TYPES;

  const sessionMap = new Map<string, SessionMeta>();
  const sessionDirectories = new Map<string, string>();
  const liveUsage = new Map<string, LiveUsage>();
  let sessionCache: Map<string, SessionCacheEntry> = loadSessionCache(baseDir);

  logger.info(
    `[ul-opencode-event] Plugin loaded v${getCurrentVersion() ?? 'unknown'} for ${directory} ` +
      `with ${config.channels.length} channel(s)`,
  );

  // ------------------------------------------------------------------
  // Session metadata tracking
  // ------------------------------------------------------------------

  const trackSession = (sessionID: string, patch: Partial<SessionMeta>): void => {
    if (!sessionID) return;
    const current = sessionMap.get(sessionID) ?? { id: sessionID };
    sessionMap.set(sessionID, { ...current, ...patch });
  };

  /** Fetch session metadata from the server when it was not seen live. */
  const ensureSessionMeta = async (sessionID: string): Promise<SessionMeta | undefined> => {
    if (!sessionID) return undefined;
    const cached = sessionMap.get(sessionID);
    if (cached) return cached;
    try {
      const info = (await ctx.session.get({ sessionID })) as unknown as SessionInfoLike;
      const meta = toSessionMeta(info);
      sessionMap.set(sessionID, meta);
      if (meta.directory) sessionDirectories.set(sessionID, meta.directory);
      return meta;
    } catch (err) {
      if (DEBUG_ENABLED) {
        logger.debug(`[ul-opencode-event] Could not load session ${sessionID}: ${err}`);
      }
      return undefined;
    }
  };

  // ------------------------------------------------------------------
  // Live usage tracking
  // ------------------------------------------------------------------

  const updateLiveUsage = (sessionID: string, patch: (usage: LiveUsage) => void): void => {
    if (!sessionID) return;
    const usage = liveUsage.get(sessionID) ?? createLiveUsage();
    patch(usage);
    liveUsage.set(sessionID, usage);
  };

  /**
   * Build the session / total / project usage snapshot.
   * Database first, live events as overlay, JSONL cache as last resort.
   */
  const collectUsage = async (projectDir: string, sessionID: string) => {
    let rows = await readProjectUsage(baseDir, projectDir);
    if (rows.size === 0 && sessionCache.size > 0) {
      rows = cacheToUsageRows(sessionCache, projectDir);
    }
    mergeLiveUsage(rows, pickProjectLiveUsage(projectDir));
    return aggregateUsage(rows, sessionID);
  };

  /**
   * Live usage of the sessions that belong to the given project.
   * Sessions of other projects must not leak into the project totals.
   */
  const pickProjectLiveUsage = (projectDir: string): Map<string, LiveUsage> => {
    const target = normalizeDir(projectDir);
    const picked = new Map<string, LiveUsage>();
    for (const [sessionID, usage] of liveUsage) {
      const known = sessionDirectories.get(sessionID);
      if (known && normalizeDir(known) !== target) continue;
      picked.set(sessionID, usage);
    }
    return picked;
  };

  // ------------------------------------------------------------------
  // Notification pipeline
  // ------------------------------------------------------------------

  const notify = async (event: V2Event, eventLocation?: string): Promise<void> => {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const rawSessionID = typeof data.sessionID === 'string' ? data.sessionID : '';
    const eventId = (event as unknown as { id?: string }).id;
    const sessionInfo = await ensureSessionMeta(rawSessionID);

    // Resolve the project the event belongs to. OpenCode creates one plugin
    // instance per location and every instance sees the whole event stream -
    // the instance owning the location is the one that notifies.
    const knownDirectory =
      eventLocation ??
      sessionDirectories.get(rawSessionID) ??
      (await ensureSessionMeta(rawSessionID))?.directory ??
      (await readSessionDirectory(baseDir, rawSessionID));
    const projectDir = knownDirectory ?? directory;

    if (knownDirectory && normalizeDir(knownDirectory) !== normalizeDir(directory)) {
      logger.info(
        `[ul-opencode-event] Skipping event of another location (${knownDirectory} != ${directory})`,
      );
      return;
    }

    if (!knownDirectory) {
      // The event carries no location - make sure only one instance notifies.
      if (eventId) {
        if (!claimEvent(event)) return;
        if (!(await claimEventOnDisk(eventId, baseDir))) return;
      }
    }

    const projectName = config.projectName || path.basename(projectDir) || 'unknown-project';

    const payload: EventPayload | null = eventToPayload(event, projectName, sessionInfo, timezone, projectDir);
    if (!payload) return;

    const usage = await collectUsage(projectDir, payload.sessionId);
    fillTokenData(
      payload,
      usage.session,
      usage.total,
      usage.project,
      config.language,
      config.cost,
      resolveCostConfig,
      formatCost,
    );

    // Model / provider / mode come from the session metadata
    if (sessionInfo?.modelID) payload.modelID = sessionInfo.modelID;
    if (sessionInfo?.providerID) payload.providerID = sessionInfo.providerID;
    if (sessionInfo?.mode) payload.mode = sessionInfo.mode;

    // Filter by session type whitelist (default: only 'main' sessions)
    if (!allowedSessionTypes.includes(payload.sessionType)) {
      if (DEBUG_ENABLED) {
        logger.debug(`Skipping ${payload.sessionType} event ${payload.eventType} for session ${payload.sessionId}`);
      }
      return;
    }

    if (DEBUG_ENABLED) {
      logger.debug(`Handling event ${payload.eventType} for session ${payload.sessionId}`);
    }

    try {
      await eventHandler.handle(payload.eventType, payload);
    } catch (error) {
      logger.error(`Failed to handle event ${payload.eventType}: ${error}`);
    }

    // Persist the session aggregate so project totals survive a restart
    if (payload.eventType === 'idle' || payload.eventType === 'error') {
      const entry = buildCacheEntry(payload.sessionId, {
        cost: usage.session.cost,
        tokens: usage.session.tokens,
        requestCount: usage.session.requestCount,
        projectPath: projectDir,
        modelID: payload.modelID,
        providerID: payload.providerID,
        mode: payload.mode,
      });
      if (entry) {
        writeCacheEntry(baseDir, entry);
        sessionCache.set(entry.sessionId, entry);
      }
    }
  };

  // ------------------------------------------------------------------
  // Event dispatch
  // ------------------------------------------------------------------

  const handleEvent = async (event: V2Event): Promise<void> => {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const sessionID = typeof data.sessionID === 'string' ? data.sessionID : '';
    const eventLocation = (event as unknown as { location?: { directory?: string } }).location?.directory;
    const eventId = (event as unknown as { id?: string }).id;
    logger.info(
      `[EVENT] type=${event.type}` +
        (sessionID ? ` sessionID=${sessionID}` : '') +
        ` id=${eventId ?? '-'}` +
        ` loc=${eventLocation ?? '-'}`,
    );

    switch (event.type) {
      case 'session.created': {
        const created = data as {
          sessionID?: string;
          title?: string;
          parentID?: string;
          location?: { directory?: string };
        };
        const sessionDirectory = created.location?.directory;
        if (sessionDirectory) {
          sessionDirectories.set(created.sessionID ?? sessionID, sessionDirectory);
        }
        trackSession(created.sessionID ?? sessionID, {
          title: created.title,
          parentID: created.parentID,
          directory: sessionDirectory,
          createdAt: Date.now(),
        });
        break;
      }
      case 'session.renamed': {
        const renamed = data as { sessionID?: string; title?: string };
        trackSession(renamed.sessionID ?? sessionID, { title: renamed.title });
        break;
      }
      case 'session.model.selected': {
        const selected = data as { sessionID?: string; model?: { id?: string; providerID?: string } };
        trackSession(selected.sessionID ?? sessionID, {
          modelID: selected.model?.id,
          providerID: selected.model?.providerID,
        });
        break;
      }
      case 'session.agent.selected': {
        const selected = data as { sessionID?: string; agent?: string };
        trackSession(selected.sessionID ?? sessionID, { mode: selected.agent });
        break;
      }
      case 'session.usage.updated': {
        const usage = data as { sessionID?: string; cost?: number; tokens?: Parameters<typeof parseTokenFields>[0] };
        const tokens = parseTokenFields(usage.tokens);
        const cost = Number(usage.cost) || 0;
        updateLiveUsage(usage.sessionID ?? sessionID, (u) => {
          u.absolute = { cost, tokens };
        });
        break;
      }
      case 'session.step.ended': {
        const step = data as {
          sessionID?: string;
          assistantMessageID?: string;
          cost?: number;
          tokens?: Parameters<typeof parseTokenFields>[0];
        };
        const tokens = parseTokenFields(step.tokens);
        const cost = Number(step.cost) || 0;
        updateLiveUsage(step.sessionID ?? sessionID, (u) => {
          u.stepCost += cost;
          u.stepTokens.input += tokens.input;
          u.stepTokens.output += tokens.output;
          u.stepTokens.reasoning += tokens.reasoning;
          u.stepTokens.cacheRead += tokens.cacheRead;
          u.stepTokens.cacheWrite += tokens.cacheWrite;
          u.stepTokens.total += tokens.total;
          u.stepCount += 1;
        });
        break;
      }
      default:
        break;
    }

    if (NOTIFICATION_EVENT_TYPES.has(event.type)) {
      await notify(event, eventLocation);
    }
  };

  // ------------------------------------------------------------------
  // Tool registration (ul-token-rebuild)
  // ------------------------------------------------------------------

  try {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: 'ul-token-rebuild',
        description:
          '从 OpenCode 数据库重建会话 token 缓存。扫描本项目的历史会话，把缺失的会话聚合数据写入缓存文件。' +
          '用于首次安装、缓存丢失后恢复、或定期刷新项目级 token 聚合准确度。',
        input: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          try {
            const { syncFromDB } = await import('./session-cache.js');
            const result = await syncFromDB(baseDir, directory, sessionCache);
            sessionCache = loadSessionCache(baseDir);
            return {
              content:
                `Token cache rebuild complete.\n` +
                `- New sessions synced: ${result.newSessions}\n` +
                `- Total cached sessions: ${result.totalSessions}\n` +
                `- Total tokens: input=${result.totalTokens.input}, output=${result.totalTokens.output}, ` +
                `cacheRead=${result.totalTokens.cacheRead}, cacheWrite=${result.totalTokens.cacheWrite}`,
            };
          } catch (err) {
            return { content: `Token cache rebuild failed: ${err}` };
          }
        },
      });
    });
  } catch (err) {
    logger.error(`Failed to register ul-token-rebuild tool: ${err}`);
  }

  // ------------------------------------------------------------------
  // Slash command registration
  // ------------------------------------------------------------------

  try {
    const commandDir = path.join(os.homedir(), '.config', 'opencode', 'command');
    const commandFile = path.join(commandDir, 'ul-token-rebuild.md');
    // Use dynamic import for fs (async context, non-hot path)
    const cmdFs = (await import('node:fs')).default || (await import('node:fs'));
    if (!cmdFs.existsSync(commandFile)) {
      cmdFs.mkdirSync(commandDir, { recursive: true });
      cmdFs.writeFileSync(
        commandFile,
        [
          '---',
          'description: 从数据库重建 token 缓存，提升项目级聚合准确度',
          '---',
          '直接调用 ul-token-rebuild 工具，不要委派给其他 agent。执行后向用户报告同步结果。',
          '',
        ].join('\n'),
        'utf-8',
      );
    }
  } catch (cmdErr) {
    // Non-critical: command registration failure should not block plugin
    logger.warn(`Failed to register slash command: ${cmdErr}`);
  }

  // ------------------------------------------------------------------
  // Idle hook (OpenCode v2 replacement for the v1 `session.idle` event)
  // ------------------------------------------------------------------

  try {
    await ctx.session.hook('experimental.idle', async (event) => {
      logger.info(`[EVENT] type=session.idle (hook) sessionID=${event.sessionID}`);
      await notify({ type: 'session.idle', data: { sessionID: event.sessionID } });
    });
  } catch (err) {
    logger.error(`Failed to register session idle hook: ${err}`);
  }

  // ------------------------------------------------------------------
  // Event subscription
  // ------------------------------------------------------------------

  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({
        types: [...SUBSCRIBED_EVENT_TYPES],
        signal: controller.signal,
      })) {
        await handleEvent(event as unknown as V2Event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        logger.error(`Event subscription failed: ${err}`);
      }
    }
  })();

  // ------------------------------------------------------------------
  // Auto update check (once per process)
  // ------------------------------------------------------------------

  if (config.auto_update !== false) {
    setTimeout(() => {
      runAutoUpdate(ctx, true).catch((err: unknown) => {
        logger.error(`Auto-update check failed: ${err}`);
      });
    }, 0);
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  return () => {
    controller.abort();
    eventHandler.close().catch((err: unknown) => {
      logger.error(`Failed to close channels: ${err}`);
    });
  };
}

/**
 * V2 plugin definition - the default export consumed by OpenCode.
 */
export default Plugin.define({
  id: PLUGIN_ID,
  setup: setupPlugin,
});
