# 修复通知 Token 显示与 OpenCode UI 不一致

## TL;DR

> **问题**: 通知报告的 sessionTokens (3.1M) 与 OpenCode UI (125.4K) 不一致。根因是 `aggregateSessionTokens()` 将所有消息的 total 求和，每条消息的 total 包含完整上下文（cacheRead），导致共享上下文被重复计算 N 次。
> 
> **修复**: 改用最后一次 API 调用的 token 数据（与 OpenCode UI 一致），费用保持累计求和。
> 
> **交付物**:
> - 修改后的 `aggregateSessionTokens()` 函数
> - 更新的测试用例
> - 更新的 CLI mock 数据
> 
> **预计工作量**: Medium（1-2小时）
> **并行执行**: NO - 顺序执行（单文件核心改动 + 测试更新）
> **关键路径**: Task 1 → Task 2 → Task 3 → Task 4 → 验证

---

## Context

### 原始需求
用户发现通知中显示的 Token 数（如 2.6M、3.1M）与 OpenCode UI 界面显示的数值（如 125.4K）严重不一致。

### 调研摘要
**关键讨论**:
- 用户确认：通知中的 sessionTokens 应该与 OpenCode UI 一致
- OpenCode UI 显示的是最后一次 API 调用的 total（当前上下文窗口大小），而非累计值
- 用户期望 sessionTokens 匹配 UI，totalTokens 为主会话 + 子会话的汇总

**调研发现**:
- OpenCode Go 源码 `TrackUsage()` 使用 `=` 覆盖（非 `+=` 累加）PromptTokens/CompletionTokens
- OpenCode UI 公式: `totalTokens = (InputTokens + CacheWriteTokens) + (OutputTokens + CacheReadTokens)`
- DB 验证: msg#44 的 total=125,422 完美匹配用户看到的 125.4K
- OpenCode 不在显示中包含 `reasoning` 字段
- 当前插件的 `total` 公式: `input + output + reasoning + cacheRead + cacheWrite`，包含 reasoning，与 OpenCode 不一致

### Metis 审查
**已处理的差距**:
- `reasoning` 字段处理: 从 `total` 中排除以匹配 OpenCode 公式
- 费用累计: 保持不变（跨所有消息求和）
- 子会话聚合: 自动适配因为消费 `aggregateSessionTokens()` 的输出
- 测试更新范围: index.test.ts L2441-3522、full-flow.test.ts、cli.ts mock 数据

---

## Work Objectives

### 核心目标
修改 token 聚合逻辑，使通知中的 sessionTokens 与 OpenCode UI 显示一致。

### 具体交付物
- `src/index.ts` 中 `aggregateSessionTokens()` 使用最后一条消息的 token 数据
- `total` 字段使用 OpenCode 公式: `input + output + cacheRead + cacheWrite`（排除 reasoning）
- 费用（cost）保持跨所有消息累计求和
- 所有相关测试用例更新

### 完成定义
- [ ] `bun test` 全部通过
- [ ] `npm run typecheck` 无错误
- [ ] `npm run lint` 无错误
- [ ] 新增测试验证 last-message 语义

### 必须有
- sessionTokens 的所有字段（input/output/reasoning/cacheRead/cacheWrite/total）来自最后一条 assistant 消息
- sessionCost 保持跨所有消息累计（不改变）
- total 公式排除 reasoning: `total = input + output + cacheRead + cacheWrite`
- totalTokens = sum(每个会话的 last-message total)
- reasoning 字段在 TokenBreakdown 中保留（自定义模板可能使用）

### 必须没有（防护栏）
- 不改变模板变量名称
- 不改变费用计算逻辑
- 不改变 `message.updated` 事件处理逻辑
- 不添加累计 token 字段（如 sessionTokensCumulative）
- 不改变 `formatTokenCount()` 函数
- 不改变 TokenBreakdown 类型定义（同字段同名称）
- 不改变 `collectDescendantSessionIds()` 逻辑

---

## Verification Strategy (MANDATORY)

> **零人工介入** - 所有验证由 agent 执行。

### 测试决策
- **基础设施存在**: YES（bun test）
- **自动化测试**: YES（TDD 方式）
- **框架**: bun test
- **TDD**: 每个任务遵循 RED -> GREEN 流程

