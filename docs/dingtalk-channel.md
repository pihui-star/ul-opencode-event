# 钉钉通道文档

本文档涵盖钉钉（DingTalk）通道的**用户配置指南**和**内部实现细节**。

> 开发新渠道的通用指南请参阅 [channel-development.md](./channel-development.md)。

---

## 一、用户配置指南

### 1.1 获取 Webhook 和 Secret

1. 打开钉钉群，点击右上角 **群设置** > **智能群助手** > **添加机器人**
2. 选择 **自定义** 机器人，输入机器人名称和头像
3. **安全设置** 选择 **加签** 模式（推荐），复制生成的 **Secret**
4. 完成后复制 **Webhook 地址**（格式: `https://oapi.dingtalk.com/robot/send?access_token=xxx`）

> **建议**: 始终开启加签模式，避免 Webhook 被恶意调用。

### 1.2 最小配置

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

### 1.3 完整配置示例

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
          "body": "**OpenCode 任务完成**\n\n项目: {{projectName}}\n时间: {{timestamp}}\n耗时: {{duration}}\n消息: {{message}}"
        },
        "error": {
          "body": "**OpenCode 任务错误**\n\n项目: {{projectName}}\n时间: {{timestamp}}\n错误: {{error}}"
        }
      }
    }
  ]
}
```

### 1.4 配置字段说明

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `webhook` | string | Yes | - | 钉钉机器人 Webhook 地址 |
| `secret` | string | No | - | 加签密钥（安全设置选"加签"时提供） |
| `at.atMobiles` | string[] | No | - | 要 @的成员手机号列表 |
| `at.atAll` | boolean | No | false | 是否 @所有人 |

> **注意**: 钉钉通道不需要 `recipients` 字段，消息发送到机器人所在的钉钉群。

### 1.5 @人功能

钉钉支持在消息中 @指定群成员：

- **@指定成员**: 在 `at.atMobiles` 中填写手机号数组，如 `["13800138000", "13900139000"]`
- **@所有人**: 设置 `at.atAll` 为 `true`
- **不@任何人**: 不配置 `at` 字段，或设为空对象 `{}`

默认行为是不 @任何人。如果同时设置了 `atMobiles` 和 `atAll=true`，将以 `atAll` 为准。

### 1.6 常见问题

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

---

## 二、内部实现细节

本节供维护和调试参考。钉钉通道的完整实现位于 `src/dingtalk.ts`。

### 2.1 签名算法

当配置了 `secret` 字段时，Webhook URL 需要附加签名参数。算法步骤：

```
输入: secret (机器人密钥), timestamp (当前毫秒时间戳字符串)

Step 1: 构造签名字符串
  stringToSign = timestamp + "\n" + secret

Step 2: HmacSHA256 签名
  使用 Web Crypto API:
    key = crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    signature = crypto.subtle.sign('HMAC', key, encode(stringToSign))

Step 3: Base64 编码
  sign = btoa(String.fromCharCode(...new Uint8Array(signature)))

Step 4: 拼接 URL 参数
  url = webhook + "?timestamp=" + encodeURIComponent(timestamp) + "&sign=" + encodeURIComponent(sign)
```

关键点：
- 使用浏览器兼容的 `btoa` + `TextEncoder`，不依赖 Node.js `Buffer`
- 时间戳在每次 `send()` 调用时动态生成（非 sender 创建时）
- 如果 webhook URL 已有 query 参数，用 `&` 分隔；否则用 `?`

### 2.2 Markdown 格式化规则

钉钉 Markdown 是标准 Markdown 的子集，有以下特殊处理：

**特殊字符转义（17 个字符）：**

| 字符 | 转义后 | 说明 |
|------|--------|------|
| `\` | `\\` | 反斜杠 |
| `_` | `\_` | 下划线 |
| `*` | `\*` | 星号/加粗 |
| `[` | `\[` | 左方括号 |
| `]` | `\]` | 右方括号 |
| `(` | `\(` | 左圆括号 |
| `)` | `\)` | 右圆括号 |
| `~` | `\~` | 删除线 |
| `` ` `` | `` \` `` | 行内代码 |
| `>` | `\>` | 引用 |
| `#` | `\#` | 标题 |
| `+` | `\+` | 无序列表 |
| `-` | `\-` | 无序列表 |
| `=` | `\=` | 标题 |
| `{` | `\{` | 左花括号 |
| `}` | `\}` | 右花括号 |
| `\|` | `\|` | 表格 |
| `.` | `\.` | 点号 |

正则表达式：`/[\\_*\[\]()~`>#+\-={}|.`!]/g`

**智能行格式化：**

