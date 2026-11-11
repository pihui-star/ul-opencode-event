# 配置指南

本文档介绍 `@ulthon/ul-opencode-event` 的完整配置指南，包括配置文件位置、合并规则、事件配置、模板系统（语法、变量、默认模板、通道差异）和调试模式。

各通知通道的具体配置请参考对应文档：
- [SMTP 邮件通道配置](channels/smtp-channel.md)
- [钉钉机器人通道配置](channels/dingtalk-channel.md)
- [飞书机器人通道配置](channels/feishu-channel.md)
- [文件通道配置](channels/file-channel.md)

---

## 1. 配置文件位置

插件按以下优先级查找配置文件：

| 优先级 | 级别 | 路径 |
|--------|------|------|
| 1（最高） | 项目级 | `.opencode/ul-opencode-event.json` |
| 2 | 项目级 | `./ul-opencode-event.json`（项目根目录） |
| 3 | 全局级 | `~/.config/opencode/ul-opencode-event.json` |

### 各操作系统全局配置路径

- **macOS / Linux**: `~/.config/opencode/ul-opencode-event.json`
- **Windows**: `%USERPROFILE%\.config\opencode\ul-opencode-event.json`

> **提示**：全局配置适合所有项目共享通知通道，项目配置适合为单个项目定制。两者可以共存，项目配置优先于全局配置。

---

## 2. 配置合并规则

当全局配置和项目配置同时存在时，按以下规则合并：

### 通道合并

通道按 `name` 字段匹配合并：

- **同名通道**：项目配置完全覆盖全局配置（整体替换，非深度合并）
- **不同名通道**：追加到一起

**示例**：

```
全局配置：通道 A、通道 B
项目配置：通道 B、通道 C
最终生效：A（全局）+ B（项目覆盖）+ C（项目新增）
```

### 顶层字段合并

顶层字段（`language`、`timezone`、`auto_update`、`projectName`）的合并规则：项目配置优先，项目配置未指定时使用全局配置。

### 启用过滤

`enabled: false` 的通道会被过滤掉，不会进入最终配置。

---

## 3. 事件配置

插件支持以下事件类型，每个通道可以独立配置需要通知的事件：

| 事件名 | 默认值 | 说明 |
|--------|--------|------|
| `created` | `true` | 新会话创建 |
| `idle` | `true` | 会话完成（AI 完成响应） |
| `error` | `true` | 会话出错 |
| `question` | `true` | AI 提问 |
| `permission` | `true` | 权限确认请求 |
| `status` | `false` | 状态变化 |
| `command` | `false` | 命令执行 |
| `fileEdited` | `false` | 文件修改 |
| `todo` | `false` | Todo 列表更新 |

### 按通道配置事件

每个通道可以在 `events` 字段中覆盖默认值：

```json
{
  "channels": [
    {
      "type": "smtp",
      "name": "工作邮箱",
      "events": {
        "idle": true,
        "error": true,
        "created": false
      }
    },
    {
      "type": "dingtalk",
      "name": "钉钉通知",
      "events": {
        "idle": true,
        "error": true,
        "created": true,
        "todo": true
      }
    }
  ]
}
```

未在 `events` 中显式指定的事件，按上表默认值处理。

---

## 4. 模板系统概述

插件使用 `{{variableName}}` 占位符语法渲染通知内容。模板分为两个层级：

| 层级 | 来源 | 优先级 |
|------|------|--------|
| 通道自定义模板 | 配置文件中每个 channel 的 `templates` 字段 | 高（优先使用） |
| 语言默认模板 | 根据 `language` 配置自动选择 `zh` 或 `en` 内置模板 | 低（兜底） |

**解析流程**：发送通知时，插件先查找当前通道是否为该事件类型配置了自定义模板；如果没有，则使用 `language` 对应的内置默认模板。

### 变量来源与优先级

模板变量的值来自多个来源，按以下优先级合并（后出现的覆盖先出现的）：

1. **事件数据变量** - 来自 SDK 事件（eventType, sessionId, duration 等）
2. **Token 聚合变量** - 自动计算（session/total/project 级别）
3. **内置系统变量** - 自动收集（hostname, osPlatform, localIP 等）
4. **自定义变量** - 来自配置文件 `customVariables` 字段（优先级最高，可覆盖上述所有变量）

