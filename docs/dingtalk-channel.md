# 钉钉通道开发文档

本文档面向需要在 `@ulthon/ul-opencode-event` 中添加新通知渠道的开发者。以钉钉（DingTalk）实现为参考案例，说明多通道架构的完整设计。

> 本文档是**开发者参考**，不是用户配置指南。用户配置请参阅 README。

---

## 一、架构总览

### 1.1 核心组件关系

```
                    ┌─────────────────────────────┐
                    │       OpenCode SDK Event     │
                    │  (session.created / idle /   │
                    │   error / question / ...)    │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │        handler.ts            │
                    │      createEventHandler()    │
                    │                             │
                    │  1. 事件过滤 (events config)  │
                    │  2. 模板渲染 (template.ts)   │
                    │  3. 格式化 (formatters.ts)    │
                    │  4. 发送 (ChannelSender)      │
                    └─────┬───────────┬───────────┘
                          │           │
              ┌───────────▼──┐  ┌─────▼──────────┐
              │ ChannelSender│  │ ChannelFormatter│
              │ (发送逻辑)    │  │ (格式转换)       │
              └──────┬───────┘  └──────┬─────────┘
                     │                 │
          ┌──────────┼─────────────────┼──────────┐
          ▼          ▼                 ▼          ▼
    ┌──────────┐ ┌──────────┐  ┌──────────┐ ┌──────────┐
    │ email.ts │ │dingtalk.ts│  │ feishu.ts│  │ xxx.ts   │
    │ SMTP发送  │ │ Webhook  │  │ (未实现)  │  │ (未来)   │
    └──────────┘ └──────────┘  └──────────┘ └──────────┘
```

### 1.2 数据流

```
EventPayload
    │
    ▼
renderTemplate(subjectTpl, bodyTpl, variables)  ← template.ts
    │
    ├─→ subject: string  ("[OpenCode] 任务完成 - my-project")
    └─→ body: string     ("项目: my-project\n时间: ...\n耗时: ...")
    │
    ▼
formatter.format(subject, body, payload)        ← formatters.ts → dingtalk.ts
    │
    └─→ FormattedMessage { msgtype, markdown: { title, text }, at? }
    │
    ▼
sender.send(formattedMessage)                   ← dingtalk.ts → fetch(POST)
```

### 1.3 文件职责表

| 文件 | 职责 | 通用/特有 |
|------|------|-----------|
| `types.ts` | 所有类型定义：Channel、ChannelConfig 联合类型、ChannelSender / ChannelFormatter 接口、EventPayload、各渠道 Config 接口 | **通用** |
| `handler.ts` | 多通道事件分发器。延迟创建 sender，遍历 channels 执行"过滤-渲染-格式化-发送"流水线 | **通用** |
| `formatters.ts` | Formatter 注册中心。`getFormatter(type, channel)` 按渠道类型返回对应 formatter 实例 | **通用** |
| `template.ts` | `{{variable}}` 模板渲染引擎 | **通用** |
| `locales.ts` | i18n 默认模板（zh/en），按事件类型组织 | **通用** |
| `config.ts` | JSON 配置加载、全局+项目合并、校验（含 SUPPORTED_CHANNEL_TYPES 白名单） | **通用** |
| `email.ts` | SMTP 发送器实现。含 DNS 预解析（代理环境适配）、nodemailer 延迟导入 | SMTP 特有 |
| `dingtalk.ts` | 钉钉 Webhook 发送器 + Markdown 格式化器。HmacSHA256 签名、特殊字符转义、截断策略 | **钉钉特有** |
| `cli.ts` | 独立 CLI 测试工具。可静态 import 重模块（与库代码不同） | **通用** |

---

## 二、接口规范

### 2.1 ChannelSender 接口

```typescript
// src/types.ts
export interface ChannelSender {
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
}
```

**使用约定：**

- `send()` 接收 `FormattedMessage` 类型的参数（实际运行时为 `unknown`，由各 sender 内部断言）
- `send()` 必须**静默失败**：捕获所有异常，不向上抛出。仅在 `UL_OPENCODE_EVENT_DEBUG=1` 时输出日志
- `close()` 用于清理资源（SMTP 关闭连接池，HTTP 渠道可为空操作）
- Sender 通过工厂函数创建（如 `createDingTalkSender(channel)`），返回 `Promise<ChannelSender | null>`
- 工厂函数在 channel 校验失败时返回 `null`（而非抛异常），由 handler 静默跳过

**实现新 Sender 的步骤：**