- **键值对行**：匹配 `/^(\s*\w[\w\s]*?)\s*:\s*(.+)$/` 的行，将 key 加粗：`**key**: value`
- **错误内容行**：包含 `error`、`Error`、`stack trace`、`Stack`、`Exception` 关键字的行，用 ``` 代码块包裹
- **普通行**：仅做特殊字符转义后原样输出

**截断策略：**

| 字段 | 最大长度 | 截断保留长度 | 后缀 |
|------|---------|-------------|------|
| title | 100 | 90 + "..." | `...` |
| text (content) | 4000 | 3800 | `\n... (truncated)` |

### 2.3 HTTP 请求规格

```
Method:   POST
Endpoint: 用户配置的 webhook URL（可带签名参数）
Timeout:  10 秒（AbortController）
Headers:  Content-Type: application/json
Body:     JSON.stringify(FormattedMessage)
```

请求体示例（含 @人）：

```json
{
  "msgtype": "markdown",
  "markdown": {
    "title": "[OpenCode] 任务完成 - my-project",
    "text": "**项目**: my-project\n**时间**: 2026-04-06T21:00:00Z\n**耗时**: 2m30s\n**消息**: Task completed"
  },
  "at": {
    "atMobiles": ["13800138000"],
    "atAll": false
  }
}
```

超时处理：使用 `AbortController` + `setTimeout` 实现 10 秒超时，超时后 abort 请求并在 catch 中走静默失败路径。

### 2.4 错误码处理

钉钉 API 返回的 JSON 包含 `errcode` 和 `errmsg` 字段：

| errcode | 含义 | 处理方式 |
|---------|------|---------|
| 0 | 成功 | 正常结束 |
| 未定义 / 缺失 | 解析失败（非 JSON） | 视为成功（容错） |
| 310000 | 参数不合法 | DEBUG 日志，静默忽略 |
| 400001 | 发送频率超限 | DEBUG 日志，静默忽略 |
| 其他非零值 | 未知错误 | DEBUG 日志，静默忽略 |

**核心原则：所有 API 错误均不向上传播，不阻塞其他渠道的通知发送。**

### 2.5 @人功能实现

通过 `DingtalkConfig.at` 配置：

```typescript
interface DingtalkConfig {
  webhook: string;
  secret?: string;
  at?: {
    atMobiles?: string[];  // 手机号列表
    atAll?: boolean;       // 是否 @所有人
  };
}
```

Formatter 在构建 `FormattedMessage` 时，如果 `config.at` 存在，将 `at` 对象附加到返回的消息体顶层。Sender 直接将整个 message（含 `at` 字段）序列化为 POST body 发送。

### 2.6 DingtalkConfig JSON Schema

```json
{
  "$id": "DingtalkConfig",
  "type": "object",
  "required": ["webhook"],
  "properties": {
    "webhook": {
      "type": "string",
      "description": "钉钉自定义机器人的 Webhook 地址",
      "format": "uri"
    },
    "secret": {
      "type": "string",
      "description": "机器人签名密钥（加签安全设置模式下必填）"
    },
    "at": {
      "type": "object",
      "description": "@人配置",
      "properties": {
        "atMobiles": {
          "type": "array",
          "items": { "type": "string" },
          "description": "要 @的手机号列表"
        },
        "atAll": {
          "type": "boolean",
          "description": "是否 @所有人（默认 false）"
        }
      }
    }
  }
}
```

### 2.7 Channel 接口字段映射（钉钉相关）

| Channel 字段 | 类型 | 钉钉场景下的含义 | 默认值 |
|-------------|------|-----------------|--------|
| `type` | `'dingtalk'` | 固定值 | 必填 |
| `enabled` | boolean | 是否启用该通道 | `true`（省略视为启用） |
| `name` | string | 通道标识名，用于日志和按 name 合并配置 | `'DingTalk'` |
| `config.webhook` | string | 机器人 Webhook URL | 必填 |
| `config.secret` | string | 签名密钥 | 可选（不加签模式可不填） |
| `config.at.atMobiles` | string[] | @人的手机号 | 可选 |
| `config.at.atAll` | boolean | 是否 @所有人 | 可选 |
| `recipients` | string[] | 钉钉场景下**不使用**（通过 webhook 目标群隐式确定接收者） | 忽略 |
| `events` | EventConfig | 各事件开关 | 见 EventType 默认值 |
| `templates` | ChannelTemplates | 自定义模板（subject/body） | 使用 locales.ts 默认模板 |

注意：`recipients` 字段在钉钉场景下没有实际作用。钉钉的接收者是 Webhook 所指向的群组全体成员（可通过 `at` 字段精确 @特定人）。

### 2.8 与 SMTP Config 对比

| 维度 | SMTP Config | DingtalkConfig |
|------|------------|----------------|
| 认证方式 | user + pass（账号密码/授权码） | webhook URL + secret（加签） |
| 接收者指定 | `recipients: string[]`（邮箱列表） | Webhook 目标群 + `at` 字段 |
| 安全传输 | SSL/TLS（secure + port 465/587） | HTTPS + HmacSHA256 签名 |
| 连接模型 | 持久连接（nodemailer transport pool） | 无状态 HTTP（每次 send 独立请求） |
| 资源清理 | `close()` 关闭连接池 | `close()` 空操作 |
| DNS 预解析 | 需要（代理/TUN 环境） | 不需要 |
| 消息格式 | 纯文本 subject + body | Markdown（title + text） |
| 格式化复杂度 | 低（透传） | 高（17 字符转义、键值对加粗、错误代码块、截断） |
| 外部依赖 | nodemailer（延迟导入） | 无（Web Crypto API + fetch 均为内置） |