---

## 5. 语言设置

通过顶层 `language` 字段控制默认模板语言。

```json
{
  "language": "zh",
  "channels": [...]
}
```

| 值 | 默认模板语言 |
|----|------------|
| `"zh"` | 中文模板 |
| `"en"` | 英文模板（默认） |
| 未设置 | 等同于 `"en"` |

`language` 同时影响默认时区推断：`zh` 默认 `Asia/Shanghai`，`en` 默认 `America/New_York`。如果显式配置了 `timezone`，则以 `timezone` 为准。

---

## 6. 模板语法

模板为纯文本，支持 `{{variableName}}` 占位符：

```
任务完成时间: {{timestamp}}
项目: {{projectName}}
耗时: {{duration}}
```

规则：
- 占位符名称只含字母和数字（`\w+`）
- 未匹配到值的变量会被替换为空字符串（不会保留 `{{...}}` 原文）
- 不支持条件判断、循环等逻辑

---

## 7. 模板配置结构

每个通道的 `templates` 字段按事件类型组织：

```typescript
interface TemplateConfig {
  subject?: string;   // 邮件主题（仅 SMTP 通道生效）
  body?: string;      // 通知正文
}

interface ChannelTemplates {
  created?: TemplateConfig;
  idle?: TemplateConfig;
  error?: TemplateConfig;
  question?: TemplateConfig;
  permission?: TemplateConfig;
  status?: TemplateConfig;
  command?: TemplateConfig;
  fileEdited?: TemplateConfig;
  todo?: TemplateConfig;
}
```

只需配置需要覆盖的事件类型，未配置的事件类型自动使用默认模板。

---

## 8. 全部可用变量

### 8.1 通用变量（所有事件类型可用）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{eventType}}` | 事件类型名称 | `idle`、`error`、`question` |
| `{{timestamp}}` | 事件发生时间（ISO 8601） | `2026-04-08T14:30:00.000Z` |
| `{{projectName}}` | 项目短名称（目录名或配置值） | `my-project` |
| `{{projectPath}}` | 项目完整路径 | `/home/user/my-project` |
| `{{sessionId}}` | 会话 ID | `ses_abc123` |
| `{{sessionTitle}}` | 会话标题（来自 SDK Session.title） | `Fix auth bug` |
| `{{sessionType}}` | 会话类型 | `main`、`subagent`、`unknown` |
| `{{parentSessionId}}` | 父会话 ID（子代理事件时有值，主会话为空） | `ses_parent456` |
| `{{hostname}}` | 主机名 | `DESKTOP-ABC` |
| `{{osType}}` | 操作系统类型 | `Windows_NT` |
| `{{osPlatform}}` | 平台标识 | `win32` |
| `{{osRelease}}` | 系统版本 | `10.0.19045` |
| `{{osArch}}` | CPU 架构 | `x64` |
| `{{username}}` | 当前用户名 | `augushong` |
| `{{nodeVersion}}` | Node.js 版本 | `v22.1.0` |
| `{{pluginVersion}}` | 插件版本 | `0.1.52` |
| `{{opencodeVersion}}` | OpenCode 版本 | `1.0.0` |
| `{{localIP}}` | 本机 IP（第一个非内部 IPv4 地址） | `192.168.1.100` |
| `{{processPid}}` | 进程 PID | `12345` |
| `{{systemUptime}}` | 系统运行时间 | `3d 5h 20m` |
| `{{sessionCacheHitRate}}` | 当前会话缓存命中率 | `89.5%` |
| `{{totalCacheHitRate}}` | 会话及所有子会话的缓存命中率 | `92.3%` |
| `{{projectCacheHitRate}}` | 项目范围内所有会话的缓存命中率 | `85.1%` |

> **关于 `projectName`**：`projectName` 显示项目的短名称（目录名），而非完整路径。可通过配置文件顶层 `"projectName": "自定义名称"` 字段覆盖自动取值。如需完整路径，请使用 `{{projectPath}}`。

### 8.2 各事件类型特有变量

