# 已修复：中间事件 Token 显示为 0

> 状态：已修复（totalTokens 部分，v0.1.45）
> 发现日期：2026-04-18
> 修复日期：2026-04-18

## 现象

在收到 `question`（AI 提问）等中间事件的通知时，Token 使用量显示为 `Token(0/151.2K)`，当前会话的 token 计数为 0，不应为 0。

## 根因

### 一句话总结

OpenCode 的事件钩子不提供 session 级聚合 token 数据，插件自行从 `message.updated` 累计时，因 `aggregateSessionTokens` 只取 Map 中最后一条 message 的 token，而新创建的流式 message token=0，导致在 AI 回复中间触发的事件读到 token=0。

### 详细分析

#### 1. 事件数据源

OpenCode SDK 中 token 数据的**唯一来源**是 `message.updated` 事件（`plugin-core.ts`）。每次收到 `message.updated`，插件将 assistant message 的 token 数据写入 `tokenDataMap`。

`question.asked` 事件（`EventQuestionAsked`）的 `properties` 类型是 `QuestionRequest`，只包含 `id, sessionID, questions, tool?`，**不包含任何 token/cost 字段**。

#### 2. 流式 message 的 token 演变

assistant message 在流式传输过程中 token 值经历以下阶段：

| 阶段 | message.updated 中的 token | 说明 |
|------|---------------------------|------|
| message 创建 | 0 | 新 message 开始流式传输 |
| 流式更新中 | 0 或有值 | 取决于模型和进度 |
| message 完成 | 完整值 | 该回合最终的 token 使用量 |

#### 3. aggregateSessionTokens 的策略问题

`aggregateSessionTokens`（`token-aggregator.ts`）从 `tokenDataMap` 中读取 token 时，**只取 Map 中最后插入的 message** 的 token：

```
Map 中数据：
  msgA → {tokens: 38.1K}   ← 已完成的 message
  msgB → {tokens: 0}       ← 新创建的 message（流式刚开始）

遍历取 last → msgB → token=0
```

这个策略是为 `session.idle`（AI 回复结束后触发）设计的——此时最后一条 message 已完成，token 值准确。但在 AI 回复中间触发的事件（question/status/permission 等），最后一条 message 可能是刚创建的，token 为 0。

#### 4. 日志证据

来自 `ul-opencode-event-variables.jsonl` 的真实记录（session `ses_25f4002ebffekr2ogdxlim8vul`，2026-04-18）：

```
行号  时间        事件      sessionTokensTotal  说明
29    21:20:48   status    38.1K               message A 已完成，有 token
30    21:20:49   status    0                   message B 创建，token=0
31    21:21:01   status    38.5K               message B 更新后有 token
32    21:21:02   status    0                   message C 创建，token=0
...
47    21:23:05   question  0                   question.asked 触发，读到 0
```

交替模式清晰可见：每次新 assistant message 创建时 token=0，覆盖了 Map 中前一条有值的 message。

## 影响范围

### 确定受影响的事件

所有在 **AI 回复过程中**（非回复结束时）触发的事件：

| 事件 | 是否受影响 | 说明 |
|------|-----------|------|
| `question` | 是 | AI 提问时，新 message 可能刚创建 |
| `status` | 是 | 日志中可见交替模式 |
| `permission` | 可能 | 权限请求在回复中间触发时 |
| `command` | 可能 | 命令执行在回复中间触发时 |
| `fileEdited` | 可能 | 文件编辑在回复中间触发时 |
| `todo` | 可能 | Todo 更新在回复中间触发时 |

### 不受影响的事件

| 事件 | 说明 |
|------|------|
| `session.idle` | AI 回复结束后触发，最后一条 message 已有完整 token |
| `session.error` | 错误发生时触发，token 数据通常已积累 |
| `session.created` | 创建时没有 token 数据（已特殊处理，不填充 token） |

## 修复方案

### 实际实现（v0.1.45）

修复采用**双策略**方案，`sessionTokens` 和 `totalTokens` 使用不同的聚合逻辑：

#### 1. 新增 `sumAllCompletedTokens` 函数

遍历 `sessionData.messages`，累加所有 token 非零消息（`input + output + cacheRead + cacheWrite > 0`）的 token 字段：

