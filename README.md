# @ulthon/ul-opencode-event

**Never miss an OpenCode notification, even when you're away from your desk.**

OpenCode multi-channel notification plugin that keeps you informed wherever you are. Perfect for remote development - get notified when tasks complete or errors occur, even if you're not at your terminal.

## Why ul-opencode-event?

- 🌍 **Remote Development Friendly** - Desktop notifications don't work when you're away. Our plugin sends notifications to your email (and more channels coming soon), so you'll always know when your AI coding agent finishes a task.
- 📬 **Multi-Channel Support** - Currently supports SMTP email, with more notification channels planned (webhook, Telegram, Slack, etc.)
- ⚡ **Real-time Alerts** - Get notified immediately when sessions complete (`idle`) or encounter errors (`error`)
- 🔧 **Easy Configuration** - Simple JSON config with channel-level customization

## Roadmap

| Channel | Status | Description |
|---------|--------|-------------|
| ✅ SMTP (Email) | Available | Email notifications via any SMTP server |
| 🔜 Webhook | Planned | HTTP webhook for custom integrations |
| 🔜 Telegram | Planned | Telegram bot notifications |
| 🔜 Slack | Planned | Slack incoming webhooks |
| 🔜 DingTalk | Planned | 钉钉机器人 |
| 🔜 WeChat Work | Planned | 企业微信 |

**Have a channel request?** Open an issue on our [Gitee repo](https://gitee.com/augushong/ul-opencode-event)!

## Quick Start

```bash
# 1. 安装
npm install @ulthon/ul-opencode-event

# 2. 创建配置文件（项目根目录）
cp node_modules/@ulthon/ul-opencode-event/examples/ul-opencode-event.json ./

# 3. 编辑配置，填入你的 SMTP 信息

# 4. 测试连接
npx @ulthon/ul-opencode-event test

# 5. 添加到 OpenCode 配置
# 在 .opencode/settings.json 中添加:
# { "plugin": ["@ulthon/ul-opencode-event"] }
```
## Installation
```bash
npm install @ulthon/ul-opencode-event
```
Then add to your OpenCode configuration (`.opencode/settings.json`):
```json
{
  "plugin": ["@ulthon/ul-opencode-event"]
}
```
## Configuration
### Configuration File Locations
The plugin looks for configuration in these locations (in order of priority):
1. **Project-level**: `.opencode/ul-opencode-event.json` or `./ul-opencode-event.json`
2. **Global**: `~/.config/opencode/ul-opencode-event.json`
Project-level configuration overrides global configuration (channels are merged by name).
### Minimal Configuration
Create `ul-opencode-event.json` in your project root:
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
        "idle": true,
        "error": true
      }
    }
  ]
}
```
### Common SMTP Servers
| Provider | Host | Port | Secure | Auth |
|----------|------|------|--------|------|
| QQ Mail | smtp.qq.com | 465 | true | Authorization code |
| 163 Mail | smtp.163.com | 465 | true | Authorization code |
| Gmail | smtp.gmail.com | 587 | false | App Password |
| Outlook | smtp.office365.com | 587 | false | Password |
> **Note**: For QQ/163 Mail, use the authorization code (授权码), not your login password.
> For Gmail, use an App Password with 2FA enabled.
### Full Configuration Example
```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "QQ邮箱",
      "config": {
        "host": "smtp.qq.com",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "your@qq.com",
          "pass": "your-authorization-code"
        }
      },
      "recipients": ["admin@example.com", "dev-team@example.com"],
      "events": {
        "created": false,
        "idle": true,
        "error": true
      },
      "templates": {
        "idle": {
          "subject": "[OpenCode] 任务完成 - {{projectName}}",
          "body": "任务已完成\n\n项目: {{projectName}}\n时间: {{timestamp}}\n耗时: {{duration}}\n消息: {{message}}"
        },
        "error": {
          "subject": "[OpenCode] 任务错误 - {{projectName}}",
          "body": "任务发生错误\n\n项目: {{projectName}}\n时间: {{timestamp}}\n错误: {{error}}"
        }
      }
    }
  ]
}
```
### Channel Configuration
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Channel type: `smtp` |
| `enabled` | boolean | No | Whether this channel is active (default: true) |
| `name` | string | No | Channel name for identification |
| `config` | object | Yes | SMTP configuration |
| `recipients` | string[] | Yes | Email recipients |
| `events` | object | No | Which events to notify |
| `templates` | object | No | Custom templates for each event |
### SMTP Configuration
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | Yes | SMTP server hostname or IPv4/IPv6 address |
| `port` | number | Yes | SMTP port (465 for SSL, 587 for STARTTLS) |
| `secure` | boolean | No | Use SSL (default: true for port 465) |
| `localAddress` | string | No | Local interface to bind for IPv4/IPv6 control |
| `auth.user` | string | Yes | SMTP username (usually your email) |
| `auth.pass` | string | Yes | SMTP password or authorization code |

### IPv4/IPv6 Configuration

By default, the plugin automatically supports both IPv4 and IPv6. Nodemailer will:
- Resolve DNS to both IPv4 (A) and IPv6 (AAAA) records
- Try both address families in parallel
- Use whichever connects successfully

#### Force IPv4
If you want to force IPv4 connection (e.g., IPv6 is unavailable or unstable):
```json
{
  "config": {
    "host": "smtp.qq.com",
    "port": 465,
    "secure": true,
    "localAddress": "0.0.0.0",
    "auth": {
      "user": "your@qq.com",
      "pass": "authorization-code"
    }
  }
}
```

#### Force IPv6
If you want to force IPv6 connection:
```json
{
  "config": {
    "host": "smtp.example.com",
    "port": 465,
    "secure": true,
    "localAddress": "::",
    "auth": {
      "user": "your@example.com",
      "pass": "your-password"
    }
  }
}
```

#### Use IPv6 Address as Host
You can also use an IPv6 address directly as the host:
```json
{
  "config": {
    "host": "2001:db8::1",
    "port": 465,
    "secure": true,
    "auth": {
      "user": "your@example.com",
      "pass": "your-password"
    }
  }
}
```

### Events Configuration
| Event | Default | Description |
|-------|---------|-------------|
| `created` | false | When a new session starts |
| `idle` | true | When a session completes (AI finishes responding) |
| `error` | true | When a session encounters an error |
### Template Variables
| Variable | Description | Available Events |
|----------|-------------|------------------|
| `{{eventType}}` | Event type (created, idle, error) | All |
| `{{timestamp}}` | ISO 8601 timestamp | All |
| `{{projectName}}` | Project name | All |
| `{{sessionId}}` | Session ID | All |
| `{{message}}` | Completion message | idle |
| `{{duration}}` | Task duration | idle |
| `{{error}}` | Error message | error |
## CLI Tool
This package includes a CLI tool to test your notification channel configuration.
### Test Command
```bash
# Test all channels (validates config, tests connection, sends test email)
npx @ulthon/ul-opencode-event test

