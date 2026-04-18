# 模板配置文档

本文档介绍通知模板系统的配置方法，包括模板语法、可用变量、语言设置以及通道差异。

---

## 一、模板系统概述

插件使用 `{{variableName}}` 占位符语法渲染通知内容。模板分为两个层级：

| 层级 | 来源 | 优先级 |
|------|------|--------|
| 通道自定义模板 | 配置文件中每个 channel 的 `templates` 字段 | 高（优先使用） |
| 语言默认模板 | 根据 `language` 配置自动选择 `zh` 或 `en` 内置模板 | 低（兜底） |

**解析流程**：发送通知时，插件先查找当前通道是否为该事件类型配置了自定义模板；如果没有，则使用 `language` 对应的内置默认模板。

---

## 二、语言设置

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

## 三、模板语法

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

## 四、模板配置结构

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

## 五、全部可用变量

### 5.1 通用变量（所有事件类型可用）

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

> **关于 `projectName`**：`projectName` 显示项目的短名称（目录名），而非完整路径。可通过配置文件顶层 `"projectName": "自定义名称"` 字段覆盖自动取值。如需完整路径，请使用 `{{projectPath}}`。

### 5.2 各事件类型特有变量

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

### 5.3 Token 与费用变量（所有事件类型可用）

以下变量用于展示 Token 用量、费用和模型信息。在自定义模板中可以按需使用。

> **已知限制**：在 AI 回复中间触发的事件（如 `question`、`status`）中，这些变量可能为 0。详见 [已知问题：中间事件 Token 为 0](issues/token-zero-on-mid-event.md)。

#### 会话级别（当前会话的数据）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{sessionTokensTotal}}` | 会话合计 Token 数 | `420` |
| `{{sessionTokensInput}}` | 会话输入 Token 数 | `100` |
| `{{sessionTokensOutput}}` | 会话输出 Token 数 | `200` |
| `{{sessionTokensReasoning}}` | 会话推理 Token 数 | `50` |
| `{{sessionTokensCacheRead}}` | 会话缓存读取 Token 数 | `30` |
| `{{sessionTokensCacheWrite}}` | 会话缓存写入 Token 数 | `40` |
| `{{sessionCost}}` | 会话费用（原始数值） | `0.05` |
| `{{sessionCostFormatted}}` | 会话费用（格式化，含货币符号） | `$0.0500` |

