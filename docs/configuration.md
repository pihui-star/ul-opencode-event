# 配置指南

本文档介绍 `@ulthon/ul-opencode-event` 的通用配置机制，包括配置文件位置、合并规则、事件配置、模板概述和调试模式。

各通知通道的具体配置请参考对应文档：
- [SMTP 邮件通道配置](smtp-channel.md)
- [钉钉机器人通道配置](dingtalk-channel.md)
- [飞书机器人通道配置](feishu-channel.md)

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

> **推荐**：全局安装插件时使用全局配置，项目安装时使用项目配置。两者可以共存，项目配置优先于全局配置。

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

## 4. 模板概述

插件使用 `{{variable}}` 语法的模板系统，支持自定义通知内容。

模板可在两个层级配置：

- **通道级模板**：在每个通道的 `templates` 字段中配置，仅对该通道生效
- **默认模板**：未配置通道级模板时使用，根据 `language` 字段选择中文或英文默认模板

**示例**：

```json
{
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
```

完整的模板变量列表和高级用法请参考 [模板配置文档](template-configuration.md)。

---

## 5. 顶层配置字段

以下字段在配置文件的顶层配置：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `projectName` | string | 目录名（basename） | 项目简称，用于通知模板中的 `{{projectName}}` 变量 |
| `language` | `"zh"` \| `"en"` | `"en"` | 默认模板语言，影响所有未自定义模板的通道 |
| `timezone` | string | 根据 `language` 推断 | IANA 时区标识符，如 `"Asia/Shanghai"` |
| `auto_update` | boolean | `true` | 是否自动检查并安装新版本 |
| `includeSessionTypes` | string[] | `["main"]` | 包含的会话类型，可选值：`"main"`、`"subagent"`、`"unknown"` |

### 配置示例

```json
{
  "projectName": "my-project",
  "language": "zh",
  "timezone": "Asia/Shanghai",
  "auto_update": true,
  "includeSessionTypes": ["main"],
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

## 6. 全局安装与项目安装

### 全局安装

```bash
npm install -g @ulthon/ul-opencode-event
```

全局安装时，使用全局配置文件 `~/.config/opencode/ul-opencode-event.json`。所有项目共享同一份通知配置。

### 项目安装

```bash
npm install @ulthon/ul-opencode-event
```

项目安装时，使用项目目录下的配置文件。可以为不同项目配置不同的通知通道和模板。

### 共存机制

全局和项目配置可以共存。合并规则如下：

1. 通道按 `name` 字段合并（见[配置合并规则](#2-配置合并规则)）
2. 顶层字段以项目配置为准
3. `enabled: false` 的通道会被过滤

> **典型场景**：全局配置一个 SMTP 通道用于所有项目，某个项目额外配置一个钉钉通道用于团队通知。

---

## 7. 调试模式

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

- [SMTP 邮件通道配置](smtp-channel.md)
- [钉钉机器人通道配置](dingtalk-channel.md)
- [飞书机器人通道配置](feishu-channel.md)
- [模板配置详解](template-configuration.md)
- [通道开发指南](channel-development.md)
