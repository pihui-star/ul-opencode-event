# Token 追踪修复计划

## TL;DR

> **核心问题**: tokenDataMap.delete(sid) 在 session.idle 时清除了累积 token 数据，导致同一会话的后续通知中 token 值减少而非单调递增。
> 同时修复子会话聚合遗漏、内存泄漏、嵌套子会话未递归等问题。
> 
> **Deliverables**:
> - 修复 token 数据在 session.idle 时被清除的 CRITICAL bug（删除一行代码）
> - 支持嵌套子会话的递归聚合
> - 增加 Number()||0 安全模式（参考 opencode-tokenscope）
> - 完善测试覆盖多 idle 场景和子会话聚合
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> F1-F4

---

## Context

### Original Request
用户反馈推送消息中 token 值不正确且不合理。同一主会话的多条通知中，token 总量出现下降（249.6K -> 158.1K），而非预期的单调递增。

### Interview Summary
**Key Discussions**:
- 用户确认 total = session tokens + 所有子代理 tokens，应单调递增
- 主会话可多次 idle-resume，token 数据应贯穿整个会话生命周期
- 关闭了子代理通知，收到的都是主会话消息
- 用户要求参考 @ramtinj95/opencode-tokenscope 插件

**Research Findings**:
- **Oracle 审计**: 发现 13 个问题（1 CRITICAL / 3 HIGH / 5 MEDIUM / 4 LOW）
- **opencode-tokenscope 分析**: 它是按需分析工具（`/tokenscope` 命令），通过 `client.session.children()` API 递归获取子会话。我们的事件驱动架构是正确的，只需修复生命周期管理 bug。可借鉴 `Number()||0` 安全模式和递归子会话遍历思路。

### Metis Review
**Identified Gaps** (addressed):
- SDK 可能返回字符串编码的 token 值：采用 `Number()||0` 模式防御
- 不应尝试迁移到 API 查询架构：显式排除，事件驱动模型正确
- 嵌套子会话需递归遍历：使用 sessionMap 做传递闭包，无需 API 调用

---

## Work Objectives

### Core Objective
修复 token 追踪系统的生命周期管理问题，确保同一会话内 token 值单调递增，子会话聚合完整。

### Concrete Deliverables
- `src/index.ts` - 修复 tokenDataMap/sessionMap 清理逻辑、聚合算法
- `tests/index.test.ts` - 新增多 idle 场景、子会话聚合、嵌套子会话等测试

### Definition of Done
- [ ] `bun test` 全部通过
- [ ] `npm run typecheck` 无错误
- [ ] 模拟多 idle 场景，token 值单调递增

### Must Have
- token 值在同一会话内单调递增（绝不减少）
- 子会话 token 正确聚合到父会话的 total 中
- 嵌套子会话（子会话的子会话）也被聚合
- 所有现有测试继续通过

### Must NOT Have (Guardrails)
- 不引入 `client.session.children()` 等 API 调用（架构变更，不是 bug 修复）
- 不改变消息模板格式（locales.ts 不动）
- 不改变外部配置接口（向后兼容）
- 不改变 ChannelSender/ChannelFormatter 接口
- 不重构为按需查询架构（保持事件驱动）
- 不过度抽象或引入新的 class 层级

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run specific tests, verify pass/fail

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - tests first):
+-- Task 1: 编写失败测试用例 [quick]
+-- Task 2: 修复 tokenDataMap 清理逻辑 (CRITICAL) [quick]

Wave 2 (After Wave 1 - related fixes):
+-- Task 3: 修复子会话聚合 + 嵌套递归 (HIGH) [deep]
+-- Task 4: Number()||0 安全模式 + sessionMap 清理 [quick]