#### 全部级别（包含所有子会话的汇总数据）

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{totalTokensTotal}}` | 全部合计 Token 数 | `990` |
| `{{totalTokensInput}}` | 全部输入 Token 数 | `300` |
| `{{totalTokensOutput}}` | 全部输出 Token 数 | `400` |
| `{{totalTokensReasoning}}` | 全部推理 Token 数 | `100` |
| `{{totalTokensCacheRead}}` | 全部缓存读取 Token 数 | `60` |
| `{{totalTokensCacheWrite}}` | 全部缓存写入 Token 数 | `130` |
| `{{totalCost}}` | 全部费用（原始数值） | `0.12` |
| `{{totalCostFormatted}}` | 全部费用（格式化，含货币符号） | `$0.1200` |

#### 模型与配置

| 变量 | 说明 | 示例值 |
|------|------|--------|
| `{{modelID}}` | 当前使用的模型标识 | `claude-sonnet-4`、`gpt-4o` |
| `{{providerID}}` | 模型提供商标识 | `anthropic`、`openai` |
| `{{mode}}` | 运行模式 | `plan`、`code` |
| `{{currency}}` | 货币符号 | `$`、`¥` |

> **关于会话级别与全部级别的区别**：`session*` 变量仅统计当前会话自身的用量，`total*` 变量统计当前会话及所有子会话的汇总用量。对于没有子会话的场景，两者数值相同。
>
> **关于费用格式化**：`sessionCostFormatted` 和 `totalCostFormatted` 根据 `currency` 变量自动选择货币符号和格式。中文环境（`language: "zh"`）使用 `¥`，英文环境使用 `$`。

### 5.4 Token 格式化变量（人类可读，所有事件类型可用）

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

> **格式化规则**：小于 1000 的数值原样显示（如 `420`）；1000 及以上使用 K（千）、M（百万）、B（十亿）后缀 + 1 位小数（如 `127.1K`、`1.5M`、`2.0B`）。如需精确数值，请在自定义模板中使用对应的原始变量（如 `{{sessionTokensTotal}}`）。

### 5.5 变量速查表

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

## 六、配置示例

### 6.1 自定义 SMTP 邮件模板

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

### 6.2 自定义钉钉模板（仅 body，无 subject）

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

### 6.3 自定义飞书模板（仅 body，lark_md 格式）

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

### 6.4 部分覆盖（只自定义特定事件）

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

---

## 七、内置默认模板参考

### 7.1 中文默认模板（`language: "zh"`）

#### created - 会话创建

```
Subject: [{{projectName}}] 任务已启动
Body:
任务启动时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
```

#### idle - 任务完成

```
Subject: [{{projectName}}] 任务已完成
Body:
任务完成时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
消息: {{message}}
耗时: {{duration}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### error - 任务出错

```
Subject: [{{projectName}}] 任务出错
Body:
错误发生时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
错误信息: {{error}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### question - AI 提问

```
Subject: [{{projectName}}] AI 提问
Body:
OpenCode 在 {{timestamp}} 向您提问
会话: {{sessionTitle}} ({{sessionId}})
问题: {{title}}
{{questionText}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### permission - 权限确认

```
Subject: [{{projectName}}] 需要权限确认
Body:
{{timestamp}} 需要权限确认
会话: {{sessionTitle}} ({{sessionId}})
{{title}} ({{permissionType}})

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### status - 状态变更

```
Subject: [{{projectName}}] 状态变更
Body:
会话状态变更时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
状态: {{statusType}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### command - 命令执行

```
Subject: [{{projectName}}] 命令已执行
Body:
命令执行时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
命令: {{commandName}} {{arguments}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### fileEdited - 文件编辑

```
Subject: [{{projectName}}] 文件已编辑
Body:
文件编辑时间: {{timestamp}}
文件: {{filePath}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### todo - Todo 更新

```
Subject: [{{projectName}}] Todo 已更新
Body:
Todo 更新时间: {{timestamp}}
会话: {{sessionTitle}} ({{sessionId}})
{{todoSummary}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

### 7.2 英文默认模板（`language: "en"`）

#### created - Session Created

```
Subject: [{{projectName}}] Task Started
Body:
Task started at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
```

#### idle - Task Completed

```
Subject: [{{projectName}}] Task Completed
Body:
Task completed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Message: {{message}}
Duration: {{duration}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### error - Task Error

```
Subject: [{{projectName}}] Task Error
Body:
Error at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Error: {{error}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### question - Question

```
Subject: [{{projectName}}] Question
Body:
OpenCode has a question at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Question: {{title}}
{{questionText}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### permission - Permission Required

```
Subject: [{{projectName}}] Permission Required
Body:
Permission needed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
{{title}} ({{permissionType}})

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### status - Status Change

```
Subject: [{{projectName}}] Status Change
Body:
Session status changed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Status: {{statusType}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### command - Command Executed

```
Subject: [{{projectName}}] Command Executed
Body:
Command executed at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
Command: {{commandName}} {{arguments}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### fileEdited - File Edited

```
Subject: [{{projectName}}] File Edited
Body:
File edited at {{timestamp}}
File: {{filePath}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

#### todo - Todos Updated

```
Subject: [{{projectName}}] Todos Updated
Body:
Todos updated at {{timestamp}}
Session: {{sessionTitle}} ({{sessionId}})
{{todoSummary}}

Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
```

---

## 八、通道差异说明

### 8.1 通道模板差异对比

| 维度 | SMTP | DingTalk | Feishu |
|------|------|----------|--------|
| `subject` 字段 | 使用（邮件主题） | 格式化为 `###` 标题后前置到消息正文 | 格式化为 card header title |
| `body` 字段 | 纯文本 | Markdown 子集 | lark_md（标准 Markdown） |
| 变量渲染 | 透传，原样输出 | 特殊字符自动转义（17 个字符） | 透传，原样输出 |
| 内容截断 | 无 | body 最大 4000 字符，超长截断 | body 最大 4000 字符 |
| 主题截断 | 无 | title 最大 100 字符 | 无 |

### 8.2 钉钉 Markdown 注意事项

编写钉钉自定义模板时注意：
- 不支持表格、代码块语法高亮、HTML 标签
- 变量值中的特殊字符（如 `*`、`[`、`]`）会被自动转义，无需手动处理
- 建议使用 `**key**: value` 格式突出关键信息

---

## 九、常见问题

**Q: 变量没有被替换，原样输出了 `{{xxx}}`？**

A: 检查变量名拼写是否正确（区分大小写），参考第五节变量列表。如果该事件类型没有对应的变量值，占位符会被替换为空字符串（不会保留原文）。

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
