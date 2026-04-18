# SMTP 通道文档

本文档涵盖 SMTP（邮件）通道的**用户配置指南**和**内部实现细节**。

> 通用配置文件位置和合并规则请参阅 [configuration.md](./configuration.md)。
> 模板变量和自定义模板语法请参阅 [template-configuration.md](./template-configuration.md)。
> 开发新渠道的通用指南请参阅 [channel-development.md](./channel-development.md)。

---

## 一、用户配置指南

### 1.1 获取 SMTP 凭证

SMTP 通道需要邮箱的 SMTP 服务凭证。不同邮箱服务商的获取方式不同：

#### QQ 邮箱（授权码）

1. 登录 QQ 邮箱网页版
2. 进入「设置」->「账户」
3. 找到「POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务」
4. 开启「POP3/SMTP 服务」
5. 按提示用手机发送短信，获取**授权码**

> 授权码不是 QQ 密码，是专门用于第三方客户端登录的独立密码。

#### 163 邮箱（授权码）

1. 登录 163 邮箱网页版
2. 进入「设置」->「POP3/SMTP/IMAP」
3. 开启「IMAP/SMTP 服务」
4. 按提示获取**授权码**

#### Gmail（应用专用密码）

1. 登录 Google 账户
2. 进入「安全性」->「两步验证」（需先启用）
3. 搜索「应用专用密码」
4. 生成新的应用专用密码（16 位字母，无需空格）

> Gmail 必须先启用双因素认证（2FA），才能生成应用专用密码。

#### Outlook（密码）

Outlook 通常可直接使用账户密码。如果启用了双因素认证，也需要生成应用密码。

### 1.2 常用 SMTP 服务器

| 服务商 | 主机 (host) | 端口 (port) | 安全连接 (secure) | 认证方式 |
|--------|-------------|-------------|-------------------|----------|
| QQ 邮箱 | smtp.qq.com | 465 | true | 授权码 |
| 163 邮箱 | smtp.163.com | 465 | true | 授权码 |
| Gmail | smtp.gmail.com | 587 | false | 应用专用密码 |
| Outlook | smtp.office365.com | 587 | false | 密码 |