1. 创建 `src/xxx.ts`，导出 `createXxxSender(channel: Channel): Promise<ChannelSender | null>`
2. 校验 `channel.type === 'xxx'` 和 `channel.enabled !== false`
3. 校验必要配置字段存在（webhook URL、token 等）
4. 返回包含 `send` 和 `close` 方法的对象
5. 错误处理模式：

```typescript
// 推荐的错误处理模式（参考 dingtalk.ts send 方法）
send: async (message: unknown): Promise<void> => {
  try {
    // ... 发送逻辑 ...
  } catch (error) {
    // 静默失败 + DEBUG 日志
    if (DEBUG_ENABLED) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} [${channelName}] Failed to send: ${msg}`);
    }
    // 不 rethrow
  }
},
```

### 2.2 ChannelFormatter 接口

```typescript
// src/types.ts
export interface ChannelFormatter {
  format(subject: string, body: string, payload: EventPayload): FormattedMessage;
}

export interface FormattedMessage {
  [key: string]: unknown;  // 渠道特定的消息结构
}
```

**使用约定：**

- `format()` 是**纯函数**：相同输入必须产生相同输出，不可有副作用（不发起网络请求、不修改外部状态）
- 输入 `subject` 和 `body` 是模板渲染后的纯文本字符串
- 输入 `payload` 是原始事件数据，formatter 可根据 payload 内容做条件格式化（如错误事件用代码块包裹）
- 返回值结构由各渠道自行定义（SMTP 返回 `{ subject, text }`，钉钉返回 `{ msgtype, markdown }`）
- Formatter 可以是有状态的闭包（通过工厂函数接收配置），但 `format()` 本身仍须是无副作用的

**实现新 Formatter 的步骤：**

1. 在渠道文件中导出 `createXxxFormatter(config: XxxConfig): ChannelFormatter`
2. `format()` 方法中将 `subject` + `body` 转换为目标平台的消息格式
3. 在 `formatters.ts` 的 `getFormatter()` 中注册新类型分支

```typescript
// formatters.ts 注册示例
export function getFormatter(channelType: ChannelType, channel: Channel): ChannelFormatter | null {
  if (channelType === 'xxx') {
    return createXxxFormatter(channel.config as XxxConfig);
  }
  // ... 其他分支
  return FORMATTER_REGISTRY[channelType] ?? null;
}
```

### 2.3 FormattedMessage 类型

`FormattedMessage` 是一个索引签名接口 `[key: string]: unknown`，不限制具体字段。每个渠道定义自己的消息结构：

| 渠道 | FormattedMessage 结构 | 说明 |
|------|----------------------|------|
| SMTP | `{ subject: string, text: string }` | 直接对应邮件主题和正文 |
| DingTalk | `{ msgtype: "markdown", markdown: { title, text }, at? }` | 钉钉机器人 Markdown 消息体 |
| Feishu | *(待实现)* | 飞书消息结构 |
| 自定义 | 任意 | 由新渠道自行定义 |

---

## 三、钉钉实现细节

本节记录钉钉通道的具体技术实现，供维护和调试参考。

### 3.1 签名算法

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

### 3.2 Markdown 格式化规则

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

### 3.3 HTTP 请求规格

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

### 3.4 错误码处理

钉钉 API 返回的 JSON 包含 `errcode` 和 `errmsg` 字段：

| errcode | 含义 | 处理方式 |
|---------|------|---------|
| 0 | 成功 | 正常结束 |
| 未定义 / 缺失 | 解析失败（非 JSON） | 视为成功（容错） |
| 310000 | 参数不合法 | DEBUG 日志，静默忽略 |
| 400001 | 发送频率超限 | DEBUG 日志，静默忽略 |
| 其他非零值 | 未知错误 | DEBUG 日志，静默忽略 |

**核心原则：所有 API 错误均不向上传播，不阻塞其他渠道的通知发送。**

### 3.5 @人功能

通过 `DingtalkConfig.at` 配置：

```typescript
interface DingtalkConfig {
  webhook: string;
  secret?: string;
  at?: {
    atMobiles?: string;   // 手机号列表，逗号分隔（JSON 中解析为数组）
    atAll?: boolean;      // 是否 @所有人
  };
}
```

Formatter 在构建 `FormattedMessage` 时，如果 `config.at` 存在，将 `at` 对象附加到返回的消息体顶层。Sender 直接将整个 message（含 `at` 字段）序列化为 POST body 发送。

---

## 四、扩展指南

### 4.1 从零添加一个新渠道：Checklist

以下是从零开始添加一个新通知渠道（以假想的 "slack" 为例）的完整步骤：

#### Step 1: 定义类型 (`src/types.ts`)

```typescript
// 1. 在 ChannelType 联合类型中新增
export type ChannelType = 'smtp' | 'feishu' | 'dingtalk' | 'slack';