#### `idle` - 任务完成

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{message}}` | 完成消息 | `Task completed successfully` |
| `{{duration}}` | 任务耗时 | `2m30s` |

#### `error` - 任务出错

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{error}}` | 错误信息 | `TypeError: Cannot read property...` |

#### `question` - AI 提问

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{title}}` | 问题标题 | `Choose implementation approach` |
| `{{questionText}}` | 完整问题文本 | `Which approach do you prefer?...` |
| `{{options}}` | 选项摘要（JSON） | `["Option A","Option B"]` |

#### `permission` - 权限确认

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{title}}` | 权限请求标题 | `Execute bash command` |
| `{{permissionType}}` | 权限类型 | `bash`、`edit` |

#### `status` - 状态变更

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{statusType}}` | 新状态 | `idle`、`busy`、`retry` |

#### `command` - 命令执行

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{commandName}}` | 命令名称 | `git commit` |
| `{{arguments}}` | 命令参数 | `-m "fix: auth bug"` |

#### `fileEdited` - 文件编辑

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{filePath}}` | 被编辑的文件路径 | `src/auth/login.ts` |

#### `todo` - Todo 更新

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{todoSummary}}` | Todo 列表摘要文本 | 多行文本 |

#### `created` - 会话创建

无特有变量，仅使用通用变量。

### 8.3 Token 与费用变量（所有事件类型可用）

以下变量用于展示 Token 用量、费用和模型信息。在自定义模板中可以按需使用。

> **注意**：sessionTokens 在 AI 回复中间可能为 0（OpenCode 限制）。totalTokens 始终反映已完成工作的累计值。详见 [中间事件 Token 为 0](issues/token-zero-on-mid-event.md)。

#### 会话级别（最近一次 API 调用的 token 快照）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{sessionTokensTotal}}` | 最近一次 API 调用的 Token 总计（input+output+cacheRead+cacheWrite，不含 reasoning） | `420` |
| `{{sessionTokensInput}}` | 最近一次 API 调用的输入 Token 数 | `100` |
| `{{sessionTokensOutput}}` | 最近一次 API 调用的输出 Token 数 | `200` |
| `{{sessionTokensReasoning}}` | 最近一次 API 调用的推理 Token 数 | `50` |
| `{{sessionTokensCacheRead}}` | 最近一次 API 调用的缓存读取 Token 数 | `30` |
| `{{sessionTokensCacheWrite}}` | 最近一次 API 调用的缓存写入 Token 数 | `40` |
| `{{sessionCost}}` | 当前会话累计费用（原始数值） | `0.05` |
| `{{sessionCostFormatted}}` | 当前会话累计费用（格式化，含货币符号） | `$0.0500` |

#### 总计级别（当前会话及所有子会话的累计计费总量）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{totalTokensTotal}}` | 当前会话及所有子会话的累计 Token 总计 | `990` |
| `{{totalTokensInput}}` | 当前会话及所有子会话的累计输入 Token 数 | `300` |
| `{{totalTokensOutput}}` | 当前会话及所有子会话的累计输出 Token 数 | `400` |
| `{{totalTokensReasoning}}` | 当前会话及所有子会话的累计推理 Token 数 | `100` |
| `{{totalTokensCacheRead}}` | 当前会话及所有子会话的累计缓存读取 Token 数 | `60` |
| `{{totalTokensCacheWrite}}` | 当前会话及所有子会话的累计缓存写入 Token 数 | `130` |
| `{{totalCost}}` | 当前会话及所有子会话的累计费用（原始数值） | `0.12` |
| `{{totalCostFormatted}}` | 当前会话及所有子会话的累计费用（格式化，含货币符号） | `$0.1200` |

#### 项目级别（当前项目路径下所有会话的累计计费总量）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{projectTokensTotal}}` | 当前项目所有会话的累计 Token 总计 | `2500` |
| `{{projectTokensInput}}` | 当前项目所有会话的累计输入 Token 数 | `800` |
| `{{projectTokensOutput}}` | 当前项目所有会话的累计输出 Token 数 | `1000` |
| `{{projectTokensReasoning}}` | 当前项目所有会话的累计推理 Token 数 | `200` |
| `{{projectTokensCacheRead}}` | 当前项目所有会话的累计缓存读取 Token 数 | `150` |
| `{{projectTokensCacheWrite}}` | 当前项目所有会话的累计缓存写入 Token 数 | `350` |
| `{{projectCost}}` | 当前项目所有会话的累计费用（原始数值） | `0.35` |
| `{{projectCostFormatted}}` | 当前项目所有会话的累计费用（格式化，含货币符号） | `$0.3500` |

