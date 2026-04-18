# 事件数据流架构

本文档描述插件从 OpenCode SDK 接收事件到发送通知的完整数据流。

---

## 1. 整体流程

```
OpenCode SDK
    |
    | Event (SSE)
    v
Plugin.event()                       -- index.ts
    |
    ├── session.created  → sessionMap.set()
    ├── session.updated  → sessionMap.set()
    ├── message.updated  → tokenDataMap 写入  (不发送通知)
    └── 其他事件         → eventToPayload()
                              |
                              v
                         fillTokenData()      -- 从 tokenDataMap 读取聚合 token
                              |
                              v
                         aggregateSubSessions() -- 汇总子会话 token
                              |
                              v
                         eventHandler.handle()
                              |
                              ├── renderTemplate()   -- 渲染 subject/body
                              ├── getFormatter()      -- 获取通道格式化器
                              ├── formatter.format()  -- 格式化为通道原生结构
                              └── sender.send()       -- 发送通知
```

---

## 2. 事件处理详细流程

### 2.1 会话管理事件

| SDK 事件 | 处理 | 说明 |
|----------|------|------|
| `session.created` | 写入 `sessionMap`，触发 `created` 通知 | 记录 session 元信息（id, title, parentID） |
| `session.updated` | 更新 `sessionMap` | 更新 session 元信息 |
| `session.idle` | 触发 `idle` 通知 | AI 回复结束 |
| `session.error` | 触发 `error` 通知 | AI 回复出错 |

### 2.2 消息事件

| SDK 事件 | 处理 | 说明 |
|----------|------|------|
| `message.updated` | 写入 `tokenDataMap`，**不发送通知** | token/cost 数据的唯一来源 |

`message.updated` 的处理逻辑（`index.ts:564-611`）：

```
收到 message.updated
    |
    ├── role !== 'assistant'  → 忽略（只处理 assistant 消息）
    └── role === 'assistant'
         |
         ├── 从 event.properties.info 提取：
         |   sessionId, messageId, tokens, cost, modelID, providerID, mode
         |
         └── tokenDataMap.get(sessionId)
              |
              ├── 不存在 → 创建 SessionTokenData，写入 Map
              └── 已存在 → 覆盖该 messageId 的 TokenData（同 ID 不累加）
```

### 2.3 中间事件

以下事件通过 `default` 分支的运行时类型检查处理（不在 v1 SDK 类型中，但运行时会收到）：

| SDK 事件 | 内部事件类型 | 默认通知 |
|----------|-------------|---------|
| `question.asked` | `question` | 开启 |
| `permission.updated` | `permission` | 开启 |
| `session.status` | `status` | 关闭 |
| `command.executed` | `command` | 关闭 |
| `file.edited` | `fileEdited` | 关闭 |
| `todo.updated` | `todo` | 关闭 |

---

## 3. Token 数据流

### 3.1 数据源

token 数据仅从 `message.updated` 事件的 `AssistantMessage.tokens` 字段获取：

```typescript
// SDK AssistantMessage 结构（v2）
{
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  cost: number;
  modelID: string;
  providerID: string;
  mode: string;
}
```

### 3.2 存储

`tokenDataMap` 是 `Map<string, SessionTokenData>`，按 sessionId 索引：

```typescript
SessionTokenData {
  messages: Map<string, TokenData>;  // messageId → TokenData
  lastModelID: string;
  lastProviderID: string;
  lastMode: string;
}

TokenData {
  cost: number;
  tokens: TokenBreakdown;
  modelID: string;
  providerID: string;
  mode: string;
}
```

同一个 messageId 的 `message.updated` 会覆盖（不累加），Map 保留插入顺序。

### 3.3 聚合

Token 聚合采用**双策略**方案（v0.1.45 修复）：

