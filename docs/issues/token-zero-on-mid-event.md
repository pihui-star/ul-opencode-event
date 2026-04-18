# 已知问题：中间事件 Token 显示为 0

> 状态：已确认，暂不修复（等待 OpenCode 官方支持）
> 发现日期：2026-04-18

## 现象

在收到 `question`（AI 提问）等中间事件的通知时，Token 使用量显示为 `Token(0/151.2K)`，当前会话的 token 计数为 0，不应为 0。

## 根因

### 一句话总结

OpenCode 的事件钩子不提供 session 级聚合 token 数据，插件自行从 `message.updated` 累计时，因 `aggregateSessionTokens` 只取 Map 中最后一条 message 的 token，而新创建的流式 message token=0，导致在 AI 回复中间触发的事件读到 token=0。

### 详细分析

#### 1. 事件数据源

OpenCode SDK 中 token 数据的**唯一来源**是 `message.updated` 事件（`index.ts:564-611`）。每次收到 `message.updated`，插件将 assistant message 的 token 数据写入 `tokenDataMap`。

`question.asked` 事件（`EventQuestionAsked`）的 `properties` 类型是 `QuestionRequest`，只包含 `id, sessionID, questions, tool?`，**不包含任何 token/cost 字段**。

#### 2. 流式 message 的 token 演变

assistant message 在流式传输过程中 token 值经历以下阶段：

| 阶段 | message.updated 中的 token | 说明 |
|------|---------------------------|------|
| message 创建 | 0 | 新 message 开始流式传输 |
| 流式更新中 | 0 或有值 | 取决于模型和进度 |
| message 完成 | 完整值 | 该回合最终的 token 使用量 |

#### 3. aggregateSessionTokens 的策略问题

`aggregateSessionTokens`（`index.ts:35-61`）从 `tokenDataMap` 中读取 token 时，**只取 Map 中最后插入的 message** 的 token：

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

## 临时修复方案（备选）

如果需要在插件侧修复，最小改动方案：

**修改 `aggregateSessionTokens`**：当最后一条 message 的 total token 为 0 时，回退取前一条有 token 值的 message。

```typescript
// 伪代码
const messages = [...sessionData.messages.values()];
let lastTokens = messages[messages.length - 1]?.tokens;
if (lastTokens && lastTokens.total === 0 && messages.length > 1) {
  // 回退到前一条有值的 message
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].tokens.total > 0) {
      lastTokens = messages[i].tokens;
      break;
    }
  }
}
```

或者更根本的方案：通过 `ctx.client.session.messages()` SDK API 直接查询 session 的历史消息获取准确的累计 token。

## 理想方案

向 OpenCode 提 issue，请求在事件 payload 中增加 session 级聚合 token 字段（如 `session.usage`），使插件无需自行计算。

## 相关代码

| 文件 | 位置 | 说明 |
|------|------|------|
| `src/index.ts:35-61` | `aggregateSessionTokens` | 从 tokenDataMap 聚合 token，取最后一条 message |
| `src/index.ts:242-291` | `fillTokenData` | 将聚合结果填充到 EventPayload |
| `src/index.ts:564-611` | `message.updated` 处理 | token 数据写入 tokenDataMap 的唯一入口 |
| `src/index.ts:132-148` | `question.asked` 处理 | 调用 fillTokenData 读取 token |
| `src/types.ts:270-279` | `SessionTokenData` | session 级 token 数据结构 |