Wave FINAL (After ALL tasks - 4 parallel reviews):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 2 -> Task 3 -> Task 4 -> F1-F4
Parallel Speedup: ~30% (Wave 1 sequential by design for TDD, Wave 2 can parallel)
Max Concurrent: 2 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2 | 1 |
| 2 | 1 | 3, 4 | 1 |
| 3 | 2 | F1-F4 | 2 |
| 4 | 2 | F1-F4 | 2 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks - T1 -> `quick`, T2 -> `quick`
- **Wave 2**: 2 tasks - T3 -> `deep`, T4 -> `quick`
- **FINAL**: 4 tasks - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. 编写失败测试用例 - 多 idle 场景 token 单调递增

  **What to do**:
  - 在 `tests/index.test.ts` 中新增 describe 块 `'token tracking across multiple idle events'`
  - **测试 A: 同一会话多次 idle，token 单调递增**
    - 创建主会话 (session.created)
    - 模拟 3 个 message.updated 事件（累积 token）
    - 触发第 1 次 session.idle -> 记录 payload 中的 sessionTokensTotal
    - 模拟 2 个新 message.updated 事件（更多 token）
    - 触发第 2 次 session.idle -> 验证 sessionTokensTotal > 第 1 次
    - 验证 totalTokensTotal 也单调递增
  - **测试 B: 子会话 token 聚合到父会话**
    - 创建主会话 + 子会话 (parentID = 主会话ID)
    - 子会话产生 token 数据
    - 触发主会话 session.idle
    - 验证 totalTokensTotal >= sessionTokensTotal + 子会话 tokens
  - **测试 C: 子会话先 idle 不影响父会话聚合**
    - 创建主会话 + 子会话
    - 子会话产生 token -> 子会话 idle（当前 bug: 会被删除）
    - 主会话产生 token -> 主会话 idle
    - 验证 totalTokensTotal 包含子会话的 token

  **Must NOT do**:
  - 不修改任何 src/ 文件
  - 不修改现有测试

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯测试编写，逻辑清晰
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - 无相关 skill

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (must complete before Task 2)
  - **Blocks**: Task 2, 3, 4
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `tests/index.test.ts:184-225` - 现有 session.idle 测试结构（mock event 创建、hooks 调用、断言模式）
  - `tests/index.test.ts:148-182` - session.created 事件测试（mock sessionInfo 创建模式）
  - `tests/index.test.ts:1329-1461` - session type filtering 测试（子会话 parentID 模式）

  **API/Type References**:
  - `src/types.ts:232-239` - TokenBreakdown 类型定义（input/output/reasoning/cacheRead/cacheWrite/total）
  - `src/types.ts:244-255` - TokenData 类型（cost + tokens + modelID）
  - `src/types.ts:260-269` - SessionTokenData 类型（messages Map + lastModelID）
  - `src/types.ts:146-190` - EventPayload 类型（sessionTokens/totalTokens 字段）

  **Test References**:
  - `tests/index.test.ts:96-98` - createMockEvent helper 函数
  - `tests/index.test.ts:100-105` - beforeEach/afterEach 清理模式

  **WHY Each Reference Matters**:
  - 现有 idle 测试展示了完整的 create -> idle 流程，新测试需要扩展为 create -> messages -> idle -> messages -> idle
  - TokenBreakdown 类型决定了需要 mock 的 token 数据结构
  - parentID 模式已在 session type filtering 测试中使用，可直接复用

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 新增测试全部失败 (预期 RED 阶段)
    Tool: Bash
    Preconditions: 未修改任何 src/ 文件
    Steps:
      1. bun test tests/index.test.ts --test-name-pattern "token tracking"
      2. 检查输出中测试数量 >= 3
      3. 检查所有新测试状态为 FAIL (预期行为 - 还没修复)
    Expected Result: 3+ tests found, all FAIL with "Expected X > Y" 类错误
    Failure Indicators: 测试 PASS (说明 bug 已不存在或测试写错) / 0 tests found (测试未注册)
    Evidence: .sisyphus/evidence/task-1-red-tests.txt

  Scenario: 现有测试不受影响
    Tool: Bash
    Preconditions: 新增测试文件已保存
    Steps:
      1. bun test tests/index.test.ts --test-name-pattern "^(?!token tracking)"
      2. 检查所有非 token tracking 测试 PASS
    Expected Result: 所有现有测试 PASS，0 failures
    Failure Indicators: 任何现有测试 FAIL
    Evidence: .sisyphus/evidence/task-1-existing-tests.txt
  ```

  **Commit**: NO (与 Task 2 一起提交)

- [x] 2. 修复 tokenDataMap 清理逻辑 (CRITICAL)

  **What to do**:
  - **核心修复**: 移除 `src/index.ts` L632-638 中 `session.idle` 时的 `tokenDataMap.delete(sid)` 调用
  - **就是这么简单**: 删掉那行 `tokenDataMap.delete(sid)` 即可
  - 不需要引入 completedSessions Set 或其他复杂机制，原因：
    - session ID 在同一进程中不会复用，每次 session.created 都是全新 ID
    - 主会话 idle 后，不会再有该会话的 message.updated 事件（OpenCode 不给 idle 会话发消息）
    - 因此不存在"旧数据被新数据污染"的风险
  - **session.error 同理**: L633 的 `session.error` 分支也删掉 `tokenDataMap.delete(sid)`
  - **验证**: 运行 Task 1 中编写的测试，确认从 FAIL 变为 PASS

  **Must NOT do**:
  - 不引入 client.session API 调用
  - 不改变消息模板格式
  - 不修改 types.ts 中的接口定义
  - 不修改 handler.ts 中的 formatTokenCount 逻辑
  - 不引入 completedSessions Set 等过度设计

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 修改范围小（约 15 行代码），逻辑清晰
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - 无相关 skill

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (after Task 1)
  - **Blocks**: Task 3, 4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/index.ts:632-638` - 当前的错误清理逻辑（需要修改的代码）
  - `src/index.ts:477-478` - tokenDataMap 和 sessionMap 的声明位置

  **API/Type References**:
  - `src/types.ts:260-269` - SessionTokenData 类型
  - `src/index.ts:494-510` - session.created 处理（清理时机参考）

  **WHY Each Reference Matters**:
  - L632-638 是 bug 所在，需要精确理解现有逻辑才能正确替换
  - completedSessions Set 的清理时机必须和 session.created 生命周期对齐

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Task 1 中的 3 个测试全部 PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Task 1 测试从 FAIL 变为 PASS (GREEN 阶段)
    Tool: Bash
    Preconditions: Task 1 测试存在且修改了 src/index.ts
    Steps:
      1. bun test tests/index.test.ts --test-name-pattern "token tracking"
      2. 检查所有测试状态为 PASS
    Expected Result: 3+ tests PASS, 0 failures
    Failure Indicators: 任何测试 FAIL
    Evidence: .sisyphus/evidence/task-2-green-tests.txt

  Scenario: 全量测试通过
    Tool: Bash
    Preconditions: 修复代码已写入
    Steps:
      1. bun test
      2. 检查所有测试 PASS
    Expected Result: ALL tests PASS, 0 failures
    Failure Indicators: 任何测试 FAIL（回归）
    Evidence: .sisyphus/evidence/task-2-full-tests.txt

  Scenario: TypeScript 类型检查通过
    Tool: Bash
    Steps:
      1. npm run typecheck
    Expected Result: 无错误输出
    Failure Indicators: 任何类型错误
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES (与 Task 1 合并)
  - Message: `fix(index): 修复 session.idle 时 tokenDataMap 被清除导致 token 值递减`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- [x] 3. 修复子会话聚合 + 嵌套递归

  **What to do**:
  - **修复 aggregateSubSessions 只找直接子节点的问题** (`src/index.ts` L302-314)
  - 当前代码 `sInfo?.parentID === sessionId` 只匹配直接子会话
  - **改为递归/传递闭包**: 收集所有后代会话（不仅仅是直接子节点）
    - 方案: 先收集所有 sessionId 的直接子节点，然后对每个子节点递归收集其子节点
    - 使用已有的 sessionMap 做遍历（不引入 API 调用）
  - **新增测试**:
    - 嵌套子会话测试: 主会话 -> 子会话 A -> 子会话 B(B 的 parentID = A)
    - 验证主会话的 totalTokens 包含 A 和 B 的 token
  - **确保子会话先 idle 不影响聚合**:
    - 验证 Task 2 的 completedSessions 方案下，子会话 idle 后 tokenDataMap 数据仍保留

  **Must NOT do**:
  - 不引入 client.session.children() API 调用
  - 不改变 aggregateSubSessions 的外部签名（保持向后兼容）
  - 不修改 types.ts

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解递归聚合逻辑，涉及 sessionMap 遍历优化
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - 无相关 skill

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 4)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/index.ts:282-331` - 当前 aggregateSubSessions 函数（需要修改）
  - `src/index.ts:33-61` - aggregateSessionTokens 函数（聚合逻辑参考）

  **API/Type References**:
  - `src/types.ts:260-269` - SessionTokenData 类型
  - `src/index.ts:477` - sessionMap 声明（用于遍历子会话树）

  **External References**:
  - `ramtinJ95/opencode-tokenscope` plugin/tokenscope-lib/subagent.ts - 递归子会话分析参考（它的 `analyzeChildSessions` 递归调用自身）

  **WHY Each Reference Matters**:
  - aggregateSubSessions 当前只做一层遍历，需要改为递归/传递闭包
  - tokenscope 的递归模式可参考但我们的实现用 sessionMap 不用 API

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 嵌套子会话聚合正确
    Tool: Bash
    Preconditions: 新增嵌套子会话测试
    Steps:
      1. 创建主会话 main-ses
      2. 创建子会话 child-a (parentID=main-ses) + 添加 token 数据
      3. 创建孙子会话 grandchild-b (parentID=child-a) + 添加 token 数据
      4. 触发 main-ses 的 session.idle
      5. 检查 payload 的 totalTokensTotal 包含 child-a + grandchild-b 的 token
    Expected Result: totalTokens = main + child-a + grandchild-b
    Failure Indicators: totalTokens 只包含 main + child-a（遗漏 grandchild-b）
    Evidence: .sisyphus/evidence/task-3-nested-subsessions.txt

  Scenario: 全量测试通过
    Tool: Bash
    Steps:
      1. bun test
    Expected Result: ALL tests PASS
    Failure Indicators: 任何回归
    Evidence: .sisyphus/evidence/task-3-full-tests.txt

  Scenario: 子会话先 idle 后父会话聚合仍然正确
    Tool: Bash
    Steps:
      1. 创建主会话 + 子会话
      2. 子会话产生 token -> 子会话 idle
      3. 主会话产生 token -> 主会话 idle
      4. 验证 totalTokens 包含子会话 token（子会话 idle 不应删除数据）
    Expected Result: totalTokens = main + child
    Failure Indicators: totalTokens = main only（子会话数据丢失）
    Evidence: .sisyphus/evidence/task-3-child-first-idle.txt
  ```

  **Commit**: YES
  - Message: `fix(index): 支持嵌套子会话的递归 token 聚合`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- [x] 4. Number()||0 安全模式 + sessionMap 清理策略

  **What to do**:
  - **Number()||0 安全模式** (`src/index.ts` L553-567):
    - 将 token 数据提取从 `sdkTokens?.input ?? 0` 改为 `Number(sdkTokens?.input) || 0`
    - 同样处理 cost 字段: `Number(msgInfo.cost) || 0`
    - 参考 opencode-tokenscope 的安全模式，防御 SDK 返回字符串/NaN/undefined
  - **sessionMap 清理策略**:
    - sessionMap 当前永不清理（Oracle 审计 #2: 内存泄漏）
    - 但实际上一个 OpenCode 进程内会话数量有限（用户手动创建的 + 子代理的），不会造成严重泄漏
    - **简单方案**: 暂不处理。如果后续需要，可以加一个简单的阈值清理（超过 50 个条目时清理所有非活跃会话）
    - 当前优先级: LOW -- 先修核心 bug，内存清理可以后续迭代
  - **新增测试**:
    - 测试 SDK 返回字符串 token 值时的正确处理
    - 测试大量会话后的内存清理

  **Must NOT do**:
  - 不引入复杂的 LRU cache 或外部依赖
  - 不过度工程化清理策略（简单阈值即可）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 改动小且分散，主要是类型安全加固
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - 无相关 skill

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3)
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/index.ts:553-567` - 当前 token 数据提取代码（需要修改）
  - `src/index.ts:477-478` - sessionMap/tokenDataMap 声明

  **External References**:
  - `ramtinJ95/opencode-tokenscope` plugin/tokenscope-lib/subagent.ts - `Number(val) || 0` 安全模式参考

  **WHY Each Reference Matters**:
  - tokenscope 使用 Number()||0 是经过验证的防御性编程模式
  - sessionMap 泄漏是 Oracle 审计中的 HIGH 问题

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 字符串 token 值被正确转换
    Tool: Bash
    Preconditions: 新增字符串 token 测试
    Steps:
      1. 创建会话
      2. 模拟 message.updated 事件，tokens.input 为字符串 "1500"
      3. 触发 session.idle
      4. 检查 payload.sessionTokens.input 为数字 1500
    Expected Result: Number 类型，值为 1500
    Failure Indicators: 值为字符串 "1500" 或 NaN
    Evidence: .sisyphus/evidence/task-4-string-tokens.txt

  Scenario: 全量测试通过
    Tool: Bash
    Steps:
      1. bun test
      2. npm run typecheck
    Expected Result: ALL tests PASS, typecheck clean
    Failure Indicators: 任何回归
    Evidence: .sisyphus/evidence/task-4-full-tests.txt
  ```

  **Commit**: YES
  - Message: `fix(index): 增加 Number() 安全转换和 sessionMap 清理策略`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** -- `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** -- `unspecified-high`
  Run `bun test tests/index.test.ts` - verify ALL token-related tests pass. Run full `bun test` suite. Check that NO existing tests regressed.
  Output: `Tests [N/N pass] | Regressions [N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 match. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit 1** (Task 1+2): `fix(index): 修复 session.idle 时 tokenDataMap 被清除导致 token 值递减`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- **Commit 2** (Task 3): `fix(index): 支持嵌套子会话的递归 token 聚合`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- **Commit 3** (Task 4): `fix(index): 增加 Number() 安全转换和 sessionMap 清理策略`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

---

## Success Criteria

### Verification Commands
```bash
bun test tests/index.test.ts    # Expected: all tests pass
npm run typecheck               # Expected: no errors
npm run lint                    # Expected: no new warnings
```

### Final Checklist
- [ ] 同一会话多次 idle 时 token 值单调递增
- [ ] 子会话 token 正确聚合到父会话
- [ ] 嵌套子会话（孙子级）也被聚合
- [ ] sessionMap 有清理机制，不会无限增长
- [ ] 所有现有测试继续通过
- [ ] 未引入 client.session API 调用
- [ ] 未修改模板或外部接口
