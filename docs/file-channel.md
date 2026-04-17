# 文件通道文档

本文档涵盖文件（File）通道的**用户配置指南**和**内部实现细节**。

> 开发新渠道的通用指南请参阅 [channel-development.md](./channel-development.md)。

---

## 一、用户配置指南

### 1.1 概述

文件通道将通知消息以 JSON Lines 格式写入本地文件。每条消息占一行，包含完整的事件信息和格式化内容。

**无需任何配置即可使用**：文件通道默认自动注入，所有通知消息会自动写入 `~/.local/share/opencode/ul-opencode-event-messages.log`。

### 1.2 自动注入规则

- 如果配置中**没有**任何 `type: 'file'` 的通道，插件会自动注入一个默认文件通道
- 如果用户**已配置**文件通道，则不会自动注入
- 自动注入的通道名称为 `default-file`，所有事件类型默认开启

### 1.3 最小配置

通常不需要手动配置文件通道。如需自定义，可添加：

```json
{
  "channels": [
    {
      "type": "file",
      "enabled": true,
      "name": "我的文件日志",
      "config": {
        "filePath": "/path/to/my-messages.log"
      },
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
  "channels": [
    {
      "type": "file",
      "enabled": true,
      "name": "文件日志",
      "config": {
        "filePath": "/var/log/opencode/events.log",
        "maxSizeBytes": 2097152
      },
      "events": {
        "created": true,
        "idle": true,
        "error": true,
        "question": true,
        "permission": true,
        "status": true,
        "command": true,
        "fileEdited": true,
        "todo": true
      }
    }
  ]
}
```

### 1.5 配置字段说明

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `filePath` | string | No | `~/.local/share/opencode/ul-opencode-event-messages.log` | 输出文件路径 |
| `maxSizeBytes` | number | No | 1048576 (1MB) | 文件最大字节数，超过后自动轮转 |

> **注意**: 文件通道不需要 `recipients` 字段。

### 1.6 输出格式

每条消息为一行 JSON（JSON Lines 格式），包含完整的事件负载：

```json
{"eventType":"idle","timestamp":"2026-04-17T00:00:00.000Z","projectName":"my-project","sessionId":"sess-123","subject":"[OpenCode] Task Completed","body":"Task completed...","sessionType":"main"}
```

### 1.7 文件轮转

当文件大小超过 `maxSizeBytes` 时，自动执行轮转：
1. 读取文件全部内容
2. 找到文件中间位置后的第一个换行符
3. 保留后半部分内容
4. 在文件开头写入 `[TRUNCATED] ... old messages dropped` 标记

轮转策略确保：
- 不会在 JSON 行中间截断
- 保留较新的消息
- 文件大小始终可控

### 1.8 常见问题

**Q: 文件通道会影响性能吗？**

A: 不会。文件通道使用同步追加写入（`appendFileSync`），每条消息只有一次写入操作。文件轮转仅在超过大小限制时触发。

**Q: 可以配置多个文件通道吗？**

A: 可以。每个文件通道可以指定不同的 `filePath` 和 `events` 配置，实现不同事件写入不同文件。

**Q: 目录不存在怎么办？**

A: 文件通道会自动创建所需的目录结构（`mkdirSync` with `recursive: true`）。

**Q: 写入失败怎么办？**

A: 所有 I/O 错误都被捕获并记录到日志，不会抛出异常或影响其他通道的通知发送。

---

## 二、内部实现细节

本节供维护和调试参考。文件通道的完整实现位于 `src/file.ts`。

### 2.1 模块结构

```
src/file.ts
  createFileFormatter()   — 创建格式化器（透传 + 合并 payload）
  createFileSender()      — 创建发送器工厂（验证 -> 写入 -> 轮转）
  DEFAULT_FILE_MAX_SIZE   — 默认最大文件大小常量 (1MB)
  DEFAULT_FILE_PATH       — 默认输出路径常量
```