```typescript
function sumAllCompletedTokens(sessionData: SessionTokenData): TokenBreakdown {
  let input = 0, output = 0, reasoning = 0, cacheRead = 0, cacheWrite = 0;
  for (const td of sessionData.messages.values()) {
    const t = td.tokens;
    if (t.input + t.output + t.cacheRead + t.cacheWrite > 0) {
      input += t.input;
      output += t.output;
      reasoning += t.reasoning;
      cacheRead += t.cacheRead;
      cacheWrite += t.cacheWrite;
    }
  }
  return { input, output, reasoning, cacheRead, cacheWrite };
}
```

#### 2. `fillTokenData` 中的策略

| 字段 | 策略 | 可靠性 |
|------|------|--------|
| `sessionTokens` | 取最后一条非零 message（`aggregateSessionTokens`，fallback） | 流式中间可能为 0（OpenCode 限制） |
| `totalTokens` | 使用 `sumAllCompletedTokens` 累加所有已完成消息 | 始终可靠 |

#### 3. `aggregateSubSessions` 中的策略

- base 改为 `payload.totalTokens`（已使用累加策略）
- 子会话贡献也使用 `sumAllCompletedTokens`

### 为什么 sessionTokens 不使用累加

`sessionTokens` 的语义是"当前会话最近一次交互的 token 用量"。累加所有消息会导致语义变化（变成 totalTokens），因此保持"取最后一条非零消息"策略。流式中间为 0 是 OpenCode 的已知限制。

```typescript
// 修复前：totalTokens = aggregateSessionTokens（取最后一条，中间可能为 0）
// 修复后：totalTokens = sumAllCompletedTokens（累加所有已完成，始终可靠）
```

## 相关代码

| 文件 | 位置 | 说明 |
|------|------|------|
| `src/token-aggregator.ts` | `sumAllCompletedTokens` | 累加 session 中所有 token 非零消息的 token 字段 |
| `src/token-aggregator.ts` | `aggregateSessionTokens` | 从 tokenDataMap 聚合 token，取最后一条非零 message（sessionTokens 用） |
| `src/token-aggregator.ts` | `fillTokenData` | 将聚合结果填充到 EventPayload，totalTokens 使用 sumAllCompletedTokens |
| `src/token-aggregator.ts` | `aggregateSubSessions` | 汇总子会话 token，base 改为 totalTokens，子会话贡献也用 sumAllCompletedTokens |
| `src/plugin-core.ts` | `message.updated` 处理 | token 数据写入 tokenDataMap 的唯一入口 |
| `src/event-mapper.ts` | `eventToPayload` | 调用 fillTokenData 读取 token，处理所有事件类型（含 question.asked） |
| `src/types.ts` | `SessionTokenData` | session 级 token 数据结构 |
| `src/db-preload.ts` | 全文 | 从 SQLite 预加载 token 数据到 tokenDataMap |

## 插件重启恢复

### 问题

`tokenDataMap` 是纯内存 Map（`Map<string, SessionTokenData>`），插件重启后为空。如果 OpenCode 有正在进行的会话，插件重启后收到该会话的通知事件时，`fillTokenData()` 无法从 `tokenDataMap` 找到对应 session 的数据，导致 Token 显示为 `Token(0/0)`。

### 方案

`src/db-preload.ts` 提供 `preloadTokenData(tokenDataMap, dataDir, limit=10, projectPath?)` 函数，在插件初始化时从 OpenCode 的 `opencode.db` SQLite 数据库预加载最近 N 个会话的 assistant 消息 token 数据，填充到 `tokenDataMap`。传入 `projectPath` 时仅加载匹配该路径的会话（通过 `session.directory` 列过滤），SQL 失败时自动回退到加载全部会话。

### 实现

- **数据库**：`opencode.db`（SQLite，WAL 模式），位于 OpenCode 数据目录（`~/.local/share/opencode/`）
- **驱动**：`bun:sqlite`（Bun 内置模块，零 npm 外部依赖）
- **访问模式**：`{ readonly: true }` 只读打开，`finally { db.close() }` 自动关闭连接
- **查询逻辑**：查询最近 N 个 session 的所有 assistant 消息，解析 `data` JSON 字段中的 token 数据
- **安全**：整个函数包裹在 try/catch 中，任何错误仅写 debug 日志，不抛出异常，不影响插件正常启动

### 数据流

```
opencode.db → SELECT message → JSON.parse → TokenData → tokenDataMap
```

预加载的数据会被实时 `message.updated` 事件自然覆盖（相同 messageId 的数据会被替换），不会产生重复累加。
