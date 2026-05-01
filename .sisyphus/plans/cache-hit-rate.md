# 缓存命中率变量 + 默认模板更新

## TL;DR

> **Quick Summary**: 新增缓存命中率计算变量（session/total/project 三级），并将 session 级命中率添加到默认通知模板的 Token 行中。
>
> **Deliverables**:
> - `calcCacheHitRate()` 辅助函数（handler.ts，export 用于测试）
> - 3 个新模板变量：sessionCacheHitRate、totalCacheHitRate、projectCacheHitRate
> - 更新 locales.ts 中 16 个 Token 行模板（en + zh，排除 created 事件）
> - 完整 TDD 测试覆盖
> - 文档更新
>
> **Estimated Effort**: Quick-Short
> **Parallel Execution**: YES - 2 waves + Final
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4

---

## Context

### Original Request
用户希望新增缓存命中率变量，并添加到默认模板中。经过可行性分析确认：cacheRead/cacheWrite 已在所有聚合层级被追踪，可直接计算 `cacheRead / total * 100%`。

### Interview Summary
**Key Discussions**:
- 公式：`cacheRead / total * 100%`，total = input + output + cacheRead + cacheWrite
- 三层级：session、total、project
- 格式：百分比字符串如 "89.5%"，total=0 或 undefined 时返回 "N/A"
  - 模板中显示 session 级（当前会话最有参考意义），三级变量都注册
  - total/project 级变量仅注册供自定义模板使用，不放默认模板
- created 事件模板不改（无 token 数据）

**Research Findings**:
- handler.ts 已有完整的 cacheRead/cacheWrite 追踪（lines 216-257）
- TokenBreakdown.total = input + output + cacheRead + cacheWrite（不含 reasoning）
- 模板引擎 template.ts:10 对 undefined 变量渲染为空字符串 → cache hit rate 必须无条件注册
- locales.ts 有 18 个 Token 行（9 事件 x 2 语言），其中 16 个需要更新（排除 created 的 2 个）

### Metis Review
**Identified Gaps** (addressed):
- undefined 变量渲染为空字符串 → calcCacheHitRate(undefined) 返回 "N/A"，变量无条件注册
- NaN/Infinity/负数防御 → 返回 "N/A"
- created 事件模板不改（无 token 数据）
- 一位小数精度 toFixed(1)

---

## Work Objectives

### Core Objective
新增缓存命中率计算变量并更新默认通知模板，让用户在通知中直接看到缓存效率。

### Concrete Deliverables
- `src/handler.ts`: `calcCacheHitRate()` 函数 + 3 个新变量注册
- `src/locales.ts`: 16 个 Token 行更新
- `tests/`: 完整 TDD 测试
- `docs/`: 文档更新

### Definition of Done
- [ ] `bun test` 全量通过（含新增测试）
- [ ] `npm run typecheck` 无错误
- [ ] 3 个新变量在 recorder JSONL 中可见
- [ ] 默认模板 Token 行包含缓存命中率

### Must Have
- `calcCacheHitRate(tokens?)` 纯函数，undefined/0/NaN/Infinity → "N/A"，正常 → "89.5%"
- 3 个新变量：sessionCacheHitRate、totalCacheHitRate、projectCacheHitRate
- 变量无条件注册（始终有值，不依赖 != null 守卫）
- locales.ts 16 个 Token 行更新（en + zh，排除 created）
- Token 行新格式：`Token(12.5K/10.4M/764.7M) Cache:89.5% glm-5.1`
- TDD 测试覆盖

### Must NOT Have (Guardrails)
- 不修改 TokenBreakdown 类型
- 不修改 index.ts 中的聚合逻辑
- 不修改 created 事件模板
- 不引入新依赖
- 不修改 template.ts 渲染引擎
- 不修改 recorder.ts（自动消费）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: Bun test (`bun:test`)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - calc + handler):
+-- Task 1: handler.ts - calcCacheHitRate + 3 个新变量 [unspecified-high]
+-- Task 2: locales.ts - 16 个 Token 行更新 (depends: 1) [quick]

Wave 2 (After Wave 1 - tests + docs):
+-- Task 3: tests - TDD 测试覆盖 (depends: 1) [unspecified-high]
+-- Task 4: docs - 文档更新 (depends: 1, 2) [writing]

