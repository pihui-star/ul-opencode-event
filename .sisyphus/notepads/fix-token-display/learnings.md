# Learnings

## 2026-04-18 Task: plan-analysis

### OpenCode UI Token 公式
- OpenCode Go `TrackUsage()` 使用 `=` 覆盖 PromptTokens/CompletionTokens（非累加）
- UI total = (InputTokens + CacheCreationTokens) + (OutputTokens + CacheReadTokens)
- 等价于: `total = input + output + cacheRead + cacheWrite`（排除 reasoning）
- DB 验证: msg#44 total=125,422 精确匹配用户看到的 125.4K

### 当前插件问题
- `aggregateSessionTokens()` 将所有消息 token 求和，cacheRead 被重复计算 N 次
- 40 条消息 → 共享上下文被算 40 次 → 3.1M（实际只有 125.4K）
- `total` 公式包含 reasoning，与 OpenCode UI 不一致

### 修复方案
- Token 字段使用最后一条消息的数据（last-message 语义）
- total 公式排除 reasoning
- 费用 cost 保持跨所有消息累计求和

## 2026-04-18 Task 3: 更新失败测试

### fillTokenData 空 session 行为
- `tokenDataMap` 仅在 `message.updated` (role=assistant) 时创建条目
- 空 session（有 session.created 但无 message.updated）在 tokenDataMap 中无条目
- 需要在 fillTokenData 中处理 `!sessionData` 情况，填充全零 token 而非返回 undefined
- 额外影响: "no token data" 测试也需要从 `expect(undefined)` 改为 `expect(0)`

### last-message 语义对单调递增测试的影响
- 多批次消息中，后批次的 last-message total 必须大于前批次的 last-message total
- 原来 tokens 较小的后批次消息（如 input:3000）导致 total 不再单调递增
- 解决: 增大后批次 tokens 值以保持单调性

### cli.ts mock 数据
- total 字段需要匹配新公式: input + output + cacheRead + cacheWrite
- 旧值 20500 改为 32500 (15000+2500+12000+3000)

### 预先存在的测试失败（非本任务）
- updater.test.ts: 8 个失败（mkdirSync mock、npm install 等）
- full-flow.test.ts: 1 个 SMTP 错误处理测试失败
