# 配置说明

本文档详细介绍 `@ulthon/ul-opencode-event` 插件的配置选项。

## 配置文件位置

插件会按以下优先级查找配置文件：

1. **项目级**：`.opencode/ul-opencode-event.json` 或 `./ul-opencode-event.json`
2. **全局级**：`~/.config/opencode/ul-opencode-event.json`

项目级配置会覆盖全局配置（通道按名称合并）。

> **推荐**：全局安装插件时，使用全局配置文件 `~/.config/opencode/ul-opencode-event.json`。

## 最小配置

创建配置文件 `~/.config/opencode/ul-opencode-event.json`：

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "我的邮箱",
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

## 常用 SMTP 服务器

| 服务商 | 主机 | 端口 | 安全连接 | 认证方式 |
|--------|------|------|----------|----------|
| QQ 邮箱 | smtp.qq.com | 465 | true | 授权码 |
| 163 邮箱 | smtp.163.com | 465 | true | 授权码 |
| Gmail | smtp.gmail.com | 587 | false | 应用专用密码 |
| Outlook | smtp.office365.com | 587 | false | 密码 |

> **注意**：QQ/163 邮箱请使用授权码，而非登录密码。Gmail 需启用双因素认证并使用应用专用密码。

### 如何获取授权码

#### QQ 邮箱
1. 登录 QQ 邮箱网页版
2. 进入「设置」→「账户」
3. 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务」
4. 开启「POP3/SMTP服务」
5. 按提示获取授权码

#### 163 邮箱
1. 登录 163 邮箱
2. 进入「设置」→「POP3/SMTP/IMAP」
3. 开启「IMAP/SMTP服务」
4. 获取授权码

#### Gmail
1. 登录 Google 账户
2. 进入「安全性」→「两步验证」（需先启用）
3. 搜索「应用专用密码」
4. 生成新的应用专用密码

## 完整配置示例

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

## 配置项说明

### 通道配置 (Channel)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 通道类型，目前仅支持 `smtp` |
| `enabled` | boolean | 否 | 是否启用此通道，默认 `true` |
| `name` | string | 否 | 通道名称，用于标识和测试时指定 |
| `config` | object | 是 | SMTP 服务器配置 |
| `recipients` | string[] | 是 | 邮件收件人列表 |
| `events` | object | 否 | 哪些事件触发通知 |
| `templates` | object | 否 | 自定义邮件模板 |

### SMTP 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `host` | string | 是 | SMTP 服务器主机名或 IP 地址 |
| `port` | number | 是 | SMTP 端口（SSL 用 465，STARTTLS 用 587） |
| `secure` | boolean | 否 | 是否使用 SSL，465 端口默认 `true` |
| `localAddress` | string | 否 | 绑定的本地网络接口（用于控制 IPv4/IPv6） |
| `auth.user` | string | 是 | SMTP 用户名（通常是邮箱地址） |
| `auth.pass` | string | 是 | SMTP 密码或授权码 |

### 事件配置 (Events)

| 事件 | 默认值 | 说明 |
|------|--------|------|
| `created` | false | 新会话开始时触发 |
| `idle` | true | 会话完成时触发（AI 完成响应） |
| `error` | true | 会话遇到错误时触发 |

### 模板配置 (Templates)

可以为每种事件类型自定义邮件主题和内容。

#### 模板变量

| 变量 | 说明 | 可用事件 |
|------|------|----------|
| `{{eventType}}` | 事件类型（created, idle, error） | 所有 |
| `{{timestamp}}` | ISO 8601 格式时间戳 | 所有 |
| `{{projectName}}` | 项目名称 | 所有 |
| `{{sessionId}}` | 会话 ID | 所有 |
| `{{message}}` | 完成消息 | idle |
| `{{duration}}` | 任务耗时 | idle |
| `{{error}}` | 错误消息 | error |

#### 模板示例

```json
{
  "templates": {
    "idle": {
      "subject": "[OpenCode] 任务完成 - {{projectName}}",
      "body": "您的 OpenCode 任务已完成。\n\n项目: {{projectName}}\n会话: {{sessionId}}\n完成时间: {{timestamp}}\n耗时: {{duration}}\n\n消息: {{message}}"
    },
    "error": {
      "subject": "[OpenCode] 错误警报 - {{projectName}}",
      "body": "OpenCode 任务遇到错误。\n\n项目: {{projectName}}\n会话: {{sessionId}}\n时间: {{timestamp}}\n\n错误详情:\n{{error}}"
    },
    "created": {
      "subject": "[OpenCode] 新会话 - {{projectName}}",
      "body": "新的 OpenCode 会话已开始。\n\n项目: {{projectName}}\n会话: {{sessionId}}\n开始时间: {{timestamp}}"
    }
  }
}
```

## IPv4/IPv6 配置

默认情况下，插件自动支持 IPv4 和 IPv6 连接。Nodemailer 会：
- 解析 DNS 获取 IPv4 (A) 和 IPv6 (AAAA) 记录
- 并行尝试两种地址族
- 使用成功连接的那个

### 强制使用 IPv4

如果 IPv6 不可用或不稳定，可以强制使用 IPv4：

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

### 强制使用 IPv6

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

### 直接使用 IPv6 地址

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

## 多通道配置

可以配置多个通知通道，例如同时发送到多个邮箱：

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "个人邮箱",
      "config": {
        "host": "smtp.qq.com",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "personal@qq.com",
          "pass": "authorization-code"
        }
      },
      "recipients": ["personal@qq.com"],
      "events": {
        "idle": true,
        "error": true
      }
    },
    {
      "type": "smtp",
      "enabled": true,
      "name": "工作邮箱",
      "config": {
        "host": "smtp.office365.com",
        "port": 587,
        "secure": false,
        "auth": {
          "user": "work@company.com",
          "pass": "password"
        }
      },
      "recipients": ["work@company.com", "team@company.com"],
      "events": {
        "error": true
      }
    }
  ]
}
```

## 配置合并规则

当同时存在全局配置和项目配置时：
- 通道按 `name` 字段合并
- 项目配置中的通道会覆盖同名的全局配置
- 不同名称的通道会合并在一起

示例：
- 全局配置有通道 A、B
- 项目配置有通道 B、C
- 最终生效：A（全局）+ B（项目覆盖）+ C（项目）

## 下一步

- [返回 README](README_CN.md)
- [故障排除](README_CN.md#故障排除)