Wave FINAL (After ALL tasks - 4 parallel reviews, then user okay):
+-- F1: Plan compliance audit (oracle)
+-- F2: Code quality review (unspecified-high)
+-- F3: Real manual QA (unspecified-high)
+-- F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 2 -> Task 4 -> F1-F4
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Waves 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2, 3, 4 | 1 |
| 2 | 1 | 4 | 1 |
| 3 | 1 | F1-F4 | 2 |
| 4 | 1, 2 | F1-F4 | 2 |
| F1-F4 | 3, 4 | user okay | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **2** - T1 -> `unspecified-high`, T2 -> `quick`
- **Wave 2**: **2** - T3 -> `unspecified-high`, T4 -> `writing`
- **FINAL**: **4** - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. handler.ts - calcCacheHitRate 函数 + 3 个新变量注册

  **What to do**:
  - 在 `handler.ts` 中添加 `calcCacheHitRate(tokens: TokenBreakdown | undefined): string` 辅助函数：
    - tokens 为 undefined 或 null → 返回 `"N/A"`
    - tokens.total === 0 → 返回 `"N/A"`
    - 结果为 NaN 或 Infinity → 返回 `"N/A"`
    - 正常计算：`(tokens.cacheRead / tokens.total * 100).toFixed(1) + "%"`
    - 注意：total = input + output + cacheRead + cacheWrite（已排除 reasoning）
  - export 此函数用于测试
  - 在 handler.ts 的 variables map 中（约 line 258 之后，系统变量之前）添加 3 个新变量：
    - `sessionCacheHitRate: calcCacheHitRate(payload.sessionTokens)`
    - `totalCacheHitRate: calcCacheHitRate(payload.totalTokens)`
    - `projectCacheHitRate: calcCacheHitRate(payload.projectTokens)`
  - **关键**：这 3 个变量**无条件注册**（不做 `!= null` 守卫），因为 `calcCacheHitRate(undefined)` 返回 `"N/A"`，保证模板始终有值

  **TDD Steps**:
  1. RED: 编写 calcCacheHitRate 测试（6 个 case：正常89.5%/全命中100.0%/无命中0.0%/total=0/undefined/大数）
  2. GREEN: 实现 calcCacheHitRate
  3. REFACTOR: 确认函数位置合理

  **Must NOT do**:
  - 不修改 TokenBreakdown 类型
  - 不修改 index.ts 聚合逻辑
  - 不对 cache hit rate 变量使用 `!= null` 守卫

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解 handler.ts 变量注册模式和防御性编程
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2, but Task 2 conceptually depends on knowing variable name)
  - **Blocks**: Tasks 2, 3, 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/handler.ts:216-258` - 现有 token 变量注册区域（sessionTokensCacheRead 等），新变量加在此区域末尾
  - `src/handler.ts:100-110` - `formatTokenCount()` 辅助函数，calcCacheHitRate 应放在类似位置

  **API/Type References**:
  - `src/types.ts:256-263` - TokenBreakdown 接口（input, output, reasoning, cacheRead, cacheWrite, total）
  - `src/handler.ts:72` - `total = input + output + cacheRead + cacheWrite`（确认 total 定义）

  **Test References**:
  - `tests/handler-system-vars.test.ts` - 现有系统变量测试，mock.module 模式
  - `tests/handler.test.ts` - handler 集成测试模式

  **WHY Each Reference Matters**:
  - handler.ts:216-258 确定变量插入的精确位置
  - formatTokenCount() 是同类辅助函数，新函数应遵循相同模式（export、位置、命名）
  - TokenBreakdown.total 的定义决定了分母的组成

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 测试文件包含 calcCacheHitRate 的 6 个测试用例
  - [ ] `bun test` PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: calcCacheHitRate 正常计算
    Tool: Bash (bun test)
    Preconditions: handler.ts 已添加 calcCacheHitRate
    Steps:
      1. 测试 calcCacheHitRate({input:100, output:50, reasoning:10, cacheRead:800, cacheWrite:50, total:1000})
      2. 验证返回 "80.0%"
    Expected Result: "80.0%"
    Failure Indicators: 其他值或精度不对
    Evidence: .sisyphus/evidence/task-1-normal-calc.txt

  Scenario: calcCacheHitRate 边界情况
    Tool: Bash (bun test)
    Preconditions: handler.ts 已添加 calcCacheHitRate
    Steps:
      1. 测试 undefined → "N/A"
      2. 测试 total=0 → "N/A"
      3. 测试 cacheRead=0 → "0.0%"
      4. 测试 cacheRead=total → "100.0%"
    Expected Result: 每个边界返回正确值
    Failure Indicators: 返回 undefined、空字符串、或抛出异常
    Evidence: .sisyphus/evidence/task-1-edge-cases.txt

  Scenario: handler variables 包含 cache hit rate
    Tool: Bash (bun test)
    Preconditions: handler 已注册新变量
    Steps:
      1. 创建 handler 并触发 handle()
      2. 检查 sentMessages 中的 variables
      3. 验证 sessionCacheHitRate、totalCacheHitRate、projectCacheHitRate 存在
      4. 验证值为百分比格式（如 "89.5%"）或 "N/A"
    Expected Result: 3 个变量存在且有值
    Failure Indicators: 变量缺失或值为 undefined/空字符串
    Evidence: .sisyphus/evidence/task-1-handler-vars.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(vars): add cache hit rate calculation and variables`
  - Files: `src/handler.ts, tests/`
  - Pre-commit: `bun test`

