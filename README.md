# @ulthon/ul-opencode-event

**Never miss an OpenCode notification, even when you're away from your desk.**

OpenCode multi-channel notification plugin that keeps you informed wherever you are. Perfect for remote development - get notified when tasks complete or errors occur via email or DingTalk, even if you're not at your terminal.

## Why ul-opencode-event?

- 🌍 **Remote Development Friendly** - Desktop notifications don't work when you're away. Our plugin sends notifications to your email (and more channels coming soon), so you'll always know when your AI coding agent finishes a task.
- 📬 **Multi-Channel Support** - Supports SMTP email and DingTalk robot, with more notification channels planned (webhook, Telegram, Slack, etc.)
- ⚡ **Real-time Alerts** - Get notified immediately when sessions complete (`idle`) or encounter errors (`error`)
- 🔧 **Easy Configuration** - Simple JSON config with channel-level customization

## Roadmap

| Channel | Status | Description |
|---------|--------|-------------|
| ✅ SMTP (Email) | Available | Email notifications via any SMTP server |
| 🔜 Webhook | Planned | HTTP webhook for custom integrations |
| 🔜 Telegram | Planned | Telegram bot notifications |
| 🔜 Slack | Planned | Slack incoming webhooks |
| ✅ DingTalk | Available | 钉钉机器人 |
| ✅ Feishu | Available | 飞书机器人 |
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
  "projectName": "my-project",
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
          "subject": "[{{projectName}}] 任务完成",
          "body": "任务已完成\n\n时间: {{timestamp}}\n耗时: {{duration}}\n消息: {{message}}"
        },
        "error": {
          "subject": "[{{projectName}}] 任务错误",
          "body": "任务发生错误\n\n时间: {{timestamp}}\n错误: {{error}}"
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

### DingTalk 机器人配置

通过钉钉群自定义机器人接收 OpenCode 通知消息，支持 Markdown 格式和 @人功能。

#### 获取 Webhook 和 Secret

1. 打开钉钉群，点击右上角 **群设置** > **智能群助手** > **添加机器人**
2. 选择 **自定义** 机器人，输入机器人名称和头像
3. **安全设置** 选择 **加签** 模式（推荐），复制生成的 **Secret**
4. 完成后复制 **Webhook 地址**（格式: `https://oapi.dingtalk.com/robot/send?access_token=xxx`）

> **建议**: 始终开启加签模式，避免 Webhook 被恶意调用。

#### 最小配置

```json
{
  "channels": [
    {
      "type": "dingtalk",
      "enabled": true,
      "name": "钉钉通知",
      "config": {
        "webhook": "https://oapi.dingtalk.com/robot/send?access_token=YOUR_ACCESS_TOKEN"
      },
      "events": {
        "idle": true,
        "error": true
      }
    }
  ]
}
```

#### 完整配置示例

```json
{
  "channels": [
    {
      "type": "dingtalk",
      "enabled": true,
      "name": "钉钉通知",
      "config": {
        "webhook": "https://oapi.dingtalk.com/robot/send?access_token=YOUR_ACCESS_TOKEN",
        "secret": "SEC-your-secret-key-here",
        "at": {
          "atMobiles": ["13800138000"],
          "atAll": false
        }
      },
      "events": {
        "created": false,
        "idle": true,
        "error": true
      },
      "templates": {
        "idle": {
          "body": "### [{{projectName}}] 任务完成\n\n**耗时**: {{duration}}\n**消息**: {{message}}\n\n> {{timestamp}}"
        },
        "error": {
          "body": "### [{{projectName}}] 任务错误\n\n**错误**: {{error}}\n\n> {{timestamp}}"
        }
      }
    }
  ]
}
```

#### DingTalk 配置字段说明

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `webhook` | string | Yes | - | 钉钉机器人 Webhook 地址 |
| `secret` | string | No | - | 加签密钥（安全设置选"加签"时提供） |
| `at.atMobiles` | string[] | No | - | 要 @的成员手机号列表 |
| `at.atAll` | boolean | No | false | 是否 @所有人 |

> **注意**: 钉钉通道不需要 `recipients` 字段，消息发送到机器人所在的钉钉群。

#### @人功能

钉钉支持在消息中 @指定群成员：

- **@指定成员**: 在 `at.atMobiles` 中填写手机号数组，如 `["13800138000", "13900139000"]`
- **@所有人**: 设置 `at.atAll` 为 `true`
- **不@任何人**: 不配置 `at` 字段，或设为空对象 `{}`

默认行为是不 @任何人。如果同时设置了 `atMobiles` 和 `atAll=true`，将以 `atAll` 为准。

#### 钉钉常见问题

**Q: 签名失败 (signature mismatch) 怎么办？**

A: 检查以下几点：
1. 确认 `secret` 值与钉钉后台显示的完全一致（注意前后空格）
2. 确认服务器时间与标准时间偏差不超过 1 小时
3. 如果使用代理/TUN 环境，确认网络能正常访问 `oapi.dingtalk.com`

**Q: 消息发送频率有限制吗？**

A: 有。每个机器人每条消息不超过 20 条/分钟。如果短时间内产生大量事件通知（如批量文件编辑），部分消息可能被限流丢弃。

**Q: 钉钉 Markdown 支持哪些格式？**

A: 钉钉 Markdown 支持有限的语法子集：
- 标题: `#` `##` `###`
- 加粗: `**text**`
- 引用: `>`
- 有序/无序列表
- 链接: `[text](url)`
- 图片: `![](url)`

不支持表格、代码块高亮、HTML 标签等。编写自定义模板时请使用支持的语法。

**Q: 消息丢失或收不到怎么办？**

A: 排查步骤：
1. 运行 `npx @ulthon/ul-opencode-event test --channel "钉钉通知"` 测试连接
2. 设置环境变量 `UL_OPENCODE_EVENT_DEBUG=1` 查看详细日志
3. 检查钉钉群中机器人是否已被移除或禁用
4. 确认 Webhook 地址中的 `access_token` 未过期（通常不会过期）

### 飞书机器人配置

通过飞书群自定义机器人接收 OpenCode 通知消息，支持交互式卡片格式。

#### 获取 Webhook 和 Secret

1. 进入目标飞书群聊 -> 右上角 **设置**
2. 点击 **群机器人** -> **添加机器人**
3. 选择 **自定义机器人**
4. 设置头像、名称、描述 -> 点击 **添加**
5. **安全设置** 可选择签名校验（推荐），复制生成的 **Secret**
6. 复制 **Webhook 地址**（格式: `https://open.feishu.cn/open-apis/bot/v2/hook/xxx`）

> **建议**: 开启签名校验模式，避免 Webhook 被恶意调用。

#### 最小配置

```json
{
  "channels": [
    {
      "type": "feishu",
      "enabled": true,
      "name": "飞书通知",
      "config": {
        "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_HOOK_ID"
      },
      "events": {
        "idle": true,
        "error": true
      }
    }
  ]
}
```

#### 完整配置示例

```json
{
  "channels": [
    {
      "type": "feishu",
      "enabled": true,
      "name": "飞书通知",
      "config": {
        "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_HOOK_ID",
        "secret": "your-secret-key-here"
      },
      "events": {
        "created": false,
        "idle": true,
        "error": true
      },
      "templates": {
        "idle": {
          "body": "**项目**: {{projectName}}\n**耗时**: {{duration}}\n**消息**: {{message}}\n\n> {{timestamp}}"
        },
        "error": {
          "body": "**项目**: {{projectName}}\n**错误**: {{error}}\n\n> {{timestamp}}"
        }
      }
    }
  ]
}
```

#### 飞书配置字段说明

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `webhook` | string | Yes | - | 飞书机器人 Webhook 地址 |
| `secret` | string | No | - | 签名校验密钥（安全设置选"签名校验"时提供） |

> **注意**: 飞书通道不需要 `recipients` 字段，消息发送到机器人所在的飞书群。

#### 飞书常见问题

**Q: 签名失败怎么办？**

A: 检查以下几点：
1. 确认 `secret` 值与飞书后台显示的完全一致（注意前后空格）
2. 确认服务器时间与标准时间偏差不超过 1 小时
3. 如果使用代理/TUN 环境，确认网络能正常访问 `open.feishu.cn`

**Q: 飞书消息格式支持什么？**

A: 飞书通道使用交互式卡片格式，支持 lark_md（飞书 Markdown）语法：
- 标题: `**text**`（加粗）
- 链接: `[text](url)`
- 代码块: ` ```code``` `
- 有序/无序列表

**Q: 消息丢失或收不到怎么办？**

A: 排查步骤：
1. 运行 `npx @ulthon/ul-opencode-event test --channel "飞书通知"` 测试连接
2. 设置环境变量 `UL_OPENCODE_EVENT_DEBUG=1` 查看详细日志
3. 检查飞书群中机器人是否已被移除或禁用

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
| `{{projectName}}` | Project short name (directory basename or config value) | All |
| `{{projectPath}}` | Project full path (e.g. `/home/user/my-project`) | All |
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
