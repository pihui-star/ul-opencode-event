# 简化默认通知模板的 Token 显示

## TL;DR

> **Quick Summary**: 简化 `locales.ts` 中默认通知模板，去掉详细 token 明细、费用和 providerID。所有非 created 事件统一一行紧凑格式显示: token(session/total) + 模型。
> 
> **Deliverables**:
> - 修改 `src/locales.ts` 中 16 个事件模板（2 语言 x 8 事件类型）
> - 更新 `tests/locales.test.ts` 中相关断言
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - 单任务原子操作
> **Critical Path**: Task 1 (templates + tests)

---

## Context

### Original Request
用户希望简化默认模板中的 token 字段显示。当前 `idle` 事件显示了 input/output/reasoning/cacheRead/cacheWrite/total 六项 token 明细，太复杂。用户要求: (1) 不展示费用, (2) 所有非 created 事件都增加会话 token 和全部 token, (3) 只保留模型名不要 providerID。

### Interview Summary
**Key Discussions**:
- 只改 `locales.ts` 默认模板字符串，不动 `handler.ts` 变量映射
- **不展示费用** -- 去掉所有 costFormatted
- 所有非 created 事件统一显示: 会话 token (`sessionTokensTotal`) + 全部 token (`totalTokensTotal`) + 模型 (`modelID`)
- 格式: 一行紧凑 `Token(会话X/全部Y) 模型: modelName`
- `created` 事件不变
- `handler.test.ts` 的 token 测试使用自定义模板，不受影响

### Metis Review
**Identified Gaps** (addressed):
- `modelID` 在早期事件中可能为空: 接受为已有行为，非回归
- `handler.test.ts` 的 token 测试使用自定义模板，不受默认模板变更影响
- 所有非 created 事件均需同时包含 `sessionTokensTotal` 和 `totalTokensTotal`

---

## Work Objectives

### Core Objective
简化默认通知模板为统一的一行紧凑格式: Token(会话/全部) + 模型。去除详细 token 明细、费用和 providerID。

### Concrete Deliverables
- `src/locales.ts`: 16 个 body 模板字符串更新
- `tests/locales.test.ts`: 对应断言更新

### Definition of Done
- [ ] `bun test` 全部通过
- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过

### Must Have
- 所有非 created 事件模板（中英文）含: `sessionTokensTotal`、`totalTokensTotal`、`modelID`
- 格式统一: ZH `Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}`
- 格式统一: EN `Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}`
- created 模板不变

### Must NOT Have (Guardrails)
- 不展示费用（不含 `costFormatted`、`sessionCostFormatted`、`totalCostFormatted`）
- 不展示 providerID
- 不展示详细 token 明细（`totalTokensInput`、`totalTokensOutput` 等）
- 不修改 `handler.ts`（变量映射保留给自定义模板使用）
- 不修改 `types.ts`、`index.ts`、`formatters.ts`
- 不修改 `handler.test.ts`（使用自定义模板，不受影响）
- created 事件模板不做任何改动
- 不改变事件专属内容行（error message、question text、duration 等保持原样）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: Tests-after（更新现有测试以匹配新模板内容）
- **Framework**: bun test

### QA Policy
Evidence saved to `.sisyphus/evidence/task-1-*.{ext}`.

---

## Execution Strategy

### Single Task (Atomic)

```
Wave 1 (Single task):
└── Task 1: Simplify token display in default templates + update tests [quick]
    -> bun test -> npm run typecheck -> npm run lint
```

### Dependency Matrix
- **1**: None - None

### Agent Dispatch Summary
- **1**: **1** - T1 -> `quick`

---

## TODOs