- [x] 2. locales.ts - 更新 16 个 Token 行模板

  **What to do**:
  - 将 locales.ts 中所有 Token 行（排除 created 事件的 2 个）的格式从：
    ```
    Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}}) {{modelID}}
    ```
    更新为：
    ```
    Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}}) Cache:{{sessionCacheHitRate}} {{modelID}}
    ```
  - 涉及 16 个 Token 行（en: idle, error, question, permission, status, command, file, todo = 8 个; zh: 同样 8 个）
  - **不改** created 事件的模板（created 模板格式不同，用 `Project Token: {{projectTokensTotalHuman}}`）
  - 模板使用 **session 级**命中率，因为当前会话的缓存效率最有参考价值

  **Must NOT do**:
  - 不修改 created 事件模板
  - 不修改模板中的其他内容
  - 不添加额外的 Token 信息

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯文本替换，模式统一
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（概念上依赖 Task 1 的变量名，但变量名已确定）
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 4
  - **Blocked By**: None（变量名 totalCacheHitRate 已确定）

  **References**:

  **Pattern References**:
  - `src/locales.ts:39` - en idle 模板 Token 行，作为替换模式
  - `src/locales.ts:87` - zh idle 模板 Token 行，作为替换模式

  **WHY Each Reference Matters**:
  - locales.ts 的 Token 行格式是统一的，找到一个就找到所有

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 所有非 created Token 行包含 Cache 命中率
    Tool: Bash (grep)
    Preconditions: locales.ts 已更新
    Steps:
      1. grep -c "Cache:" src/locales.ts，验证计数为 16
      2. grep "Token(" src/locales.ts，验证所有 16 行包含 Cache:{{sessionCacheHitRate}}
      3. 验证 created 事件的 2 行未被修改（不包含 Cache:）
    Expected Result: 16 个 Token 行包含 Cache:{{sessionCacheHitRate}}，2 个 created 行不含
    Failure Indicators: 计数不为 16 或 created 行被误改
    Evidence: .sisyphus/evidence/task-2-locale-update.txt

  Scenario: TypeScript 编译通过
    Tool: Bash
    Preconditions: locales.ts 已更新
    Steps:
      1. npm run typecheck
    Expected Result: 0 errors
    Failure Indicators: 编译错误
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(templates): add cache hit rate to default notification templates`
  - Files: `src/locales.ts`
  - Pre-commit: `npm run typecheck`

- [x] 3. tests - TDD 完整测试覆盖

  **What to do**:
  - 创建 `tests/cache-hit-rate.test.ts`：
    - `calcCacheHitRate()` 纯函数测试（6 个 case）：
      1. 正常计算（80.0%）
      2. 全命中（100.0%）
      3. 无命中（0.0%）
      4. total = 0 → "N/A"
      5. undefined → "N/A"
      6. 大数精度（cacheRead=9342976, total=10476071 → 验证 toFixed(1) 精度）
    - NaN/Infinity 防御测试：
      7. cacheRead 为负数 → "N/A"
    - handler 集成测试：验证 3 个变量出现在 sentMessages 中
  - 验证 `bun test` 全量通过

  **Must NOT do**:
  - 不修改现有测试文件
  - 不 mock calcCacheHitRate（直接测试真实函数）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要构造合适的 mock payload 和断言
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1

  **References**:

  **Test References**:
  - `tests/handler-system-vars.test.ts` - 系统变量测试模式，mock.module + sentMessages
  - `tests/handler-custom-vars.test.ts` - 自定义变量测试，展示如何构造 config 和 payload

  **WHY Each Reference Matters**:
  - handler-system-vars.test.ts 展示了如何 mock handler 依赖并捕获 sentMessages

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] test file created: tests/cache-hit-rate.test.ts
  - [ ] bun test tests/cache-hit-rate.test.ts -> PASS (7+ test cases, 0 failures)
  - [ ] bun test -> PASS (全量，含新增 + 现有)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全量测试通过
    Tool: Bash (bun test)
    Preconditions: 所有测试文件已创建
    Steps:
      1. 运行 bun test
      2. 验证 0 failures
      3. 验证 tests/cache-hit-rate.test.ts 中的所有测试通过
    Expected Result: 全部 PASS，无回归
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-3-full-test.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(vars): add cache hit rate calculation and variables`
  - Files: `src/handler.ts, tests/cache-hit-rate.test.ts`
  - Pre-commit: `bun test tests/cache-hit-rate.test.ts`