### QA 策略
每个任务包含 agent 执行的 QA 场景。
证据保存到 `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`。

---

## Execution Strategy

### 顺序执行（单核心改动，无并行空间）

```
Task 1 (RED - 写失败测试):
└── 新增测试用例，验证 last-message 语义，预期 FAIL

Task 2 (GREEN - 修改聚合逻辑):
└── 修改 aggregateSessionTokens() + fillTokenData() + aggregateSubSessions()

Task 3 (GREEN - 更新现有测试和 mock):
└── 更新 index.test.ts / full-flow.test.ts / cli.ts 中的期望值

Task 4 (REFACTOR - 验证和清理):
└── bun test + typecheck + lint 全量验证

Wave FINAL (验证):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
-> 展示结果 -> 获得用户确认

Critical Path: Task 1 -> Task 2 -> Task 3 -> Task 4 -> F1-F4 -> 用户确认
```

### Agent 调度摘要
- **Task 1**: `deep` (TDD 需要理解现有测试模式)
- **Task 2**: `deep` (核心逻辑改动需要仔细处理)
- **Task 3**: `quick` (机械更新测试期望值)
- **Task 4**: `quick` (运行验证命令)
- **FINAL**: F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. 新增失败测试用例（RED 阶段）

  **做什么**:
  - 在 `tests/index.test.ts` 中新增测试组 `describe("aggregateSessionTokens: last-message semantics")`
  - 测试用例 1: 3+ 消息的会话，验证 `sessionTokens.total` = 最后一条消息的 `input + output + cacheRead + cacheWrite`（排除 reasoning）
  - 测试用例 2: 验证 `sessionCost` = 所有消息费用之和（不变）
  - 测试用例 3: 验证 `reasoning` 字段在 breakdown 中可用但不在 `total` 中
  - 测试用例 4: 单条消息会话（行为与当前相同）
  - 测试用例 5: 无消息会话（所有 token 字段 undefined/0）
  - 测试用例 6: 子会话聚合: `totalTokens.total` = 各会话 last-message total 之和
  - 使用现有的 `createMockAssistantMessage()` 辅助函数（L2443 附近）
  - 这些测试在此阶段应 FAIL

  **禁止做**:
  - 不修改任何源代码文件
  - 不修改现有测试用例（只新增）
  - 不改变测试辅助函数

  **推荐 Agent 配置**:
  - **Category**: `deep`
  - **Skills**: []

  **并行化**:
  - **可并行**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 2, 3, 4
  - **Blocked By**: None

  **References**:
  - `tests/index.test.ts:2441-3522` - 现有 token 聚合测试，包含 `createMockAssistantMessage()` 辅助函数和测试模式
  - `src/index.ts:33-61` - `aggregateSessionTokens()` 当前实现（求和逻辑）
  - `src/types.ts:242-249` - `TokenBreakdown` 类型定义
  - OpenCode 公式: `total = (input + cacheWrite) + (output + cacheRead)` = `input + output + cacheRead + cacheWrite`

  **验收标准**:

  **QA 场景（必填）**:
  ```
  Scenario: 新增测试全部 FAIL（RED 阶段验证）
    Tool: Bash
    Preconditions: 源代码未修改
    Steps:
      1. 运行 bun test tests/index.test.ts
      2. 确认新增的 describe("aggregateSessionTokens: last-message semantics") 测试 FAIL
      3. 确认现有测试仍然 PASS（未被破坏）
    Expected Result: 新增测试 FAIL，现有测试 PASS
    Failure Indicators: 现有测试 FAIL（破坏了已有功能）
    Evidence: .sisyphus/evidence/task-1-red-tests.txt
  ```

  **Commit**: NO（与 Task 2 合并提交）

---

