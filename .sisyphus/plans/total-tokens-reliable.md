# 修复 totalTokens 始终可靠

## TL;DR

> **Quick Summary**: 新增 `sumAllCompletedTokens` 函数，累加 session 中所有已完成消息的 token 作为 totalTokens 的基础值，确保 total 永远不会因流式中间状态变为 0。
> 
> **Deliverables**:
> - 新增 `sumAllCompletedTokens` 函数
> - `fillTokenData` 中 totalTokens 使用新函数
> - `aggregateSubSessions` 中子会话也使用新函数
> - 新增测试覆盖流式中间事件场景
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - sequential（改动集中在一个文件）
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4

---

## Context

### Original Request
用户发现 `question.asked` 等中间事件通知中 totalTokens 也变为 0。用户决定：sessionTokens 为 0 是 OpenCode 限制可接受，但 totalTokens 必须始终可靠。

### Interview Summary
- sessionTokens 为 0：保持现状（OpenCode 限制）
- totalTokens：必须始终可靠，反映已完成工作的累计 token
- Metis 建议：不回退 `aggregateSessionTokens`，新增独立的累加函数

### Metis Review
**关键发现**:
1. 不应该回退 `aggregateSessionTokens` —— 当前 fallback 策略对 sessionTokens 是正确的
2. `aggregateSubSessions` 中子会话也需要用累加策略，否则子会话流式中 total 会下降
3. `totalCost` 不受影响（已是全量累加）
4. 所有 token 子字段（input/output/reasoning/cacheRead/cacheWrite）都需要正确累加

---

## Work Objectives

### Core Objective
确保 `totalTokens`（及其子字段）始终反映 session 中所有已完成消息的累计 token，不受流式中间状态影响。

### Concrete Deliverables
- `src/index.ts` 中新增 `sumAllCompletedTokens` 函数
- `fillTokenData` 中使用新函数替代 `sessionAgg.tokens` 作为 totalTokens 基础
- `aggregateSubSessions` 中子会话贡献也使用新函数
- `tests/index.test.ts` 中新增流式中间事件 totalTokens 验证测试

### Definition of Done
- [ ] `totalTokensTotal > 0` 当 session 中存在至少一条 total>0 的消息时（任何事件类型）
- [ ] 现有 373 个测试全部通过
- [ ] typecheck 通过
- [ ] build 通过

### Must Have
- totalTokens 始终可靠（累加所有已完成消息）
- sessionTokens 保持当前行为（fallback to last non-zero）
- 所有 token 子字段正确（input/output/reasoning/cacheRead/cacheWrite/total）
- 子会话贡献也使用累加策略

### Must NOT Have (Guardrails)
- 不修改 `aggregateSessionTokens` 函数（保持当前 fallback 策略）
- 不修改 `message.updated` 处理逻辑（tokenDataMap 数据收集方式不变）
- 不修改 `SessionTokenData` 或 `TokenData` 类型
- 不修改模板系统或通知格式
- 不修改 CLI、config、channel 代码
- 不修改 `aggregateSubSessions` 的结构（只改计算方式）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (tests-after)
- **Framework**: bun test

### QA Policy
Every task includes agent-executed QA scenarios.

---

## Execution Strategy

### Sequential (改动集中在单一文件)

```
Task 1: 新增 sumAllCompletedTokens 函数 [quick]
  |
Task 2: 修改 fillTokenData 和 aggregateSubSessions 使用新函数 [quick]
  |
Task 3: 新增测试 + 验证 [unspecified-high]
  |
Task 4: 更新文档 [quick]
```

---

## TODOs