- [x] 4. docs - 文档更新

  **What to do**:
  - **README.md**: 在 Template Variables 表中追加 `{{totalCacheHitRate}}` / `{{sessionCacheHitRate}}` / `{{projectCacheHitRate}}` 三行
  - **docs/configuration.md**:
    - Section 8.1 通用变量表：追加 3 个 cache hit rate 变量行
    - Section 8.5 变量速查表：确认归类到 "通用变量"
  - 更新变量总数引用（68+ → 71+）

  **Must NOT do**:
  - 不修改代码逻辑
  - 不重构文档体系

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 纯文档任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `README.md:Template Variables section` - 现有变量表，追加新行
  - `docs/configuration.md:190-203 (Section 8.1)` - 通用变量表

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: README 包含 cache hit rate 变量
    Tool: Bash (grep)
    Preconditions: README.md 已更新
    Steps:
      1. grep "cacheHitRate" README.md
      2. 验证至少 3 个变量（session/total/project）出现
    Expected Result: 3 个变量出现在表格中
    Failure Indicators: 变量缺失
    Evidence: .sisyphus/evidence/task-4-readme.txt

  Scenario: configuration.md 包含 cache hit rate 文档
    Tool: Bash (grep)
    Preconditions: docs/configuration.md 已更新
    Steps:
      1. grep "cacheHitRate" docs/configuration.md
      2. 验证出现在通用变量表中
    Expected Result: 文档包含新变量说明
    Failure Indicators: 缺失
    Evidence: .sisyphus/evidence/task-4-config-docs.txt
  ```

  **Commit**: YES
  - Message: `docs: add cache hit rate variable documentation`
  - Files: `README.md, docs/configuration.md`
  - Pre-commit: (none)

---

## Final Verification Wave (MANDATORY -- after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns -- reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task -- follow exact steps, capture evidence. Test edge cases: total=0, undefined tokens, 100% cache hit. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 -- everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1+3**: `feat(vars): add cache hit rate calculation and variables` - src/handler.ts, tests/
- **Task 2**: `feat(templates): add cache hit rate to default notification templates` - src/locales.ts
- **Task 4**: `docs: add cache hit rate variable documentation` - docs/, README.md

---

## Success Criteria

### Verification Commands
```bash
bun test                                          # Expected: all tests pass (0 failures)
npm run typecheck                                 # Expected: no errors
npm run lint                                      # Expected: no new errors
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] recorder JSONL contains cache hit rate variables
- [ ] Default template Token line includes Cache:XX.X%
