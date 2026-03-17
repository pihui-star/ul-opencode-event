# @ulthon/ul-opencode-event

OpenCode notification plugin that sends email notifications when session events occur.

## Installation

```bash
npm install @ulthon/ul-opencode-event
```

Then add to your OpenCode configuration:

```json
{
  "plugin": ["@ulthon/ul-opencode-event"]
}
```

## Configuration

### Configuration File Locations

The plugin looks for configuration in these locations (in order of priority):

1. **Project-level**: `.opencode/notification.json` or `./notification.json`
2. **Global**: `~/.config/opencode/notification.json`

Project-level configuration overrides global configuration (channels are merged by name).

### Configuration Format

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "My Email",
      "config": {
        "host": "smtp.example.com",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "your-email@example.com",
          "pass": "your-app-password"
        }
      },
      "recipients": ["receiver@example.com"],
      "events": {
        "created": true,
        "idle": true,
        "error": true
      },
      "templates": {
        "created": {
          "subject": "[OpenCode] Task Started - {{projectName}}",
          "body": "Task started at {{timestamp}}"
        }
      }
    }
  ]
}
```

See `examples/notification.json` for a complete example.

### Channel Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Channel type: `smtp` (more coming soon) |
| `enabled` | boolean | No | Whether this channel is active (default: true) |
| `name` | string | No | Channel name for identification |
| `config` | object | Yes | Channel-specific configuration |
| `recipients` | string[] | Yes* | Email recipients (*required for smtp*) |
| `events` | object | No | Which events to notify |
| `templates` | object | No | Custom templates for each event |

### SMTP Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | Yes | SMTP server hostname |
| `port` | number | Yes | SMTP port (465 for SSL, 587 for STARTTLS) |
| `secure` | boolean | No | Use SSL (default: true for port 465) |
| `auth.user` | string | Yes | SMTP username |
| `auth.pass` | string | Yes | SMTP password or app password |

## Template Variables

Use these variables in your subject and body templates:

| Variable | Description | Available Events |
|----------|-------------|------------------|
| `{{eventType}}` | Event type (created, idle, error) | All |
| `{{timestamp}}` | ISO 8601 timestamp | All |
| `{{projectName}}` | Project name | All |
| `{{sessionId}}` | Session ID | All |
| `{{message}}` | Completion message | idle |
| `{{duration}}` | Task duration | idle |
| `{{error}}` | Error message | error |

## Events

| Event | When it triggers |
|-------|------------------|
| `created` | When a new session starts |
| `idle` | When a session completes (AI finishes responding) |
| `error` | When a session encounters an error |

## Multiple Channels

You can configure multiple channels, and all enabled channels will receive notifications:

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "Primary Email",
      "config": { "host": "smtp.primary.com", ... },
      "recipients": ["primary@example.com"],
      "events": { "created": true, "idle": true, "error": true }
    },
    {
      "type": "smtp",
      "enabled": true,
      "name": "Secondary Email",
      "config": { "host": "smtp.secondary.com", ... },
      "recipients": ["secondary@example.com"],
      "events": { "idle": true, "error": true }
    }
  ]
}
```

## Troubleshooting

### No notifications sent

1. Check if `enabled: true` is set
2. Check if the event type is enabled in `events`
3. Check SMTP credentials are correct

### SMTP authentication failed

- For Gmail, use an App Password instead of your regular password
- For QQ Mail, use the authorization code
- Ensure `secure` matches your port (465 = true, 587 = false)

## License

MIT
