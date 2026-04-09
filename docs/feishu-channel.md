# 飞书通道文档

本文档涵盖飞书（Feishu/Lark）通道的**用户配置指南**和**内部实现细节**。

> 开发新渠道的通用指南请参阅 [channel-development.md](./channel-development.md)。

---

## 一、用户配置指南

### 1.1 获取 Webhook 和 Secret

1. 进入目标飞书群聊，点击右上角 **设置**
2. 点击 **群机器人** > **添加机器人**
3. 选择 **自定义机器人**
4. 设置头像、名称、描述，点击 **添加**
5. **安全设置** 可选择签名校验（推荐），复制生成的 **Secret**
6. 复制 **Webhook 地址**（格式: `https://open.feishu.cn/open-apis/bot/v2/hook/xxx`）

> **建议**: 开启签名校验模式，避免 Webhook 被恶意调用。

### 1.2 最小配置

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

### 1.3 完整配置示例

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

### 1.4 配置字段说明

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `webhook` | string | Yes | - | 飞书机器人 Webhook 地址 |
| `secret` | string | No | - | 签名校验密钥（安全设置选"签名校验"时提供） |

> **注意**: 飞书通道不需要 `recipients` 字段，消息发送到机器人所在的飞书群。

### 1.5 常见问题

**Q: 签名失败怎么办？**

A: 检查以下几点：
1. 确认 `secret` 值与飞书后台显示的完全一致（注意前后空格）
2. 确认服务器时间与标准时间偏差不超过 1 小时
3. 如果使用代理/TUN 环境，确认网络能正常访问 `open.feishu.cn`

**Q: 消息发送频率有限制吗？**

A: 有。飞书自定义机器人 Webhook 有频率限制，具体配额取决于租户配置。如果短时间内产生大量事件通知（如批量文件编辑），部分消息可能被限流丢弃。

**Q: 飞书消息格式支持什么？**

A: 飞书通道使用交互式卡片格式，卡片内容支持 lark_md（飞书 Markdown）语法：
- 加粗: `**text**`
- 链接: `[text](url)`
- 代码块: ` ```code``` `
- 有序/无序列表
- 引用: `>`

lark_md 使用标准 Markdown 语法，不需要像钉钉那样对特殊字符做转义处理。

**Q: 消息丢失或收不到怎么办？**

A: 排查步骤：
1. 运行 `npx @ulthon/ul-opencode-event test --channel "飞书通知"` 测试连接
2. 设置环境变量 `UL_OPENCODE_EVENT_DEBUG=1` 查看详细日志
3. 检查飞书群中机器人是否已被移除或禁用

---

## 二、内部实现细节

本节供维护和调试参考。飞书通道的完整实现位于 `src/feishu.ts`。

### 2.1 签名算法

当配置了 `secret` 字段时，请求体中需要附带签名参数。算法步骤：

```
输入: secret (机器人密钥), timestamp (当前秒级时间戳字符串)

Step 1: 构造签名密钥
  stringToSign = timestamp + "\n" + secret

Step 2: HmacSHA256 签名
  使用 Web Crypto API:
    key = crypto.subtle.importKey('raw', encode(stringToSign), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    signature = crypto.subtle.sign('HMAC', key, encode(''))    // message 为空字符串!

Step 3: Base64 编码
  sign = btoa(String.fromCharCode(...new Uint8Array(signature)))

Step 4: 附加到请求体 (注意: 不是 URL 参数!)
  body.timestamp = timestamp
  body.sign = sign
```

关键点：
- 使用浏览器兼容的 `btoa` + `TextEncoder`，不依赖 Node.js `Buffer`
- 时间戳在每次 `send()` 调用时动态生成（非 sender 创建时）

**与钉钉的差异（重点）：**

| 维度 | 飞书 | 钉钉 |
|------|------|------|
| HMAC key | `timestamp + "\n" + secret` | `secret` |
| HMAC message | `""` (空字符串) | `timestamp + "\n" + secret` |
| 时间戳精度 | 秒级 `Math.floor(Date.now() / 1000)` | 毫秒级 `Date.now()` |
| 签名传递方式 | 放在 JSON body 中 (`timestamp` + `sign` 字段) | 拼接在 URL 参数中 |

### 2.2 交互式卡片消息格式化规则

飞书使用交互式卡片（Interactive Card）承载通知内容，内部结构为 `{ msg_type: "interactive", card: { header, elements } }`。

**Subject 作为卡片标题：**

模板中的 `subject` 字段会被自动提取为卡片的 header 标题（`plain_text` 格式，蓝色主题），不再出现在 body 内容中。用户自定义模板只需关注 `body` 部分，`subject` 会自动渲染在卡片顶部。

**lark_md 格式化规则：**

飞书的 lark_md 使用标准 Markdown 语法，**不需要像钉钉那样做 17 字符转义**。行级别的格式化规则：