- [x] 2. 修改聚合逻辑（GREEN 阶段 - 核心修复）

  **做什么**:
  - 修改 `src/index.ts` 中 `aggregateSessionTokens()` 函数:
    - Token 字段（input/output/reasoning/cacheRead/cacheWrite）改为使用**最后一条** assistant 消息的数据
    - `total` 改为 `input + output + cacheRead + cacheWrite`（排除 reasoning，匹配 OpenCode 公式）
    - **费用（cost）保持累计求和**（不改变）
  - 修改 `src/index.ts` 中 `fillTokenData()` 函数:
    - 如果 `aggregateSessionTokens()` 返回值语义改变，确认 `fillTokenData()` 正确使用
    - `payload.modelID`/`providerID`/`mode` 已经取最后一条消息的值（不变）
  - 修改 `src/index.ts` 中 `aggregateSubSessions()` 函数:
    - 验证其正确消费新的 `aggregateSessionTokens()` 输出
    - `totalTokens.total` = main session last-msg total + 各 sub-session last-msg total
  - 修改 `src/index.ts` 中 `message.updated` handler 的 `tokenData.tokens.total` 计算:
    - 改为 `input + output + cacheRead + cacheWrite`（排除 reasoning）
  - 修改 `src/cli.ts` 中 mock token 数据的 `total` 字段（如有）

  **禁止做**:
  - 不改变 TokenBreakdown 类型定义
  - 不改变模板变量名称
  - 不改变费用计算逻辑
  - 不改变 `message.updated` 事件的 Map 存储语义
  - 不改变 `formatTokenCount()` 函数

  **推荐 Agent 配置**:
  - **Category**: `deep`
  - **Skills**: []

  **并行化**:
  - **可并行**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 3, 4
  - **Blocked By**: Task 1

  **References**:
  - `src/index.ts:33-61` - `aggregateSessionTokens()` 当前实现，需改为 last-message 语义
  - `src/index.ts:242-276` - `fillTokenData()` 使用聚合结果填充 payload
  - `src/index.ts:346-395` - `aggregateSubSessions()` 消费聚合结果
  - `src/index.ts:567-581` - `message.updated` handler 中 TokenData 构造和 total 计算
  - `src/cli.ts:26` - CLI mock token 数据（`total: 20500` 等，需确认公式）
  - OpenCode Go 源码公式: `PromptTokens = InputTokens + CacheCreationTokens`, `CompletionTokens = OutputTokens + CacheReadTokens`, `UI = PromptTokens + CompletionTokens`

  **验收标准**:

  **QA 场景（必填）**:
  ```
  Scenario: 新增测试通过（GREEN 阶段验证）
    Tool: Bash
    Preconditions: Task 1 的测试用例存在
    Steps:
      1. 运行 bun test tests/index.test.ts
      2. 确认 describe("aggregateSessionTokens: last-message semantics") 全部 PASS
      3. 确认整体测试套件无回归
    Expected Result: 所有新增测试 PASS，无回归
    Failure Indicators: 新增测试仍 FAIL，或现有测试 FAIL
    Evidence: .sisyphus/evidence/task-2-green-tests.txt

  Scenario: typecheck 通过
    Tool: Bash
    Steps:
      1. 运行 npm run typecheck
    Expected Result: 无错误
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: NO（与 Task 1, 3 合并提交）

---

- [x] 3. 更新现有测试期望值和 mock 数据（GREEN 继续）

  **做什么**:
  - 使用 `ast_grep_search` 或 `grep` 查找所有引用 `aggregateSessionTokens` 或 token 求和行为的测试断言
  - 更新 `tests/index.test.ts` 中依赖求和语义的断言:
    - 搜索 `sessionTokens` 相关的 `expect()` 调用
    - 将求和期望改为 last-message 期望
  - 更新 `tests/integration/full-flow.test.ts` 中 `Token(session/total)` 格式的文本断言
  - 更新 `src/cli.ts` 中 mock 数据的 `total` 字段（排除 reasoning）
  - 确认 `tests/handler.test.ts` 中 `formatTokenCount()` 测试不需要改动（纯格式函数）
  - 运行完整测试套件确认所有 PASS

  **禁止做**:
  - 不删除任何现有测试用例（只更新期望值）
  - 不改变测试辅助函数
  - 不改变 formatTokenCount 测试

  **推荐 Agent 配置**:
  - **Category**: `quick`
  - **Skills**: []

  **并行化**:
  - **可并行**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: Task 4
  - **Blocked By**: Task 2

  **References**:
  - `tests/index.test.ts:2441-3522` - Token 聚合测试，需更新所有求和期望为 last-message 期望
  - `tests/integration/full-flow.test.ts` - 集成测试，可能包含 `Token(420/990)` 等文本断言
  - `src/cli.ts:26` - CLI mock 数据，`total` 字段需使用新公式
  - `tests/handler.test.ts` - formatTokenCount 测试，确认不需改动

  **验收标准**:

  **QA 场景（必填）**:
  ```
  Scenario: 完整测试套件通过
    Tool: Bash
    Steps:
      1. 运行 bun test
      2. 确认所有测试 PASS（0 failures）
    Expected Result: 全部 PASS
    Failure Indicators: 任何测试 FAIL
    Evidence: .sisyphus/evidence/task-3-full-test.txt
  ```

  **Commit**: YES
  - Message: `fix(token): 修复 sessionTokens 与 OpenCode UI 不一致`
  - Files: `src/index.ts`, `tests/index.test.ts`, `tests/integration/full-flow.test.ts`, `src/cli.ts`
  - Pre-commit: `bun test`

---

- [x] 4. 全量验证和清理（REFACTOR 阶段）

  **做什么**:
  - 运行 `bun test` 确认全量通过
  - 运行 `npm run typecheck` 确认无类型错误
  - 运行 `npm run lint` 确认无 lint 错误
  - 使用 `ast_grep_search` 搜索所有 `total:` 计算点，确认公式一致（`input + output + cacheRead + cacheWrite`，排除 reasoning）
  - 检查是否有遗漏的测试期望值

  **禁止做**:
  - 不做额外重构
  - 不添加新功能

  **推荐 Agent 配置**:
  - **Category**: `quick`
  - **Skills**: []

  **并行化**:
  - **可并行**: NO
  - **Parallel Group**: Sequential
  - **Blocks**: FINAL
  - **Blocked By**: Task 3

  **References**:
  - 所有 src/ 和 tests/ 文件

  **验收标准**:

  **QA 场景（必填）**:
  ```
  Scenario: 三项验证全部通过
    Tool: Bash
    Steps:
      1. bun test -> 0 failures
      2. npm run typecheck -> 无错误
      3. npm run lint -> 无错误
    Expected Result: 三项全部通过
    Evidence: .sisyphus/evidence/task-4-verify.txt

  Scenario: total 公式一致性检查
    Tool: Bash (ast_grep_search)
    Steps:
      1. 搜索所有 TokenBreakdown.total 的计算点
      2. 确认每个都使用 input + output + cacheRead + cacheWrite（无 reasoning）
    Expected Result: 所有计算点使用一致公式
    Evidence: .sisyphus/evidence/task-4-formula-consistency.txt
  ```

  **Commit**: NO（如有清理需要，amend 到 Task 3 的 commit）

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Plan Compliance Audit** — `oracle`
  审查计划中的每个 "Must Have" 和 "Must NOT Have"。验证实现存在且符合规范。检查 `.sisyphus/evidence/` 中的证据文件。
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  运行 `tsc --noEmit` + linter + `bun test`。审查改动文件。
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  验证所有 QA 场景。检查证据文件存在且内容正确。
  Output: `Scenarios [N/N pass] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  验证改动范围严格限于 token 聚合逻辑，未触及费用、模板、事件处理等。
  Output: `Tasks [N/N compliant] | VERDICT`

---

## Commit Strategy

- **1**: `fix(token): 修复 sessionTokens 与 OpenCode UI 不一致` - src/index.ts, tests/index.test.ts, tests/integration/full-flow.test.ts, src/cli.ts
  Pre-commit: `bun test && npm run typecheck`

---

## Success Criteria

### 验证命令
```bash
bun test                    # 预期: 全部通过
npm run typecheck           # 预期: 无错误
npm run lint                # 预期: 无错误
```

### 最终检查清单
- [ ] 所有 "Must Have" 存在
- [ ] 所有 "Must NOT Have" 不存在
- [ ] 所有测试通过
- [ ] sessionTokens.total = 最后一条消息的 input + output + cacheRead + cacheWrite
- [ ] sessionCost = 所有消息费用之和（不变）
- [ ] reasoning 字段在 breakdown 中可用但不在 total 中
- [ ] totalTokens = 各会话 last-message total 之和