| 字段 | 聚合策略 | 说明 |
|------|---------|------|
| `cost` | 累加所有 message 的 cost | 始终可靠 |
| `sessionTokens` (input/output/reasoning/cacheRead/cacheWrite) | 取**最后一条非零** message 的 token 值（`aggregateSessionTokens`） | 流式中间可能为 0（OpenCode 限制） |
| `totalTokens` | **累加所有 token 非零 message** 的 token 值（`sumAllCompletedTokens`） | 始终可靠 |
| `total` (sessionTokens) | input + output + cacheRead + cacheWrite | 基于 sessionTokens 计算 |
| `total` (totalTokens) | input + output + cacheRead + cacheWrite | 基于 sumAllCompletedTokens 计算 |

> **注意**：`sessionTokens` 取最后一条非零 message，在流式传输过程中新创建的 message token 为 0 时会 fallback 到前一条有值 message。`totalTokens` 使用累加策略，始终反映已完成工作的累计值。详见 [已知问题：中间事件 Token 为 0](../issues/token-zero-on-mid-event.md)。

### 3.4 填充

`fillTokenData`（`index.ts:242-291`）将聚合结果写入 EventPayload：

```
fillTokenData(payload, tokenDataMap, ...)
    |
    ├── eventType === 'created' → 跳过（创建时无 token）
    ├── tokenDataMap 为空 → 跳过
    ├── sessionData 不存在 → 写入全零 + 格式化
    └── sessionData 存在
         |
         ├── aggregateSessionTokens(sessionData) → session 级聚合（取最后一条非零）
         ├── sumAllCompletedTokens(sessionData) → totalTokens 聚合（累加所有已完成）
         ├── payload.sessionTokens = aggregateSessionTokens 结果
         ├── payload.totalTokens = sumAllCompletedTokens 结果
         ├── payload.modelID/providerID/mode = lastModelID 等
         └── 格式化 costFormatted / totalCostFormatted
```

### 3.5 子会话聚合

`aggregateSubSessions`（`index.ts:361-410`）在 `fillTokenData` 之后调用，将所有子会话（子代理）的 token 累加到 `totalTokens`：

```
aggregateSubSessions(payload, tokenDataMap, sessionMap, ...)
    |
    └── collectDescendantSessionIds(sessionId, sessionMap)
         |
         └── 递归收集所有子孙 session ID
              |
              └── 对每个子孙 session 使用 sumAllCompletedTokens 累加到 payload.totalTokens
```

> **注意**：子会话聚合的 base 是 `payload.totalTokens`（已使用累加策略），子会话贡献也使用 `sumAllCompletedTokens`，确保 totalTokens 始终可靠。

---

## 4. 事件到通知的完整映射

```
SDK Event                    内部 EventType    通知模板 Token 行
─────────────────────────────────────────────────────────────
session.created              created           无 Token 行
session.idle                 idle              Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
session.error                error             Token(...)
question.asked               question          Token(...)
permission.updated           permission        Token(...)
session.status               status            Token(...)
command.executed             command           Token(...)
file.edited                  fileEdited        Token(...)
todo.updated                 todo              Token(...)
message.updated              (不发送通知)       -
```

---

## 5. 本地文件数据流

插件运行时在 `~/.local/share/opencode/` 目录下维护以下文件：

| 文件 | 模块 | 数据来源 | 写入时机 |
|------|------|---------|---------|
| `ul-opencode-event.log` | `logger.ts` | 运行日志 | 每次日志调用 |
| `ul-opencode-event-messages.log` | `file.ts` | EventPayload + subject/body | 每次通知发送 |
| `ul-opencode-event-variables.jsonl` | `recorder.ts` | 全部模板变量 | 每次事件处理 |

`recorder.ts` 记录的是 `handler.ts` 中构建的全部模板变量（约 42 个字段），包含原始值和人类可读格式（如 `sessionTokensTotalHuman`）。**始终开启，不受通道配置影响**，可用于调试。

---

## 6. 相关文档

- [已知问题：中间事件 Token 为 0](../issues/token-zero-on-mid-event.md)
- [模板配置详解](../configuration.md#8-全部可用变量) -- 包含完整的 Token/费用变量列表
- [配置指南](../configuration.md)
- [通道开发指南](../channels/channel-development.md)