### 1.3 最小配置

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "我的邮箱",
      "config": {
        "host": "smtp.qq.com",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "your@qq.com",
          "pass": "your-authorization-code"
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

### 1.4 完整配置示例

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

> 模板变量和自定义模板的详细说明请参阅 [template-configuration.md](./template-configuration.md)。

### 1.5 通道配置字段

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `type` | string | 是 | - | 通道类型，固定为 `"smtp"` |
| `enabled` | boolean | 否 | true | 是否启用此通道 |
| `name` | string | 否 | `"Notification"` | 通道名称，用于日志标识和按名称合并配置 |
| `config` | object | 是 | - | SMTP 服务器配置（见下方） |
| `recipients` | string[] | 是 | - | 邮件收件人地址列表 |
| `events` | object | 否 | - | 各事件类型的开关，详见 [configuration.md](./configuration.md) |
| `templates` | object | 否 | - | 自定义模板，详见 [template-configuration.md](./template-configuration.md) |

### 1.6 SMTP 配置字段

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `host` | string | 是 | - | SMTP 服务器主机名或 IP 地址（支持 IPv6） |
| `port` | number | 是 | - | SMTP 端口。SSL 用 465，STARTTLS 用 587 |
| `secure` | boolean | 否 | port 为 465 时为 true | 是否使用 SSL/TLS 连接 |
| `localAddress` | string | 否 | - | 绑定的本地网络接口，用于控制 IPv4/IPv6（见下方） |
| `auth.user` | string | 是 | - | SMTP 用户名，通常是邮箱地址 |
| `auth.pass` | string | 是 | - | SMTP 密码或授权码 |

### 1.7 IPv4/IPv6 配置

默认情况下，插件自动支持 IPv4 和 IPv6 连接。Nodemailer 会同时解析 DNS 的 A 记录（IPv4）和 AAAA 记录（IPv6），并行尝试两种地址族，使用首先成功的连接。

#### 强制使用 IPv4

如果 IPv6 不可用或不稳定，通过设置 `localAddress` 为 `"0.0.0.0"` 强制使用 IPv4：

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

#### 强制使用 IPv6

通过设置 `localAddress` 为 `"::"` 强制使用 IPv6：

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

#### 直接使用 IPv6 地址

也可以直接将 IPv6 地址作为 `host` 值：

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

### 1.8 多通道配置

可以在同一个配置文件中配置多个 SMTP 通道（例如个人邮箱和工作邮箱）：

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

> 多通道配置的合并规则（按 `name` 字段合并）请参阅 [configuration.md](./configuration.md)。

### 1.9 常见问题

**Q: 提示密码错误（535 Authentication failed）怎么办？**

A: 检查以下几点：
1. QQ/163 邮箱：确认使用的是**授权码**，不是登录密码
2. Gmail：确认使用的是**应用专用密码**，不是 Google 账户密码，且已启用双因素认证
3. 检查 `auth.pass` 中是否有多余的空格或换行符

**Q: 端口号怎么选择？**

A:
- **465 端口**：SSL/TLS 加密连接，对应 `secure: true`
- **587 端口**：STARTTLS 连接，对应 `secure: false`
- 绝大多数 SMTP 服务器使用这两个端口之一，请参考上方的常用 SMTP 服务器表

**Q: 连接超时或被防火墙拦截？**

A:
1. 确认服务器出站的 SMTP 端口（465 或 587）未被防火墙封锁
2. 部分云服务器（如阿里云、腾讯云）默认封禁 25 端口，但 465/587 通常可用
3. 如果在企业网络内，可能需要联系网络管理员开放端口

**Q: IPv6 连接不稳定怎么办？**

A: 设置 `localAddress` 为 `"0.0.0.0"` 强制使用 IPv4。部分网络环境虽然分配了 IPv6 地址但连接不稳定，此时 IPv6 优先的策略可能导致超时。强制 IPv4 可以避免此问题。

**Q: 如何开启调试模式查看详细日志？**

A: 设置环境变量 `UL_OPENCODE_EVENT_DEBUG=1`：

```bash
UL_OPENCODE_EVENT_DEBUG=1 npx @ulthon/ul-opencode-event test
```

日志文件默认位于 `~/.local/share/opencode/ul-opencode-event.log`。

**Q: 配置了但没有收到通知？**

A: 逐步排查：
1. 确认 `enabled` 未设置为 `false`
2. 确认对应事件类型在 `events` 中已开启（如 `"idle": true`）
3. 运行 `npx @ulthon/ul-opencode-event test --channel "通道名称"` 测试连接
4. 检查 `recipients` 中的邮箱地址是否正确
5. 查看日志文件中的错误信息

---

## 二、内部实现细节

本节供维护和调试参考。SMTP 通道的完整实现位于 `src/email.ts`。

### 2.1 DNS 预解析机制

在代理/TUN 环境（如 Clash、V2Ray）下，系统 DNS 可能被劫持，返回虚假 IP 地址（如 `198.18.x.x`）。这会导致 SMTP 连接失败。

**解决方案**：在创建 nodemailer transport 之前，通过 `node:dns/promises.lookup()` 主动解析 DNS，获取真实 IP 地址。

```
解析流程:
1. 检查 host 是否已是 IP 地址 -> 是则直接使用
2. 尝试 IPv4 解析 (family: 4, 超时 1200ms)
3. IPv4 失败则尝试 IPv6 解析 (family: 6, 超时 1200ms)
4. 均失败则返回 null (使用原始 host 回退)
```

预解析后的 IP 地址会用于连接，同时通过 TLS SNI (`servername`) 传递原始主机名，确保 SSL 证书校验正常。

**发送策略**（按优先级依次尝试）：

| 策略 | 触发条件 | 说明 |
|------|----------|------|
| 1. 预解析发送 | 预解析成功且 IP 不同于 host | 使用预解析 IP 连接，绕过代理 DNS 劫持 |
| 2. 主机名回退 | 策略 1 失败 | 使用原始主机名创建新 transport 发送 |
| 3. 直接发送 | 预解析结果与 host 相同 | 使用默认 transport 发送 |
| 4. 紧急 DNS 重解析 | 策略 3 遇到连接/DNS 错误 | 重新执行 DNS 解析，用新 IP 创建 transport |

### 2.2 Nodemailer 延迟导入

库代码中**不在顶层静态导入 nodemailer**，而是通过动态 `import('nodemailer')` 延迟加载：

```typescript
let nodemailerModule: typeof import('nodemailer') | null = null;

async function getNodemailer() {
  if (!nodemailerModule) {
    nodemailerModule = await import('nodemailer');
  }
  return nodemailerModule;
}
```

**原因**：OpenCode 自身内置了 nodemailer，如果在插件顶层静态导入，可能导致版本冲突或模块重复加载。延迟导入确保 nodemailer 仅在实际发送邮件时才加载，避免与宿主环境的冲突。

模块加载结果会被缓存到 `nodemailerModule` 变量中，后续调用直接返回缓存，不会重复加载。

### 2.3 连接模型

SMTP 通道使用 nodemailer 的 transport 连接模型：

- **Transport 创建**：调用 `nodemailer.createTransport(options)` 创建 transport 实例
- **安全加固**：创建后调用 `set('disableFileAccess', true)` 和 `set('disableUrlAccess', true)` 禁止文件和 URL 访问
- **发送方式**：调用 `transporter.sendMail(mailOptions)` 发送邮件
- **资源释放**：调用 `transporter.close()` 关闭连接

发件人信息格式：`"通道名称" <认证用户邮箱>`，即 `from` 字段由 `channel.name` 和 `config.auth.user` 组合而成。

收件人列表通过 `channel.recipients.join(', ')` 拼接，支持多个收件人。

### 2.4 错误处理原则

与所有通道一致，SMTP 通道采用**静默失败**策略：

- 所有发送错误（连接失败、认证失败、超时等）均通过 `logger.error` 记录日志
- 错误不会向上层传播，不会阻塞其他通道的通知发送
- 多次重试失败后静默返回，不影响插件整体运行

### 2.5 SMTPConfig JSON Schema

```json
{
  "$id": "SMTPConfig",
  "type": "object",
  "required": ["host", "port", "auth"],
  "properties": {
    "host": {
      "type": "string",
      "description": "SMTP 服务器主机名或 IP 地址（支持 IPv6）"
    },
    "port": {
      "type": "number",
      "description": "SMTP 端口号（465 for SSL, 587 for STARTTLS）"
    },
    "secure": {
      "type": "boolean",
      "description": "是否使用 SSL/TLS 连接（port 为 465 时默认 true）"
    },
    "localAddress": {
      "type": "string",
      "description": "绑定的本地网络接口，用于控制 IPv4/IPv6"
    },
    "auth": {
      "type": "object",
      "required": ["user", "pass"],
      "properties": {
        "user": {
          "type": "string",
          "description": "SMTP 用户名（通常是邮箱地址）"
        },
        "pass": {
          "type": "string",
          "description": "SMTP 密码或授权码"
        }
      }
    }
  }
}
```

### 2.6 Channel 接口字段映射（SMTP 相关）

| Channel 字段 | 类型 | SMTP 场景下的含义 | 默认值 |
|-------------|------|-----------------|--------|
| `type` | `'smtp'` | 固定值 | 必填 |
| `enabled` | boolean | 是否启用该通道 | `true`（省略视为启用） |
| `name` | string | 通道标识名，用于日志和按 name 合并配置 | `'Notification'` |
| `config.host` | string | SMTP 服务器地址 | 必填 |
| `config.port` | number | SMTP 端口 | 必填 |
| `config.secure` | boolean | 是否使用 SSL/TLS | port 为 465 时默认 true |
| `config.localAddress` | string | 本地网络接口绑定 | 可选 |
| `config.auth.user` | string | SMTP 认证用户名 | 必填 |
| `config.auth.pass` | string | SMTP 认证密码/授权码 | 必填 |
| `recipients` | string[] | 邮件收件人地址列表 | 必填（无收件人则通道不创建） |
| `events` | EventConfig | 各事件开关 | 见 EventType 默认值 |
| `templates` | ChannelTemplates | 自定义模板（subject/body） | 使用 locales.ts 默认模板 |

注意：`recipients` 在 SMTP 场景下是必填字段。如果没有配置收件人（空数组或缺失），该通道的 sender 不会被创建。