// 2. 新增 SlackConfig 接口
export interface SlackConfig {
  webhook: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

// 3. 在 ChannelConfig 联合类型中加入
export type ChannelConfig = SMTPConfig | FeishuConfig | DingtalkConfig | SlackConfig;
```

#### Step 2: 实现发送器和格式化器 (`src/slack.ts`)

```typescript
import type { Channel, ChannelSender, ChannelFormatter, FormattedMessage, SlackConfig } from './types.js';

const LOG_PREFIX = '[ul-opencode-event]';
const DEBUG_ENABLED = process.env.UL_OPENCODE_EVENT_DEBUG === '1' || process.env.UL_OPENCODE_EVENT_DEBUG === 'true';

// --- Formatter ---
export function createSlackFormatter(config: SlackConfig): ChannelFormatter {
  return {
    format(subject: string, body: string, _payload: EventPayload): FormattedMessage {
      // 将 subject/body 转换为 Slack Block Kit 或简单文本格式
      return {
        text: `${subject}\n${body}`,
        // ... 其他 Slack 特定字段
      };
    },
  };
}

// --- Sender ---
export async function createSlackSender(channel: Channel): Promise<ChannelSender | null> {
  if (channel.type !== 'slack') return null;
  if (channel.enabled === false) return null;

  const config = channel.config as SlackConfig;
  if (!config.webhook) return null;

  const channelName = channel.name || 'Slack';

  return {
    send: async (message: unknown): Promise<void> => {
      try {
        const response = await fetch(config.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(10_000),
        });
        // 处理响应...
        if (DEBUG_ENABLED) {
          console.info(`${LOG_PREFIX} [${channelName}] Slack message sent`);
        }
      } catch (error) {
        if (DEBUG_ENABLED) {
          console.error(`${LOG_PREFIX} [${channelName}] Failed: ${error}`);
        }
      }
    },
    close: async (): Promise<void> => {
      // HTTP 无持久连接，空操作
    },
  };
}
```

#### Step 3: 注册 Formatter (`src/formatters.ts`)

```typescript
import type { ..., SlackConfig } from './types.js';
import { createSlackFormatter } from './slack.js';

export function getFormatter(channelType: ChannelType, channel: Channel): ChannelFormatter | null {
  if (channelType === 'dingtalk') {
    return createDingTalkFormatter(channel.config as DingtalkConfig);
  }
  if (channelType === 'slack') {
    return createSlackFormatter(channel.config as SlackConfig);  // 新增
  }

  return FORMATTER_REGISTRY[channelType] ?? null;
}

// 新增 re-export
export { createSlackFormatter } from './slack.js';
```

#### Step 4: 注册 Sender 延迟初始化 (`src/handler.ts`)

在 `handle()` 方法的延迟初始化块中增加新的 `else if` 分支：

```typescript
} else if (channel.type === 'slack' && channel.enabled !== false) {
  try {
    const slackModule = await import('./slack.js');
    const sender = await slackModule.createSlackSender(channel);
    if (sender) {
      const key = channel.name || `channel-${i}`;
      senders.set(key, sender);
    }
  } catch {
    // Silently skip
  }
}
```

**重要：必须使用动态 `import('./slack.js')`，不能在文件顶部静态 import。**

#### Step 5: 加入支持类型白名单 (`src/config.ts`)

```typescript
const SUPPORTED_CHANNEL_TYPES = ['smtp', 'dingtalk', 'slack'] as const;
```

如果不加这一步，用户配置了 `type: 'slack'` 的 channel 时会收到明确的报错信息。

#### Step 6: (可选) CLI 支持 (`src/cli.ts`)

如果需要 CLI 测试工具支持新渠道：
- `validateChannelConfig()` 中添加 slack 校验逻辑
- `testConnection()` 中添加 slack webhook 连通性测试
- `sendTestMessage()` 中添加测试消息发送

CLI 代码可以静态 import 新模块（与库代码不同，CLI 独立运行无冲突风险）。

### 4.2 需要修改的文件汇总

| 文件 | 改动要点 | 必需 |
|------|---------|------|
| `src/types.ts` | 新增 XxxConfig 接口、加入 ChannelType 和 ChannelConfig 联合类型 | 是 |
| `src/xxx.ts` | 新建文件，实现 `createXxxSender()` + `createXxxFormatter()` | 是 |
| `src/formatters.ts` | 在 `getFormatter()` 中注册新渠道分支，添加 re-export | 是 |
| `src/handler.ts` | 在延迟初始化块中添加 `else if` 分支，动态 import | 是 |
| `src/config.ts` | 在 `SUPPORTED_CHANNEL_TYPES` 数组中添加新类型 | 是 |
| `src/cli.ts` | 添加 validate/testConnection/sendTestMessage（可选） | 否 |
| `tests/xxx.test.ts` | 编写单元测试和集成测试（强烈建议） | 推荐 |

### 4.3 常见陷阱

**陷阱 1：静态 import 重模块导致 OpenCode 加载阻塞**

库代码（`index.ts`、`handler.ts`、`email.ts`、`dingtalk.ts` 以及任何新渠道文件）中绝不在顶层使用 `import nodemailer` 或 `import fetch` 之类的重模块静态导入。OpenCode 插件系统会在加载时同步执行所有顶层代码，重模块的导入会显著拖慢启动速度。

正确做法：在 handler 的 `handle()` 方法内部使用 `await import('./xxx.js')` 动态导入。

```typescript
// 正确 - handler.ts 中的做法
const xxxModule = await import('./xxx.js');
const sender = await xxxModule.createXxxSender(channel);

