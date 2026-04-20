# 通知渠道开发指南

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
    │ SMTP发送  │ │ Webhook  │  │ Webhook  │  │ (未来)   │
    └──────────┘ └──────────┘  └──────────┘ └──────────┘
```

### 1.2 数据流

```
EventPayload
    │
    ▼
renderTemplate(subjectTpl, bodyTpl, variables)  ← template.ts
    │   // variables map 包含：事件数据变量 + Token 聚合变量
    │   // + 内置系统变量（hostname, localIP, osPlatform 等）
    │   // + customVariables（配置文件自定义变量，优先级最高）
    │
    ├─→ subject: string  ("[OpenCode] 任务完成 - my-project")
    └─→ body: string     ("项目: my-project\n时间: ...\n耗时: ...")
    │
    ▼
formatter.format(subject, body, payload)        ← formatters.ts → xxx.ts
    │
    └─→ FormattedMessage { ... }  (渠道特定的消息结构)
    │
    ▼
sender.send(formattedMessage)                   ← xxx.ts → HTTP/SMTP/...
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
| `dingtalk.ts` | 钉钉 Webhook 发送器 + Markdown 格式化器 | **钉钉特有** |
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
| Feishu | `{ msg_type: "interactive", card: { config, header, elements } }` | 飞书交互式卡片消息 |
| 自定义 | 任意 | 由新渠道自行定义 |

---

## 三、从零添加一个新渠道：完整 Checklist

以下是从零开始添加一个新通知渠道（以假想的 "slack" 为例）的完整步骤：

### Step 1: 定义类型 (`src/types.ts`)

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

### Step 2: 实现发送器和格式化器 (`src/slack.ts`)

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

### Step 3: 注册 Formatter (`src/formatters.ts`)

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

### Step 4: 注册 Sender 延迟初始化 (`src/handler.ts`)

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

### Step 5: 加入支持类型白名单 (`src/config.ts`)

```typescript
const SUPPORTED_CHANNEL_TYPES = ['smtp', 'dingtalk', 'slack'] as const;
```

如果不加这一步，用户配置了 `type: 'slack'` 的 channel 时会收到明确的报错信息。

### Step 6: (可选) CLI 支持 (`src/cli.ts`)

如果需要 CLI 测试工具支持新渠道：
- `validateChannelConfig()` 中添加 slack 校验逻辑
- `testConnection()` 中添加 slack webhook 连通性测试
- `sendTestMessage()` 中添加测试消息发送

CLI 代码可以静态 import 新模块（与库代码不同，CLI 独立运行无冲突风险）。

### 需要修改的文件汇总

| 文件 | 改动要点 | 必需 |
|------|---------|------|
| `src/types.ts` | 新增 XxxConfig 接口、加入 ChannelType 和 ChannelConfig 联合类型 | 是 |
| `src/xxx.ts` | 新建文件，实现 `createXxxSender()` + `createXxxFormatter()` | 是 |
| `src/formatters.ts` | 在 `getFormatter()` 中注册新渠道分支，添加 re-export | 是 |
| `src/handler.ts` | 在延迟初始化块中添加 `else if` 分支，动态 import | 是 |
| `src/config.ts` | 在 `SUPPORTED_CHANNEL_TYPES` 数组中添加新类型 | 是 |
| `src/cli.ts` | 添加 validate/testConnection/sendTestMessage（可选） | 否 |
| `tests/xxx.test.ts` | 编写单元测试和集成测试（强烈建议） | 推荐 |

---

## 四、常见陷阱

### 陷阱 1：静态 import 重模块导致 OpenCode 加载阻塞

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

### 陷阱 2：DNS 预解析仅 SMTP 需要

`email.ts` 中的 DNS 预解析（`node:dns/promises.lookup()`）是为了解决代理/TUN 环境下虚假 IP 问题。HTTP 类型的渠道（钉钉、飞书、Slack 等）直接使用域名即可，Node.js 的 `fetch` 会自动处理 DNS 解析。不要在新渠道中复制 DNS 预解析逻辑。

### 陷阱 3：ESM 模块扩展名

本项目使用 `"type": "module"` + `NodeNext` 模块解析。所有相对 import **必须** 带 `.js` 扩展名（即使源文件是 `.ts`）。编译后的产物是 `.js` 文件，所以 import 路径写的是编译后的路径。

```typescript
// 正确
import type { Channel } from './types.js';
const mod = await import('./dingtalk.js');

// 错误（会导致运行时找不到模块）
import type { Channel } from './types';
const mod = await import('./dingtalk');
```

### 陷阱 4：测试中的 mock.module() 模式

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