### 2.2 格式化规则

文件格式化器将 subject、body 和完整的 EventPayload 合并为一个对象：

```
输入: subject="Test", body="Body", payload={eventType, sessionId, ...}
输出: { ...payload, subject, body }
```

这个对象通过 `JSON.stringify()` 序列化后写入文件，每条消息占一行。

### 2.3 写入流程

```
send(message):
  1. JSON.stringify(message) + '\n'
  2. mkdirSync(dir, { recursive: true }) — 确保目录存在
  3. statSync(filePath) — 检查文件大小
  4. 若超过 maxSizeBytes → rotateFile()
  5. appendFileSync(filePath, line, 'utf-8')
  6. 任何错误 → logger.error() — 不抛出
```

### 2.4 轮转算法

```
rotateFile(filePath):
  1. readFileSync(filePath, 'utf-8')
  2. mid = floor(content.length / 2)
  3. nl = content.indexOf('\n', mid)
  4. cut = nl >= 0 ? nl + 1 : mid
  5. writeFileSync(filePath, TRUNCATE_MARKER + content.slice(cut))
```

### 2.5 fs 导入策略

`file.ts` 使用 `createRequire` 导入 `node:fs`，而非直接 `import * as fs from 'node:fs'`。这是为了在测试环境中绕过 `config.test.ts` 的 `mock.module('fs')` 全局模拟，确保文件通道始终使用真实的文件系统 API。

### 2.6 自动注入实现

自动注入逻辑在 `config.ts` 的 `loadConfig()` 中：

```typescript
// 在 validateAndFilterChannels() 之后
if (!channels.some(ch => ch.type === 'file')) {
  channels.push({
    type: 'file', enabled: true, name: 'default-file',
    config: { filePath: DEFAULT_FILE_PATH, maxSizeBytes: DEFAULT_FILE_MAX_SIZE },
    events: { /* 所有事件类型均开启 */ },
  });
}
```

同时，在 `loadConfig()` 的 "no config" 早返回路径中也注入了默认文件通道。

### 2.7 FileConfig JSON Schema

```json
{
  "$id": "FileConfig",
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "输出文件路径",
      "default": "~/.local/share/opencode/ul-opencode-event-messages.log"
    },
    "maxSizeBytes": {
      "type": "number",
      "description": "文件最大字节数，超过后自动轮转",
      "default": 1048576,
      "minimum": 1
    }
  }
}
```

### 2.8 Channel 接口字段映射（文件相关）

| Channel 字段 | 类型 | 文件场景下的含义 | 默认值 |
|-------------|------|-----------------|--------|
| `type` | `'file'` | 固定值 | 必填 |
| `enabled` | boolean | 是否启用该通道 | `true` |
| `name` | string | 通道标识名 | `'File'` |
| `config.filePath` | string | 输出文件路径 | `~/.local/share/opencode/ul-opencode-event-messages.log` |
| `config.maxSizeBytes` | number | 文件最大字节数 | 1048576 |
| `recipients` | string[] | 文件场景下**不使用** | 忽略 |
| `events` | EventConfig | 各事件开关 | 自动注入时全部开启 |

### 2.9 与其他通道对比

| 维度 | SMTP | DingTalk/Feishu | File |
|------|------|-----------------|------|
| 认证方式 | user + pass | webhook + secret | 无需认证 |
| 接收者指定 | recipients 数组 | webhook 目标群 | 文件路径 |
| 消息格式 | 纯文本 | Markdown/卡片 | JSON Lines |
| 连接模型 | 持久连接 | 无状态 HTTP | 同步文件 I/O |
| 外部依赖 | nodemailer（延迟导入） | 无（Web Crypto + fetch） | 无（Node.js fs） |
| 自动注入 | 否 | 否 | 是（默认开启） |
| 格式化复杂度 | 低（透传） | 高（转义/截断/卡片） | 低（JSON 序列化） |
