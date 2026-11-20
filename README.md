# @ulthon/ul-opencode-event

**Never miss an OpenCode notification — and always know your token spend.**

OpenCode multi-channel notification and usage analytics plugin. Get notified when tasks complete or errors occur via email, DingTalk, or Feishu — with multi-level token and request tracking built into every alert.

> [!IMPORTANT]
> **Maintenance notice**
>
> The original author ([@ulthon](https://github.com/ulthon)) **no longer maintains this project**.
> This repository is maintained by [@pihuiarch](https://github.com/pihuiarch) and hosted under the
> `pihui-star` organisation. It is the single source of truth for releases, issue tracking and fixes.
>
> - Releases & issues → [github.com/pihui-star/ul-opencode-event](https://github.com/pihui-star/ul-opencode-event)
> - Original repository (read-only, archived) → [gitee.com/ulthon/ul-opencode-event](https://gitee.com/ulthon/ul-opencode-event)
>
> Install from this repository — the npm package `@ulthon/ul-opencode-event` is still published by
> the original author and does **not** contain the OpenCode 2.x support described below.

## Why this plugin is part of the daily workflow

An AI coding session is not a 10-second action. A refactor across 20 files, a flaky CI run, a migration with hundreds of generated edits — you kick the task off, switch to another window, and come back minutes later to find out whether it **finished, failed, or is still waiting for your answer**. Meanwhile the terminal only shows the last line of a long stream, and the token counter is either hidden or buried in the TUI.

That is the daily friction this plugin removes:

- **You leave the terminal, the terminal tells you.** Task finished, task failed, the agent is asking a question, a permission prompt is waiting — each one arrives in Feishu / DingTalk / email, not in a window you already closed.
- **You stop guessing what a task cost.** Every alert carries the session's tokens, cache hit rate, request count and estimated cost, at session / total / project level.
- **You keep a record.** Notifications are mirrored into a local JSONL file, so the day's activity is greppable with `jq` instead of living only in scrollback.

It is not a demo or a toy channel: it is the piece that makes unattended / long-running OpenCode work usable on a normal workday.

## Why the OpenCode v1 → v2 adaptation was needed

OpenCode 2 rewrote the plugin API. The 1.x plugin contract no longer runs, and the failure mode is **silent** — the loader drops the plugin, the console prints nothing useful, and you simply stop receiving notifications:

```
failed to load plugin target=@ulthon/ul-opencode-event
  cause="Cannot find package '@opencode-ai/plugin' ..."
```

| What changed in OpenCode 2 | Impact on a 1.x plugin |
|---|---|
| Plugin entry point | `export default function` → `Plugin.define({ id, setup })` |
| SDK package | `@opencode-ai/plugin` → `@opencode/plugin` (and it must be a **runtime** dependency, or the installed copy cannot resolve it) |
| Event stream | `event` hook → `ctx.event.subscribe()` |
| Task finished | `session.idle` event → `ctx.session.hook('experimental.idle')` (v2 publishes no idle event) |
| Event payload | `event.properties` → `event.data` |
| Custom tools | `tool()` + zod → `ctx.tool.transform()` with JSON Schema |
| Session errors | `session.error` → `session.execution.failed` |
| Config key | `plugin` → `plugins` |

This plugin was ported to the v2 API — and, because a v2-only package would drop every 1.x user, a **v1 compatibility layer was added on top of the same codebase**. One package, two entry points:

```ts
export default {
  ...Plugin.define({ id: PLUGIN_ID, setup: setupPlugin }),  // OpenCode 2.x
  server: createV1Plugin,                                  // OpenCode 1.x
}
```

Both paths share the same channel stack, templates, formatters and event mapping, so a notification looks and behaves identically on either version. Details: [OpenCode 1.x / 2.x compatibility](docs/opencode-v1-v2-compat.md) · [v2 migration notes](docs/opencode-v2-migration.md)

## Why ul-opencode-event?

- **Multi-Channel Notifications** - SMTP email, DingTalk robot, Feishu robot, with more planned
- **Token Usage Analytics** - Tracks token consumption and API requests at message / session / total / project levels
- **Remote Development Friendly** - Get notified when your AI coding agent finishes a task or hits an error
- **Real-time Alerts** - Immediate notifications on session `idle`, `error`, `question`, `permission`, and more
- **One Package, Both OpenCode Versions** - v2 plugin API with a v1 fallback, no version-locked installs
- **Rich Template Variables** - 74+ variables including token stats, cache hit rates, and system info, with i18n (zh/en)
- **Easy Configuration** - Simple JSON config with global + project-level merge

## Roadmap

| Channel | Status | Description |
|---------|--------|-------------|
| SMTP (Email) | Available | Email notifications via any SMTP server |
| DingTalk | Available | DingTalk robot notifications |
| Feishu | Available | Feishu robot notifications |
| File | Available (auto) | Local JSONL file, auto-injected by default |
| Webhook | Planned | HTTP webhook for custom integrations |
| Telegram | Planned | Telegram bot notifications |
| Slack | Planned | Slack incoming webhooks |
| WeChat Work | Planned | Enterprise WeChat |

**Have a channel request?** Open an issue on the [GitHub repo](https://github.com/pihui-star/ul-opencode-event) (or the [Gitee mirror](https://gitee.com/ulthon/ul-opencode-event))!

## Token Usage Analytics

Every notification includes detailed usage data — no extra setup required.

| Metric | Scope | Example Variable |
|--------|-------|-----------------|
| Token count | Session / Total / Project | `{{sessionTokens}}`, `{{totalTokens}}`, `{{projectTokens}}` |
| Cache hit rate | Session / Total / Project | `{{sessionCacheHitRate}}`, `{{totalCacheHitRate}}`, `{{projectCacheHitRate}}` |
| API requests | Session / Total / Project | `{{sessionRequestCount}}`, `{{totalRequestCount}}`, `{{projectRequestCount}}` |
| Model name | Per message | `{{modelName}}` |
| Cost estimate | Per session | `{{sessionCost}}`, `{{totalCost}}` |

Data persists across plugin restarts: usage is read from the OpenCode database (`opencode.db`) and mirrored into a JSONL session cache.

> Full variable list (74+ variables): see [Template Variables](docs/configuration.md#8-模板变量)

## Requirements

Works with **OpenCode 1.x (>= 1.18.29) and 2.x** from a single package:

| OpenCode | Entry point used | Config key |
|----------|------------------|------------|
| 2.x | `Plugin.define({ id, setup })` | `plugins` |
| 1.x | `{ id, server }` | `plugin` |

## Installation

### npm (recommended)

```bash
opencode plugin add @ulthon/ul-opencode-event
```

OpenCode installs and updates the plugin itself. Then configure it:

```json
// OpenCode 2.x
{ "plugins": ["@ulthon/ul-opencode-event"] }
// OpenCode 1.x
{ "plugin": ["@ulthon/ul-opencode-event"] }
```

### GitHub

```bash
opencode plugin add github:pihui-star/ul-opencode-event
```

The plugin is cloned and built automatically (`prepare` script), then referenced by the
same config keys as above:

```json
// OpenCode 2.x
{ "plugins": ["github:pihui-star/ul-opencode-event"] }
```

### From a local checkout

```bash
git clone https://github.com/pihui-star/ul-opencode-event
cd ul-opencode-event && npm install && npm run build
```

```json
// OpenCode 2.x
{ "plugins": ["file:///absolute/path/to/ul-opencode-event"] }
```

### Release tarball (offline / air-gapped)

```bash
npm install -g https://github.com/pihui-star/ul-opencode-event/releases/download/v0.3.0/ulthon-ul-opencode-event-0.3.0.tgz
```

## Quick Start

Create a config file and test the channels:

```bash
# Create config: ~/.config/opencode/ul-opencode-event.json
# Edit with your SMTP/DingTalk/Feishu credentials
npx @ulthon/ul-opencode-event test
```

## Configuration

### File Locations

1. **Project-level**: `.opencode/ul-opencode-event.json` or `./ul-opencode-event.json`
2. **Global**: `~/.config/opencode/ul-opencode-event.json`

Project-level config overrides global (channels merged by name). Custom variables can be added via the top-level `customVariables` field, see [Configuration](docs/configuration.md#13-顶层配置字段) for details.

### Minimal SMTP Example

```json
{
  "channels": [{
    "type": "smtp",
    "enabled": true,
    "name": "My Email",
    "config": {
      "host": "smtp.qq.com",
      "port": 465,
      "secure": true,
      "auth": { "user": "your-email@example.com", "pass": "your-app-password" }
    },
    "recipients": ["receiver@example.com"],
    "events": { "idle": true, "error": true }
  }]
}
```

### Common SMTP Servers

| Provider | Host | Port | Auth |
|----------|------|------|------|
| QQ Mail | smtp.qq.com | 465 | Authorization code |
| 163 Mail | smtp.163.com | 465 | Authorization code |
| Gmail | smtp.gmail.com | 587 | App Password |
| Outlook | smtp.office365.com | 587 | Password |

> For QQ/163 use the authorization code, not login password. For Gmail use an App Password with 2FA.

### Other Channels

- **DingTalk**: See [docs/channels/dingtalk-channel.md](docs/channels/dingtalk-channel.md) for robot setup, @mentions, and FAQ.
- **Feishu**: See [docs/channels/feishu-channel.md](docs/channels/feishu-channel.md) for robot setup, card format, and FAQ.
- **File**: See [docs/channels/file-channel.md](docs/channels/file-channel.md) for JSONL output, auto-injection, and rotation.

### Events

| Event | Default | Description |
|-------|---------|-------------|
| `created` | false | When a new session starts |
| `idle` | true | When a session completes |
| `error` | true | When a session encounters an error |
| `question` | true | When AI asks a question |
| `permission` | true | When permission confirmation is needed |
| `status` | false | When session status changes |
| `command` | false | When a command is executed |
| `fileEdited` | false | When a file is edited |
| `todo` | false | When the todo list is updated |

### Template Variables

| Variable | Description | Events |
|----------|-------------|--------|
| `{{eventType}}` | Event type (created, idle, error) | All |
| `{{timestamp}}` | ISO 8601 timestamp | All |
| `{{projectName}}` | Project short name | All |
| `{{projectPath}}` | Project full path | All |
| `{{sessionId}}` | Session ID | All |
| `{{message}}` | Completion message | idle |
| `{{duration}}` | Task duration | idle |
| `{{error}}` | Error message | error |
| `{{hostname}}` | Machine hostname | All |
| `{{localIP}}` | Local IP address | All |
| `{{pluginVersion}}` | Plugin version | All |
| `{{osPlatform}}` | OS platform (win32, darwin, linux) | All |
| `{{sessionCacheHitRate}}` | Current session cache hit rate | All |
| `{{totalCacheHitRate}}` | Session + sub-sessions cache hit rate | All |
| `{{projectCacheHitRate}}` | Project-wide cache hit rate | All |
| `{{sessionRequestCount}}` | Current session API request count | All |
| `{{totalRequestCount}}` | Total API requests (including sub-sessions) | All |
| `{{projectRequestCount}}` | Project-wide API request count | All |

> Full variable list (74+ variables) including system info and custom variables: see [Configuration - Template Variables](docs/configuration.md#8-模板变量)

See [Configuration - Templates](docs/configuration.md#4-模板系统概述) for customization details.

## CLI Tool

```bash
npx @ulthon/ul-opencode-event test              # Test all channels
npx @ulthon/ul-opencode-event test --channel "My Email"  # Test specific channel
npx @ulthon/ul-opencode-event test --no-send     # Verify connection only
```

## Documentation

### Configuration & Usage

| Document | Description |
|----------|-------------|
| [Configuration](docs/configuration.md) | Config file locations, merge rules, events |
| [SMTP Channel](docs/channels/smtp-channel.md) | Email configuration, IPv4/IPv6, FAQ |
| [DingTalk Channel](docs/channels/dingtalk-channel.md) | Configuration, @mentions, FAQ |
| [Feishu Channel](docs/channels/feishu-channel.md) | Configuration, card format, FAQ |
| [File Channel](docs/channels/file-channel.md) | JSONL output, auto-injection, rotation |
| [Template Configuration](docs/configuration.md#4-模板系统概述) | Template variables and customization |
| [Channel Development](docs/channels/channel-development.md) | Developing new notification channels |

### Architecture

| Document | Description |
|----------|-------------|
| [Event Data Flow](docs/architecture/event-data-flow.md) | Event processing pipeline, token data flow |

### Known Issues

| Document | Description |
|----------|-------------|
| [Token Zero on Mid-Event](docs/issues/token-zero-on-mid-event.md) | question/status events show Token(0/...) (fixed in v0.1.45) |

## Troubleshooting

- **Wrong password**: Use authorization code for QQ/163, App Password for Gmail
- **Wrong port**: Use 465 for SSL, 587 for STARTTLS
- **No notifications**: Check `enabled: true`, event types, and config file location
- **IPv4/IPv6**: Both supported; if IPv6 unstable, set `localAddress` to `"0.0.0.0"`
- **Token shows 0**: Known issue on mid-event notifications (question/status), see [Token Zero on Mid-Event](docs/issues/token-zero-on-mid-event.md)
- **Debug mode**: `UL_OPENCODE_EVENT_DEBUG=1 npx @ulthon/ul-opencode-event test`

## Local Development

```bash
npm run build && node dist/cli.js test
```

## License

MIT