#### 模型与配置

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{modelID}}` | 当前使用的模型标识 | `claude-sonnet-4`、`gpt-4o` |
| `{{providerID}}` | 模型提供商标识 | `anthropic`、`openai` |
| `{{mode}}` | 运行模式 | `plan`、`code` |
| `{{currency}}` | 货币符号 | `$`、`¥` |

> **关于三级 Token 变量的区别**：三个级别采用不同的计算策略：
>
> - **会话级别**（`session*`）：取当前会话**最近一次 API 调用**的 Token 值（快照），与 OpenCode UI 显示一致。反映单次请求的 token 消耗。
> - **总计级别**（`total*`）：将当前会话及所有子会话（explore/librarian 等子代理）的**每次 API 调用的 Token 值累加**，是累计计费总量。由于每次 API 调用都会读取缓存（cacheRead），多轮对话后该值会远大于会话级别。
> - **项目级别**（`project*`）：将当前项目路径下**所有会话**的累计 Token 值再累加，是项目整体计费总量。
>
> 因此，即使没有子会话，`total*` 通常也会大于 `session*`（因为多次 API 调用的 token 被累加，尤其是 cacheRead）。
>
> **关于费用格式化**：`sessionCostFormatted`、`totalCostFormatted` 和 `projectCostFormatted` 根据 `currency` 变量自动选择货币符号和格式。中文环境（`language: "zh"`）使用 `¥`，英文环境使用 `$`。

### 8.4 请求计数变量 (Request Count Variables)

| 模板变量 | 说明 |
|----------|------|
| `{{sessionRequestCount}}` | 当前会话 API 请求次数（assistant 消息数） |
| `{{totalRequestCount}}` | 总计 API 请求次数（含所有子会话） |
| `{{projectRequestCount}}` | 项目累计 API 请求次数（跨所有会话） |

> **created 事件**：仅项目级 `{{projectRequestCount}}` 有值；会话级和总计级在此事件中未定义（与 Token 变量行为一致）。

### 8.5 Token 格式化变量（人类可读，所有事件类型可用）

以下变量将原始 Token 数值格式化为人类可读的字符串，使用 K/M/B 后缀 + 1 位小数。默认模板使用这些格式化变量。

#### 会话级别格式化

| 变量 | 说明 | 原始值示例 | 格式化结果 |
|------|------|-----------|-----------|
| `{{sessionTokensTotalHuman}}` | 会话合计 Token（格式化） | `127100` | `127.1K` |
| `{{sessionTokensInputHuman}}` | 会话输入 Token（格式化） | `30100` | `30.1K` |
| `{{sessionTokensOutputHuman}}` | 会话输出 Token（格式化） | `60000` | `60.0K` |
| `{{sessionTokensReasoningHuman}}` | 会话推理 Token（格式化） | `5000` | `5.0K` |
| `{{sessionTokensCacheReadHuman}}` | 会话缓存读取 Token（格式化） | `10000` | `10.0K` |
| `{{sessionTokensCacheWriteHuman}}` | 会话缓存写入 Token（格式化） | `22000` | `22.0K` |

#### 全部级别格式化

| 变量 | 说明 | 原始值示例 | 格式化结果 |
|------|------|-----------|-----------|
| `{{totalTokensTotalHuman}}` | 全部合计 Token（格式化） | `990000` | `990.0K` |
| `{{totalTokensInputHuman}}` | 全部输入 Token（格式化） | `100000` | `100.0K` |
| `{{totalTokensOutputHuman}}` | 全部输出 Token（格式化） | `200000` | `200.0K` |
| `{{totalTokensReasoningHuman}}` | 全部推理 Token（格式化） | `50000` | `50.0K` |
| `{{totalTokensCacheReadHuman}}` | 全部缓存读取 Token（格式化） | `60000` | `60.0K` |
| `{{totalTokensCacheWriteHuman}}` | 全部缓存写入 Token（格式化） | `130000` | `130.0K` |

#### 项目级别格式化

| 变量 | 说明 | 原始值示例 | 格式化结果 |
|------|------|-----------|-----------|
| `{{projectTokensTotalHuman}}` | 项目合计 Token（格式化） | `2500000` | `2.5M` |
| `{{projectTokensInputHuman}}` | 项目输入 Token（格式化） | `800000` | `800.0K` |
| `{{projectTokensOutputHuman}}` | 项目输出 Token（格式化） | `1000000` | `1.0M` |
| `{{projectTokensReasoningHuman}}` | 项目推理 Token（格式化） | `200000` | `200.0K` |
| `{{projectTokensCacheReadHuman}}` | 项目缓存读取 Token（格式化） | `150000` | `150.0K` |
| `{{projectTokensCacheWriteHuman}}` | 项目缓存写入 Token（格式化） | `350000` | `350.0K` |

> **格式化规则**：小于 1000 的数值原样显示（如 `420`）；1000 及以上使用 K（千）、M（百万）、B（十亿）后缀 + 1 位小数（如 `127.1K`、`1.5M`、`2.0B`）。如需精确数值，请在自定义模板中使用对应的原始变量（如 `{{sessionTokensTotal}}`）。

### 8.6 变量速查表

| 事件类型 | 可用变量 |
|---------|---------|
| `created` | 通用变量 |
| `idle` | 通用变量 + `message` + `duration` |
| `error` | 通用变量 + `error` |
| `question` | 通用变量 + `title` + `questionText` + `options` |
| `permission` | 通用变量 + `title` + `permissionType` |
| `status` | 通用变量 + `statusType` |
| `command` | 通用变量 + `commandName` + `arguments` |
| `fileEdited` | 通用变量 + `filePath` |
| `todo` | 通用变量 + `todoSummary` |

---

## 9. 配置示例

### 9.1 自定义 SMTP 邮件模板

```json
{
  "language": "zh",
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "工作邮箱",
      "config": {
        "host": "smtp.qq.com",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "your@qq.com",
          "pass": "your-authorization-code"
        }
      },
      "recipients": ["admin@example.com"],
      "events": {
        "idle": true,
        "error": true,
        "question": true
      },
      "templates": {
        "idle": {
          "subject": "[完成] {{projectName}} - {{duration}}",
          "body": "任务已完成\n\n项目: {{projectName}}\n会话: {{sessionTitle}}\n耗时: {{duration}}\n消息: {{message}}\n时间: {{timestamp}}"
        },
        "error": {
          "subject": "[错误] {{projectName}}",
          "body": "任务出错\n\n项目: {{projectName}}\n会话: {{sessionTitle}}\n错误: {{error}}\n时间: {{timestamp}}"
        },
        "question": {
          "subject": "[提问] {{projectName}} - {{title}}",
          "body": "AI 需要您的确认\n\n项目: {{projectName}}\n会话: {{sessionTitle}}\n问题: {{title}}\n{{questionText}}\n时间: {{timestamp}}"
        }
      }
    }
  ]
}
```

### 9.2 自定义钉钉模板（仅 body，无 subject）

钉钉通道只使用 `body` 字段，支持 Markdown 子集语法：

```json
{
  "channels": [
    {
      "type": "dingtalk",
      "enabled": true,
      "name": "钉钉通知",
      "config": {
        "webhook": "https://oapi.dingtalk.com/robot/send?access_token=xxx",
        "secret": "SEC-xxx"
      },
      "events": {
        "idle": true,
        "error": true
      },
      "templates": {
        "idle": {
          "body": "### 任务完成\n\n**项目**: {{projectName}}\n**耗时**: {{duration}}\n**消息**: {{message}}\n\n> {{timestamp}}"
        },
        "error": {
          "body": "### 任务错误\n\n**项目**: {{projectName}}\n**错误**: {{error}}\n\n> {{timestamp}}"
        }
      }
    }
  ]
}
```

> **注意**: 钉钉 Markdown 不支持表格、代码块高亮和 HTML 标签。支持的语法包括标题（`#`）、加粗（`**text**`）、引用（`>`）、列表和链接。