// 错误 - 顶层静态导入
import { createXxxSender } from './xxx.js';  // 不要这样做
```

例外：`cli.ts` 是独立运行的命令行工具，不受此限制。

**陷阱 2：DNS 预解析仅 SMTP 需要**

`email.ts` 中的 DNS 预解析（`node:dns/promises.lookup()`）是为了解决代理/TUN 环境下虚假 IP 问题。HTTP 类型的渠道（钉钉、飞书、Slack 等）直接使用域名即可，Node.js 的 `fetch` 会自动处理 DNS 解析。不要在新渠道中复制 DNS 预解析逻辑。

**陷阱 3：ESM 模块扩展名**

本项目使用 `"type": "module"` + `NodeNext` 模块解析。所有相对 import **必须** 带 `.js` 扩展名（即使源文件是 `.ts`）。编译后的产物是 `.js` 文件，所以 import 路径写的是编译后的路径。

```typescript
// 正确
import type { Channel } from './types.js';
const mod = await import('./dingtalk.js');

// 错误（会导致运行时找不到模块）
import type { Channel } from './types';
const mod = await import('./dingtalk');
```

**陷阱 4：测试中的 mock.module() 模式**

Bun 测试中使用 `mock.module()` 替换模块依赖时，必须在动态 `import()` 之前设置 mock，否则模块已经被求值，mock 不会生效：

```typescript
// tests/dingtalk.test.ts 示例模式
import { describe, expect, it, mock } from 'bun:test';

describe('DingTalk sender', () => {
  it('should send message via webhook', async () => {
    // 1. 先设置 mock
    globalThis.fetch = mock(() => ({
      ok: true,
      json: async () => ({ errcode: 0 }),
    }));

    // 2. 再动态 import（确保 mock 生效后再求值）
    const { createDingTalkSender } = await import('../src/dingtalk');

    // 3. 测试
    const sender = await createDingTalkSender({
      type: 'dingtalk',
      enabled: true,
      config: { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=test' },
      events: {},
    });

    expect(sender).not.toBeNull();
    await sender!.send({ msgtype: 'markdown', markdown: { title: 'test', text: 'hello' } });
  });
});
```

---

## 五、配置 Schema

### 5.1 DingtalkConfig 完整 JSON Schema

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
          "oneOf": [
            { "type": "string", "description": "手机号，逗号分隔" },
            { "type": "array", "items": { "type": "string" } }
          ]
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

### 5.2 Channel 接口字段映射（钉钉相关）

| Channel 字段 | 类型 | 钉钉场景下的含义 | 默认值 |
|-------------|------|-----------------|--------|
| `type` | `'dingtalk'` | 固定值 | 必填 |
| `enabled` | boolean | 是否启用该通道 | `true`（省略视为启用） |
| `name` | string | 通道标识名，用于日志和按 name 合并配置 | `'DingTalk'` |
| `config.webhook` | string | 机器人 Webhook URL | 必填 |
| `config.secret` | string | 签名密钥 | 可选（不加签模式可不填） |
| `config.at.atMobiles` | string \| string[] | @人的手机号 | 可选 |
| `config.at.atAll` | boolean | 是否 @所有人 | 可选 |
| `recipients` | string[] | 钉钉场景下**不使用**（通过 webhook 目标群隐式确定接收者） | 忽略 |
| `events` | EventConfig | 各事件开关 | 见 EventType 默认值 |
| `templates` | ChannelTemplates | 自定义模板（subject/body） | 使用 locales.ts 默认模板 |

注意：`recipients` 字段在钉钉场景下没有实际作用。钉钉的接收者是 Webhook 所指向的群组全体成员（可通过 `at` 字段精确 @特定人）。

### 5.3 与 SMTP Config 对比

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
