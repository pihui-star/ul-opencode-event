# @ulthon/ul-opencode-event

**Never miss an OpenCode notification, even when you're away from your desk.**

OpenCode multi-channel notification plugin that keeps you informed wherever you are. Get notified when tasks complete or errors occur via email, DingTalk, or Feishu.

## Why ul-opencode-event?

- **Remote Development Friendly** - Get notified when your AI coding agent finishes a task
- **Multi-Channel Support** - SMTP email, DingTalk robot, Feishu robot, with more planned
- **Real-time Alerts** - Immediate notifications on session `idle` or `error` events
- **Easy Configuration** - Simple JSON config with template variables

## Roadmap

| Channel | Status | Description |
|---------|--------|-------------|
| SMTP (Email) | Available | Email notifications via any SMTP server |
| DingTalk | Available | DingTalk robot notifications |
| Feishu | Available | Feishu robot notifications |
| Webhook | Planned | HTTP webhook for custom integrations |
| Telegram | Planned | Telegram bot notifications |
| Slack | Planned | Slack incoming webhooks |
| WeChat Work | Planned | Enterprise WeChat |

**Have a channel request?** Open an issue on our [Gitee repo](https://gitee.com/augushong/ul-opencode-event)!

## Quick Start

```bash
npm install @ulthon/ul-opencode-event
cp node_modules/@ulthon/ul-opencode-event/examples/ul-opencode-event.json ./
# Edit config with your SMTP credentials
npx @ulthon/ul-opencode-event test
```

Add to `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["@ulthon/ul-opencode-event"] }
```

## Configuration

### File Locations

1. **Project-level**: `.opencode/ul-opencode-event.json` or `./ul-opencode-event.json`
2. **Global**: `~/.config/opencode/ul-opencode-event.json`

Project-level config overrides global (channels merged by name).

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

### Events

| Event | Default | Description |
|-------|---------|-------------|
| `created` | false | When a new session starts |
| `idle` | true | When a session completes |
| `error` | true | When a session encounters an error |

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
# Or: npm link && npx @ulthon/ul-opencode-event test
```

## License

MIT