### 9.3 自定义飞书模板（仅 body，lark_md 格式）

飞书通道只使用 `body` 字段，支持 lark_md（飞书 Markdown）语法：

```json
{
  "channels": [
    {
      "type": "feishu",
      "enabled": true,
      "name": "飞书通知",
      "config": {
        "webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
        "secret": "your-secret"
      },
      "events": {
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

> **注意**: 飞书 lark_md 支持标准 Markdown 语法（加粗、链接、代码块等），不需要像钉钉那样转义特殊字符。

### 9.4 部分覆盖（只自定义特定事件）

只需覆盖想修改的事件类型，其他事件自动使用默认模板：

```json
{
  "language": "zh",
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "邮箱",
      "config": { "host": "smtp.qq.com", "port": 465, "secure": true, "auth": { "user": "your@qq.com", "pass": "xxx" } },
      "recipients": ["admin@example.com"],
      "events": { "idle": true, "error": true },
      "templates": {
        "error": {
          "subject": "!!! 紧急 - {{projectName}} 出错",
          "body": "紧急错误通知\n\n项目: {{projectName}}\n错误: {{error}}\n时间: {{timestamp}}"
        }
      }
    }
  ]
}
```

上例中，`error` 事件使用自定义模板，`idle` 事件使用中文默认模板。

### 9.5 自定义变量配置

通过顶层 `customVariables` 字段添加自定义模板变量，所有通道共享：

```json
{
  "customVariables": {
    "env": "production",
    "team": "backend"
  },
  "channels": [...]
}
```

在模板中使用：

```
环境: {{env}}
团队: {{team}}
主机: {{hostname}}
```

自定义变量支持嵌套引用内置变量（单层）：

```json
{
  "customVariables": {
    "serverLabel": "{{hostname}}-{{env}}"
  }
}
```

`serverLabel` 会被渲染为类似 `DESKTOP-ABC-production` 的值。

#### 合并规则

全局和项目配置都有 `customVariables` 时，按 `{ ...global, ...project }` 合并，项目级同名 key 覆盖全局级。

```json
// 全局配置
{
  "customVariables": {
    "env": "production",
    "region": "us-east"
  }
}