- **键值对行**：匹配 `/^(\s*\w[\w\s]*?)\s*:\s*(.+)$/` 的行，将 key 加粗：`**key**: value`
- **错误内容行**：包含 `error`、`Error`、`stack trace`、`Stack`、`Exception` 关键字的行，用 ``` 代码块包裹
- **普通行**：原样输出（lark_md 不需要字符转义）

**截断策略：**

| 字段 | 最大长度 | 截断处理 | 后缀 |
|------|---------|---------|------|
| title (header) | 100 | 截取前 90 字符 | `...` |
| text (card content) | 4000 | 截取前 3800 字符 | `\n... (truncated)` |

### 2.3 HTTP 请求规格

```
Method:   POST
Endpoint: 用户配置的 webhook URL
Timeout:  10 秒（AbortController）
Headers:  Content-Type: application/json
Body:     JSON.stringify(body)    // body 包含 msg_type, card, 以及可选的 timestamp + sign
```

请求体示例（含签名）：

```json
{
  "msg_type": "interactive",
  "timestamp": "1712678400",
  "sign": "Base64EncodedSignature==",
  "card": {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "[my-project] 任务完成" },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": "**耗时**: 2m30s\n**消息**: Task completed\n\n> 2026-04-06T21:00:00Z"
        }
      }
    ]
  }
}
```

超时处理：使用 `AbortController` + `setTimeout` 实现 10 秒超时，超时后 abort 请求并在 catch 中走静默失败路径。

**与钉钉的差异：签名放在 body 中（不是 URL 参数），不需要拼接 URL。**

### 2.4 错误码处理

飞书 API 返回的 JSON 包含 `code` 和 `msg` 字段：

| code | 含义 | 处理方式 |
|------|------|---------|
| 0 | 成功 | 正常结束 |
| 未定义 / 缺失 | 解析失败（非 JSON） | 视为成功（容错） |
| 其他非零值 | 未知错误 | DEBUG 日志，静默忽略 |

**与钉钉的差异：** 飞书响应格式是 `{ "code": 0, "msg": "success" }`，而钉钉是 `{ "errcode": 0, "errmsg": "ok" }`。

**核心原则：所有 API 错误均不向上传播，不阻塞其他渠道的通知发送。**

### 2.5 FeishuConfig JSON Schema

```json
{
  "$id": "FeishuConfig",
  "type": "object",
  "required": ["webhook"],
  "properties": {
    "webhook": {
      "type": "string",
      "description": "飞书自定义机器人的 Webhook 地址",
      "format": "uri"
    },
    "secret": {
      "type": "string",
      "description": "机器人签名密钥（开启签名校验安全设置时必填）"
    }
  }
}
```

### 2.6 Channel 接口字段映射（飞书相关）

| Channel 字段 | 类型 | 飞书场景下的含义 | 默认值 |
|-------------|------|-----------------|--------|
| `type` | `'feishu'` | 固定值 | 必填 |
| `enabled` | boolean | 是否启用该通道 | `true`（省略视为启用） |
| `name` | string | 通道标识名，用于日志和按 name 合并配置 | `'Feishu'` |
| `config.webhook` | string | 机器人 Webhook URL | 必填 |
| `config.secret` | string | 签名密钥 | 可选（不开启签名校验可不填） |
| `recipients` | string[] | 飞书场景下**不使用**（通过 webhook 目标群隐式确定接收者） | 忽略 |
| `events` | EventConfig | 各事件开关 | 见 EventType 默认值 |
| `templates` | ChannelTemplates | 自定义模板（body 部分） | 使用 locales.ts 默认模板 |

注意：`recipients` 字段在飞书场景下没有实际作用。飞书的接收者是 Webhook 所指向的群组全体成员。

### 2.7 与 SMTP / DingTalk 对比

| 维度 | SMTP Config | DingtalkConfig | FeishuConfig |
|------|------------|----------------|--------------|
| 认证方式 | user + pass（账号密码/授权码） | webhook URL + secret（加签） | webhook URL + secret（签名校验） |
| 接收者指定 | `recipients: string[]`（邮箱列表） | Webhook 目标群 + `at` 字段 | Webhook 目标群（无 @ 功能） |
| 安全传输 | SSL/TLS（secure + port 465/587） | HTTPS + HmacSHA256 签名 | HTTPS + HmacSHA256 签名 |
| 连接模型 | 持久连接（nodemailer transport pool） | 无状态 HTTP（每次 send 独立请求） | 无状态 HTTP（每次 send 独立请求） |
| 资源清理 | `close()` 关闭连接池 | `close()` 空操作 | `close()` 空操作 |
| DNS 预解析 | 需要（代理/TUN 环境） | 不需要 | 不需要 |
| 消息格式 | 纯文本 subject + body | Markdown（title + text） | 交互式卡片（header + lark_md） |
| 格式化复杂度 | 低（透传） | 高（17 字符转义、键值对加粗、错误代码块、截断） | 中（键值对加粗、错误代码块、截断，无字符转义） |
| 签名位置 | 不适用 | URL 参数（timestamp + sign） | JSON body（timestamp + sign 字段） |
| 时间戳精度 | 不适用 | 毫秒级 | 秒级 |
| API 响应格式 | SMTP 协议响应 | `{ errcode, errmsg }` | `{ code, msg }` |
| 外部依赖 | nodemailer（延迟导入） | 无（Web Crypto API + fetch 均为内置） | 无（Web Crypto API + fetch 均为内置） |