- [x] 1. Simplify token display in default templates + update tests

  **What to do**:

  **Step 1: 修改 `src/locales.ts` 模板**

  所有非 created 事件在模板 body 末尾追加同一行（替换原有 token/cost/model 部分）:

  - ZH 格式: `Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}`
  - EN 格式: `Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}`

  以下是每个事件类型的完整目标 body:

  **idle (zh)** -- 去掉详细 token 明细、费用、providerID:
  ```
  任务完成时间: {{timestamp}}
  会话: {{sessionTitle}} ({{sessionId}})
  消息: {{message}}
  耗时: {{duration}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **idle (en)**:
  ```
  Task completed at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  Message: {{message}}
  Duration: {{duration}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **error (zh)** -- 去掉费用、providerID，新增 token:
  ```
  错误发生时间: {{timestamp}}
  会话: {{sessionTitle}} ({{sessionId}})
  错误信息: {{error}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **error (en)**:
  ```
  Error at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  Error: {{error}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **question (zh)** -- 去掉费用，新增 token + 模型:
  ```
  OpenCode 在 {{timestamp}} 向您提问
  会话: {{sessionTitle}} ({{sessionId}})
  问题: {{title}}
  {{questionText}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **question (en)**:
  ```
  OpenCode has a question at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  Question: {{title}}
  {{questionText}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **permission (zh)**:
  ```
  {{timestamp}} 需要权限确认
  会话: {{sessionTitle}} ({{sessionId}})
  {{title}} ({{permissionType}})

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **permission (en)**:
  ```
  Permission needed at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  {{title}} ({{permissionType}})

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **status (zh)**:
  ```
  会话状态变更时间: {{timestamp}}
  会话: {{sessionTitle}} ({{sessionId}})
  状态: {{statusType}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **status (en)**:
  ```
  Session status changed at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  Status: {{statusType}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **command (zh)**:
  ```
  命令执行时间: {{timestamp}}
  会话: {{sessionTitle}} ({{sessionId}})
  命令: {{commandName}} {{arguments}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **command (en)**:
  ```
  Command executed at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  Command: {{commandName}} {{arguments}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **fileEdited (zh)**:
  ```
  文件编辑时间: {{timestamp}}
  文件: {{filePath}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **fileEdited (en)**:
  ```
  File edited at {{timestamp}}
  File: {{filePath}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **todo (zh)**:
  ```
  Todo 更新时间: {{timestamp}}
  会话: {{sessionTitle}} ({{sessionId}})
  {{todoSummary}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **todo (en)**:
  ```
  Todos updated at {{timestamp}}
  Session: {{sessionTitle}} ({{sessionId}})
  {{todoSummary}}

  Token({{sessionTokensTotal}}/{{totalTokensTotal}}) {{modelID}}
  ```

  **Step 2: 更新 `tests/locales.test.ts` 断言**

  需要更新的测试用例 (lines 141-225):

  - **"zh idle template contains cost, tokens, and model variables"** (lines 146-158):
    - 改名为 "zh idle template contains session tokens, total tokens, and model"
    - 断言含: `sessionTokensTotal`, `totalTokensTotal`, `modelID`
    - 断言不含: `totalTokensInput`, `totalTokensOutput`, `totalTokensReasoning`, `totalTokensCacheRead`, `totalTokensCacheWrite`, `providerID`, `totalCostFormatted`, `sessionCostFormatted`

  - **"en idle template contains cost, tokens, and model variables"** (lines 160-172):
    - 改名同上 (en 版本)
    - 同上断言

  - **"zh error template contains cost and model variables"** (lines 174-180):
    - 改名为 "zh error template contains session tokens, total tokens, and model"
    - 断言含: `sessionTokensTotal`, `totalTokensTotal`, `modelID`
    - 断言不含: `providerID`, `totalCostFormatted`

  - **"en error template contains cost and model variables"** (lines 182-188):
    - 同上 (en 版本)

  - **"other event templates contain sessionCostFormatted"** (lines 199-207):
    - 改名为 "other event templates contain sessionTokens, totalTokens, and model"
    - 断言含: `sessionTokensTotal`, `totalTokensTotal`, `modelID`
    - 不再断言含 `sessionCostFormatted`（已从模板移除）

  - **"other event templates do NOT contain detailed token variables"** (lines 209-224):
    - `tokenVars` 列表保持不变
    - 增加断言: 不含 `providerID`
    - 增加断言: 不含 `totalCostFormatted`, `sessionCostFormatted`

  **Step 3: 运行验证**
  ```bash
  bun test
  npm run typecheck
  npm run lint
  ```

  **Must NOT do**:
  - 不修改 `handler.ts` 中的变量映射
  - 不修改 `handler.test.ts`
  - 不修改 `created` 事件的模板
  - 不改变事件专属内容行（如 error message、question text、duration 等）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件模板字符串修改 + 测试断言更新，范围明确
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Single task
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/locales.ts:29-125` - 当前所有模板字符串，修改目标
  - `tests/locales.test.ts:141-225` - Token/Cost/Model 相关断言，需同步更新

  **API/Type References**:
  - `src/types.ts:232-239` - `TokenBreakdown` 接口（.total 字段）
  - `src/handler.ts:134-147` - 模板变量映射（确认 `sessionTokensTotal` 和 `totalTokensTotal` 均已映射，无需修改）

  **Test References**:
  - `tests/handler.test.ts:702-890` - Token 渲染测试（使用自定义模板，不受影响，仅供理解变量名）
  - `tests/locales.test.ts:146-224` - 需更新的断言

  **WHY Each Reference Matters**:
  - `locales.ts`: 唯一需要修改的源文件，包含所有默认模板
  - `locales.test.ts`: 唯一需要更新的测试文件，直接断言模板内容
  - `handler.ts`: 仅用于确认变量名可用，不需要修改
  - `handler.test.ts`: 确认不受影响（使用自定义模板），排除风险

  **Acceptance Criteria**:

  - [ ] `bun test` 全部通过，0 failures
  - [ ] `npm run typecheck` 通过
  - [ ] `npm run lint` 通过
  - [ ] 所有非 created 模板（中英文）含 `sessionTokensTotal`、`totalTokensTotal`、`modelID`
  - [ ] 所有非 created 模板（中英文）不含 `totalTokensInput`, `totalTokensOutput`, `totalTokensReasoning`, `totalTokensCacheRead`, `totalTokensCacheWrite`, `providerID`
  - [ ] 所有非 created 模板（中英文）不含 `costFormatted`, `sessionCostFormatted`, `totalCostFormatted`
  - [ ] created 模板不变，不含任何 token/cost/model 变量

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Happy path - all tests pass after template simplification
    Tool: Bash
    Preconditions: locales.ts and locales.test.ts updated
    Steps:
      1. Run `bun test`
      2. Assert exit code 0 and output contains "0 fail"
    Expected Result: All tests pass, no failures
    Failure Indicators: Exit code != 0, "X fail" in output where X > 0
    Evidence: .sisyphus/evidence/task-1-bun-test.txt

  Scenario: Typecheck passes
    Tool: Bash
    Preconditions: locales.ts updated
    Steps:
      1. Run `npm run typecheck`
      2. Assert exit code 0
    Expected Result: No TypeScript errors
    Failure Indicators: Exit code != 0, error messages in output
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: locales.ts and locales.test.ts updated
    Steps:
      1. Run `npm run lint`
      2. Assert exit code 0
    Expected Result: No lint errors
    Failure Indicators: Exit code != 0
    Evidence: .sisyphus/evidence/task-1-lint.txt

  Scenario: Removed variables are absent from all non-created templates
    Tool: Bash (grep)
    Preconditions: locales.ts updated
    Steps:
      1. Grep locales.ts for "totalTokensInput" -> assert NOT found in templates
      2. Grep for "providerID" -> assert NOT found in templates
      3. Grep for "totalCostFormatted" -> assert NOT found in templates
      4. Grep for "sessionCostFormatted" -> assert NOT found in templates
    Expected Result: No matches for removed variables
    Failure Indicators: Any match for removed variables
    Evidence: .sisyphus/evidence/task-1-removed-vars.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-1-bun-test.txt` - 测试输出
  - [ ] `.sisyphus/evidence/task-1-typecheck.txt` - 类型检查输出
  - [ ] `.sisyphus/evidence/task-1-lint.txt` - Lint 输出
  - [ ] `.sisyphus/evidence/task-1-removed-vars.txt` - 移除变量验证

  **Commit**: YES
  - Message: `refactor(locales): 简化默认通知模板的token显示，仅保留会话/全部token和模型`
  - Files: `src/locales.ts`, `tests/locales.test.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [ ] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file). For each "Must NOT Have": search codebase for forbidden patterns. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** -- `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `bun test`. Review all changed files.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [ ] F3. **Real Manual QA** -- `unspecified-high`
  Verify template content matches plan spec exactly. Check all 16 body templates (8 events x 2 locales). Verify removed variables absent, required variables present. Verify created event untouched.
  Output: `Templates [N/N correct] | VERDICT`

- [ ] F4. **Scope Fidelity Check** -- `deep`
  Verify: only `locales.ts` and `locales.test.ts` modified. No changes to other files.
  Output: `Files [2/2 modified] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `refactor(locales): 简化默认通知模板的token显示，仅保留会话/全部token和模型` - `src/locales.ts`, `tests/locales.test.ts` - `bun test`

---

## Success Criteria

### Verification Commands
```bash
bun test            # Expected: all tests pass, 0 failures
npm run typecheck   # Expected: exit code 0
npm run lint        # Expected: exit code 0
```

### Final Checklist
- [ ] All "Must Have" present (sessionTokensTotal + totalTokensTotal + modelID in all non-created)
- [ ] All "Must NOT Have" absent (no cost, no providerID, no detailed tokens, no handler.ts changes)
- [ ] All tests pass
- [ ] created template unchanged