# Test a specific channel by name
npx @ulthon/ul-opencode-event test --channel "My Email"

# Only verify connection without sending email
npx @ulthon/ul-opencode-event test --no-send
```
### Test Output Example
```
[ul-opencode-event-cli] Starting channel test...
[ul-opencode-event-cli] Loaded project config: ./ul-opencode-event.json
[ul-opencode-event-cli] Found 1 channel(s) to test

[ul-opencode-event-cli] Testing channel: "My Email"
  Type: smtp
  Recipients: user@example.com

  [1/3] Validating configuration...
  [OK] Configuration is valid

  [2/3] Testing SMTP connection to smtp.example.com:465...
  [OK] Connection successful

  [3/3] Sending test email...
  [OK] Test email sent successfully
  Message ID: <xxx>

  [SUCCESS] Channel "My Email" passed all tests

[ul-opencode-event-cli] Test Summary:
  Passed: 1
  Failed: 0
```
## Troubleshooting
### SMTP connection failed
**Q: Does this plugin support IPv4? IPv6?**
**A: Yes, both are supported.** The plugin uses nodemailer which automatically:
- Resolves DNS to both IPv4 (A) and IPv6 (AAAA) records
- Tries both address families in parallel
- Falls back if one fails
**Common issues:**
1. **Wrong password**: Use authorization code for QQ/163, App Password for Gmail
2. **Wrong port**: Use 465 for SSL, 587 for STARTTLS
3. **Firewall**: Ensure outbound connections to SMTP port are allowed
4. **IPv6 issues**: If your network has incomplete IPv6, connections may timeout
   - Check your network's IPv6 configuration
   - Contact your network administrator if needed
### Debug mode
```bash
# Enable debug logging
UL_OPENCODE_EVENT_DEBUG=1 npx @ulthon/ul-opencode-event test
```
### No notifications sent
1. Check if `enabled: true` is set
2. Check if the event type is enabled in `events`
3. Check SMTP credentials are correct
4. Ensure config file exists at correct location
## Local Development
```bash
# Build
npm run build

# Test locally without publishing
node dist/cli.js test

# Or use npm link
npm link
npx @ulthon/ul-opencode-event test

# Unlink when done
npm unlink -g @ulthon/ul-opencode-event
```
## License
MIT