- [x] 1. 新增 sumAllCompletedTokens 函数

  **What to do**:
  - 在 `src/index.ts` 中 `aggregateSessionTokens` 函数之后（约第 73 行后），新增 `sumAllCompletedTokens` 函数
  - 签名：`function sumAllCompletedTokens(sessionData: SessionTokenData): TokenBreakdown`
  - 逻辑：遍历 `sessionData.messages`，累加所有 `input + output + cacheRead + cacheWrite > 0` 的消息的各 token 字段
  - 如果所有消息 token 都为 0，返回全零 TokenBreakdown
  - `total` 字段 = 累加的 input + output + cacheRead + cacheWrite（不含 reasoning，与现有公式一致）
  - `reasoning` 单独累加但不出现在 total 中

  **Must NOT do**:
  - 不修改 aggregateSessionTokens
  - 不修改任何类型定义

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 2, 3, 4
  - **Blocked By**: None

  **References**:
  **Pattern References**:
  - `src/index.ts:35-73` - `aggregateSessionTokens` 的实现模式，特别是 ZERO_TOKENS 定义和 Map 遍历方式
  - `src/index.ts:41-44` - cost 累加的模式（遍历所有 values 累加），token 累加应参考此模式

  **API/Type References**:
  - `src/types.ts:TokenBreakdown` - 返回类型，确保字段名一致

  **Acceptance Criteria**:
  - [ ] 函数存在且 TypeScript 类型正确
  - [ ] 空消息 Map 返回全零
  - [ ] 只有 token=0 的消息时返回全零
  - [ ] 有 token>0 的消息时正确累加所有子字段

  **QA Scenarios**:

  ```
  Scenario: 空会话返回全零
    Tool: Bash
    Preconditions: sessionData.messages.size === 0
    Steps:
      1. 调用 sumAllCompletedTokens({ messages: new Map(), ... })
      2. 检查返回值的 total === 0
    Expected Result: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    Evidence: .sisyphus/evidence/task-1-empty-session.txt

  Scenario: 多条消息正确累加
    Tool: Bash
    Preconditions: Map 中有 3 条消息，2 条 token>0，1 条 token=0
    Steps:
      1. msgA: { input: 100, output: 50, reasoning: 10, cacheRead: 30, cacheWrite: 20, total: 200 }
      2. msgB: { input: 0, output: 0, ... total: 0 } (流式中)
      3. msgC: { input: 200, output: 100, reasoning: 20, cacheRead: 60, cacheWrite: 40, total: 400 }
      4. 调用 sumAllCompletedTokens
      5. 检查返回值
    Expected Result: input=300, output=150, reasoning=30, cacheRead=90, cacheWrite=60, total=600
    Evidence: .sisyphus/evidence/task-1-multi-msg.txt
  ```

  **Commit**: YES (groups with 2)
  - Message: `fix(token): 新增 sumAllCompletedTokens 用于 totalTokens 可靠累加`
  - Files: `src/index.ts`
  - Pre-commit: `npm run typecheck`