// 项目配置
{
  "customVariables": {
    "env": "staging",
    "project": "my-app"
  }
}

// 最终生效：{ "env": "staging", "region": "us-east", "project": "my-app" }
```

#### 规则

- 变量名必须匹配 `/^\w+$/`（字母、数字、下划线）
- 值必须为字符串
- 自定义变量可以覆盖内置变量的值（允许）
- 仅支持静态值，不支持环境变量展开
- 嵌套引用仅支持单层（自定义变量引用内置变量，不能引用其他自定义变量）

---

## 10. 内置默认模板参考

### 10.1 中文默认模板（`language: "zh"`）

#### created - 会话创建

```
Subject: [{{projectName}}] 任务已启动
Body:
任务启动时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})

Req({{projectRequestCount}}) {{modelID}}
```

#### idle - 任务完成

```
Subject: [{{projectName}}] 任务已完成
Body:
任务完成时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
消息: {{message}}
耗时: {{duration}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### error - 任务出错

```
Subject: [{{projectName}}] 任务出错
Body:
错误发生时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
错误信息: {{error}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### question - AI 提问

```
Subject: [{{projectName}}] AI 提问
Body:
OpenCode 在 {{timestamp}} 向您提问
会话: {{sessionTitle}} ({{sessionId}})
问题: {{title}}
{{questionText}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### permission - 权限确认

```
Subject: [{{projectName}}] 需要权限确认
Body:
{{timestamp}} 需要权限确认
会话: {{sessionTitle}} ({{sessionId}})
{{title}} ({{permissionType}})

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### status - 状态变更

```
Subject: [{{projectName}}] 状态变更
Body:
会话状态变更时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
状态: {{statusType}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### command - 命令执行

```
Subject: [{{projectName}}] 命令已执行
Body:
命令执行时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
命令: {{commandName}} {{arguments}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### fileEdited - 文件编辑

```
Subject: [{{projectName}}] 文件已编辑
Body:
文件编辑时间: {{timestamp}}
文件: {{filePath}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### todo - Todo 更新

```
Subject: [{{projectName}}] Todo 已更新
Body:
Todo 更新时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
{{todoSummary}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

### 10.2 英文默认模板（`language: "en"`）

#### created - Session Created

```
Subject: [{{projectName}}] Task Started
Body:
Task started at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})

Req({{projectRequestCount}}) {{modelID}}
```

#### idle - Task Completed

```
Subject: [{{projectName}}] Task Completed
Body:
Task completed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Message: {{message}}
Duration: {{duration}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### error - Task Error

```
Subject: [{{projectName}}] Task Error
Body:
Error at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Error: {{error}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### question - Question

```
Subject: [{{projectName}}] Question
Body:
OpenCode has a question at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Question: {{title}}
{{questionText}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### permission - Permission Required

```
Subject: [{{projectName}}] Permission Required
Body:
Permission needed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
{{title}} ({{permissionType}})

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### status - Status Change

```
Subject: [{{projectName}}] Status Change
Body:
Session status changed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Status: {{statusType}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### command - Command Executed

```
Subject: [{{projectName}}] Command Executed
Body:
Command executed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Command: {{commandName}} {{arguments}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### fileEdited - File Edited

```
Subject: [{{projectName}}] File Edited
Body:
File edited at {{timestamp}}
File: {{filePath}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

#### todo - Todos Updated

```
Subject: [{{projectName}}] Todos Updated
Body:
Todos updated at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
{{todoSummary}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})
Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}
```

---

## 11. 通道差异说明

### 11.1 通道模板差异对比

| 维度 | SMTP | DingTalk | Feishu |
|------|------|----------|--------|
| `subject` 字段 | 使用（邮件主题） | 格式化为 `###` 标题后前置到消息正文 | 格式化为 card header title |
| `body` 字段 | 纯文本 | Markdown 子集 | lark_md（标准 Markdown） |
| 变量渲染 | 透传，原样输出 | 特殊字符自动转义（17 个字符） | 透传，原样输出 |
| 内容截断 | 无 | body 最大 4000 字符，超长截断 | body 最大 4000 字符 |
| 主题截断 | 无 | title 最大 100 字符 | 无 |

### 11.2 钉钉 Markdown 注意事项

编写钉钉自定义模板时注意：
- 不支持表格、代码块语法高亮、HTML 标签
- 变量值中的特殊字符（如 `*`、`[`、`]`）会被自动转义，无需手动处理
- 建议使用 `**key**: value` 格式突出关键信息

---

## 12. 常见问题

**Q: 变量没有被替换，原样输出了 `{{xxx}}`？**

A: 检查变量名拼写是否正确（区分大小写），参考第八节变量列表。如果该事件类型没有对应的变量值，占位符会被替换为空字符串（不会保留原文）。

**Q: 修改模板后需要重启吗？**

A: 是的。配置文件在插件加载时读取，修改后需要重启 OpenCode 会话才能生效。

**Q: 不同通道可以使用不同的模板吗？**

A: 可以。每个通道（channel）有独立的 `templates` 字段，互不影响。例如 SMTP 用详细的纯文本模板，钉钉用简洁的 Markdown 模板。

**Q: `language` 设置和 `templates` 是什么关系？**

A: `language` 决定未配置自定义模板时使用的内置默认模板语言（`zh` 或 `en`）。如果通道为某个事件类型配置了 `templates`，则自定义模板优先，`language` 设置对该事件不生效。

**Q: `projectName` 显示的是什么？**

A: `projectName` 显示项目的短名称（即项目目录的 basename，如 `/home/user/my-project` 中的 `my-project`）。可通过配置文件顶层字段 `"projectName": "自定义名称"` 覆盖。如需显示完整路径，使用 `{{projectPath}}` 变量。

**Q: 可以只覆盖 `subject` 而不覆盖 `body` 吗？**

A: 可以。`subject` 和 `body` 是独立配置的。例如只设置 `"subject": "自定义主题"` 而不提供 `body`，则 `subject` 使用自定义值，`body` 使用默认模板。

**Q: 变量值为空时会怎样？**

A: 占位符被替换为空字符串。例如 `{{parentSessionId}}` 在主会话事件中为空，模板中 `父会话: {{parentSessionId}}` 会渲染为 `父会话: `。如需隐藏空值行，建议在自定义模板中移除对应行。

**Q: 如何使用自定义变量？**

A: 在配置文件顶层添加 `customVariables` 字段，键值对形式，值为字符串。例如 `{"env": "production"}`，然后在模板中用 `{{env}}` 引用。自定义变量优先级最高，可以覆盖内置变量的值。详见 [9.5 自定义变量配置](#95-自定义变量配置)。

**Q: 自定义变量会记录到本地文件吗？**

A: 会。`recorder.ts` 会记录所有模板变量（包括自定义变量和内置系统变量）到 `ul-opencode-event-variables.jsonl`。调试时可通过 `jq` 筛选查看。

---

## 13. 顶层配置字段

以下字段在配置文件的顶层配置：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `projectName` | string | 目录名（basename） | 项目简称，用于通知模板中的 `{{projectName}}` 变量 |
| `language` | `"zh"` \| `"en"` | `"en"` | 默认模板语言，影响所有未自定义模板的通道 |
| `timezone` | string | 根据 `language` 推断 | IANA 时区标识符，如 `"Asia/Shanghai"` |
| `auto_update` | boolean | `true` | 是否自动检查并安装新版本 |
| `includeSessionTypes` | string[] | `["main"]` | 包含的会话类型，可选值：`"main"`、`"subagent"`、`"unknown"` |
| `customVariables` | Record<string, string> | `{}` | 自定义模板变量，所有通道共享。项目级同名 key 覆盖全局级 |

### 配置示例

```json
{
  "projectName": "my-project",
  "language": "zh",
  "timezone": "Asia/Shanghai",
  "auto_update": true,
  "includeSessionTypes": ["main"],
  "customVariables": {
    "env": "production"
  },
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "通知邮箱",
      "config": { "..." : "..." },
      "recipients": ["admin@example.com"],
      "events": {
        "idle": true,
        "error": true
      }
    }
  ]
}
```

---

## 14. 插件安装

插件由 OpenCode 自动管理安装和更新，无需手动 `npm install`。

> **环境要求**：OpenCode 2.x（v2 插件 API）。v2 不再运行 v1 插件实现，OpenCode 1.x 无法使用本插件。

### 安装方式

在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugins": ["@ulthon/ul-opencode-event"]
}
```

OpenCode 启动时自动从 npm 拉取插件并安装到 OpenCode 的包缓存目录中，后续也由自动更新机制维护版本
（`opencode plugin update`）。

> **不要全局安装**（`npm install -g`）。全局安装的副本不会被 OpenCode 加载，也不会被自动更新。

### 全局配置与项目配置

插件安装方式与配置文件级别无关。无论怎样安装，都可以同时使用全局和项目级配置：

- **全局配置**：`~/.config/opencode/ul-opencode-event.json`，所有项目共享
- **项目配置**：项目目录下 `.opencode/ul-opencode-event.json` 或 `./ul-opencode-event.json`，按通道 `name` 合并

合并规则如下：

1. 通道按 `name` 字段合并（见[配置合并规则](#2-配置合并规则)）
2. 顶层字段以项目配置为准
3. `enabled: false` 的通道会被过滤

> **典型场景**：全局配置一个 SMTP 通道用于所有项目，某个项目额外配置一个钉钉通道用于团队通知。

---

## 15. 调试模式

通过环境变量启用调试模式，获取详细日志信息：

```bash
UL_OPENCODE_EVENT_DEBUG=1 npx @ulthon/ul-opencode-event test
```

调试模式会启用以下内容：

- 详细的配置加载日志（配置文件路径、通道数量）
- 通道初始化和发送过程的详细输出
- 错误堆栈跟踪信息

日志文件默认写入 `~/.local/share/opencode/ul-opencode-event.log`，支持自动轮转（2MB 上限）。

---

## 相关文档

- [SMTP 邮件通道配置](channels/smtp-channel.md)
- [钉钉机器人通道配置](channels/dingtalk-channel.md)
- [飞书机器人通道配置](channels/feishu-channel.md)
- [文件通道配置](channels/file-channel.md)
- [通道开发指南](channels/channel-development.md)
- [事件数据流架构](architecture/event-data-flow.md)