- [x] 2. 修改 fillTokenData 和 aggregateSubSessions 使用新函数

  **What to do**:
  - 在 `fillTokenData`（约第 292-294 行）：将 `payload.totalTokens = { ...sessionAgg.tokens }` 改为使用 `sumAllCompletedTokens(sessionData)` 的结果
  - 在 `aggregateSubSessions`（约第 396-404 行）：将 `aggregateSessionTokens(sData)` 改为 `sumAllCompletedTokens(sData)` 用于子会话 token 贡献计算
  - `totalCost` 不变（已是全量累加）

  **Must NOT do**:
  - 不修改 `payload.sessionCost` / `payload.sessionTokens`（保持 aggregateSessionTokens 的结果）
  - 不修改 totalCost 的计算方式

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 3, 4
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src/index.ts:284-294` - fillTokenData 中 totalTokens 的赋值位置，需要替换 `sessionAgg.tokens` 为 `sumAllCompletedTokens(sessionData)`
  - `src/index.ts:396-404` - aggregateSubSessions 中子会话聚合位置，需要替换 `aggregateSessionTokens(sData)` 为 `sumAllCompletedTokens(sData)`

  **Acceptance Criteria**:
  - [ ] fillTokenData 中 totalTokens 来自 sumAllCompletedTokens
  - [ ] aggregateSubSessions 中子会话 token 来自 sumAllCompletedTokens
  - [ ] sessionTokens 仍来自 aggregateSessionTokens（不变）
  - [ ] npm run typecheck 通过

  **QA Scenarios**:

  ```
  Scenario: 流式中间事件 totalTokens 不为 0
    Tool: Bash
    Preconditions: tokenDataMap 中有 session，最后一条 message token=0，前一条有值
    Steps:
      1. 模拟 tokenDataMap 中 msgA={token: 38K}, msgB={token: 0}
      2. 触发 question.asked 事件
      3. 检查 payload.totalTokens.total > 0
    Expected Result: totalTokens.total > 0（应约 38K）
    Evidence: .sisyphus/evidence/task-2-total-reliable.txt

  Scenario: 子会话流式中 totalTokens 不下降
    Tool: Bash
    Preconditions: 主 session 有 msgA token=50K，子 session 有 msgB token=30K（已完成）和 msgC token=0（流式中）
    Steps:
      1. 触发事件
      2. 检查 payload.totalTokens.total
    Expected Result: totalTokens.total >= 80K（主 session 累加 + 子 session 累加）
    Evidence: .sisyphus/evidence/task-2-subsessions.txt
  ```

  **Commit**: YES (groups with 1)
  - Message: `fix(token): totalTokens 使用全量累加，确保流式中间状态不为 0`
  - Files: `src/index.ts`
  - Pre-commit: `npm run typecheck`

- [x] 3. 新增测试 + 全量验证

  **What to do**:
  - 在 `tests/index.test.ts` 中新增测试用例：
    1. 流式中间事件 totalTokens > 0（msgA 有 token，msgB token=0，触发 question 事件）
    2. 子会话流式中 totalTokens 累加正确
    3. 空 session totalTokens 为 0
    4. 单消息 totalTokens == sessionTokens
  - 运行 `npm run typecheck && npm run test && npm run build`
  - 确认 373+ 测试全部通过（updater.test.ts 的 10 个已知失败除外）

  **Must NOT do**:
  - 不修改已有测试的断言值

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  **Test References**:
  - `tests/index.test.ts` - 搜索 "Token Accum" / "Token Dedup" / "Token MultiMsg" / "Token LastMsg" 等已有 token 测试，参考其 mock 模式和断言结构
  - `tests/index.test.ts` 中 "Token LastMsg Test" 测试用例 - 直接展示如何构造 tokenDataMap 并验证聚合结果

  **Acceptance Criteria**:
  - [ ] 新增 >= 3 个测试用例
  - [ ] npm run typecheck 通过
  - [ ] npm run test 通过（index.test.ts 全部 PASS）
  - [ ] npm run build 通过

  **QA Scenarios**:

  ```
  Scenario: 全量测试通过
    Tool: Bash
    Preconditions: Task 1 和 Task 2 代码已写入
    Steps:
      1. npm run typecheck
      2. npm run test
      3. npm run build
    Expected Result: typecheck 0 errors, test 373+ pass, build success
    Failure Indicators: typecheck error, test failure, build error
    Evidence: .sisyphus/evidence/task-3-full-test.txt
  ```

  **Commit**: YES
  - Message: `test(token): 新增 totalTokens 流式中间状态可靠性测试`
  - Files: `tests/index.test.ts`
  - Pre-commit: `npm run typecheck`

- [x] 4. 更新文档

  **What to do**:
  - 更新 `docs/issues/token-zero-on-mid-event.md`：
    - 状态改为"已修复（totalTokens 部分）"
    - sessionTokens 为 0 记录为 OpenCode 限制（not a bug）
    - 新增"修复方案"章节说明 totalTokens 的累加策略
  - 更新 `docs/architecture/event-data-flow.md`：
    - 第 3.3 节"聚合"中更新 totalTokens 的计算说明
  - 更新 `docs/configuration.md`（Token 变量说明部分）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: None
  - **Blocked By**: Task 3

  **References**:
  - `docs/issues/token-zero-on-mid-event.md` - 已有文档
  - `docs/architecture/event-data-flow.md` - 第 3.3 节
  - `docs/configuration.md` - Token 变量说明

  **Acceptance Criteria**:
  - [ ] 文档中 totalTokens 的描述与新实现一致

  **Commit**: YES
  - Message: `docs(token): 更新 totalTokens 修复文档`
  - Files: `docs/issues/token-zero-on-mid-event.md`, `docs/architecture/event-data-flow.md`, `docs/configuration.md`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan. Verify "Must Have" items exist. Verify "Must NOT Have" items are absent. Check evidence files.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `tsc --noEmit` + `bun test`. Review changed files for code smells.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

---

## Commit Strategy

- **Task 1+2**: `fix(token): totalTokens 使用全量累加，确保流式中间状态不为 0`
- **Task 3**: `test(token): 新增 totalTokens 流式中间状态可靠性测试`
- **Task 4**: `docs(token): 更新 totalTokens 修复文档`

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck    # Expected: 0 errors
npm run test         # Expected: 373+ pass (updater.test.ts 10 fails excluded)
npm run build        # Expected: success
```

### Final Checklist
- [ ] totalTokens > 0 当 session 中有已完成消息时
- [ ] sessionTokens 保持当前 fallback 策略不变
- [ ] 子会话 token 贡献也使用累加策略
- [ ] 所有现有测试通过
