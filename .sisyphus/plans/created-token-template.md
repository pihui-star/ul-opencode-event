# Created 事件模板增加项目级 Token 信息

## TL;DR

> **Quick Summary**: 在 `locales.ts` 的 `created` 事件默认模板中追加项目级 Token 总量信息，让用户在会话创建时就了解项目累计消耗。
>
> **Deliverables**:
> - `en.created.body` 追加 `Project Token: {{projectTokensTotalHuman}}`
> - `zh.created.body` 追加 `项目累计 Token: {{projectTokensTotalHuman}}`
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - 单文件单任务
> **Critical Path**: Task 1 -> Verification

---

## Context

### Original Request
用户发现 `created` 事件模板中没有 Token 相关变量，但实际上项目级 Token 数据在会话创建时已经可用（通过 `fillProjectData()` 填充），希望在模板中显示项目累计 Token。

### Interview Summary
**Key Discussions**:
- Token 格式：用户选择只显示项目级 Token，不显示会话/总量（因为 created 时为 0），不显示费用
- 首次使用显示 "0"：可接受
- 只改 body，不改 subject

**Research Findings**:
- `fillProjectData()` 在 `index.ts:821` 对所有事件类型无条件调用
- `fillTokenData()` 在 `index.ts:298` 跳过 `created` 事件（不影响项目级数据）
- `projectTokensTotalHuman` 在 created 事件时始终有值（至少为 "0"）

### Metis Review
**Identified Gaps** (addressed):
- 确认 `formatTokenCount(0)` 返回 "0" 而非空字符串 -> 已验证
- 确认不需要修改 `handler.ts`/`index.ts`/`types.ts` -> 已确认
- 确认用户自定义模板不受影响 -> 预期行为

---

## Work Objectives

### Core Objective
在 `created` 事件的默认通知模板中显示项目累计 Token 用量。

### Concrete Deliverables
- `src/locales.ts` 中 `en.created.body` 追加项目级 Token 行
- `src/locales.ts` 中 `zh.created.body` 追加项目级 Token 行

### Definition of Done
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 成功
- [ ] `bun test` 全部通过
- [ ] `git diff` 仅显示 `locales.ts` 的 2 处 body 变更

### Must Have
- `en.created.body` 末尾追加 `\n\nProject Token: {{projectTokensTotalHuman}}`
- `zh.created.body` 末尾追加 `\n\n项目累计 Token: {{projectTokensTotalHuman}}`

### Must NOT Have (Guardrails)
- 不修改 `created.subject`
- 不修改其他事件类型的模板（idle/error/question 等）
- 不修改 `handler.ts`、`index.ts`、`types.ts` 或其他源文件
- 不添加 session/total 级 Token 变量
- 不添加费用/成本变量
- 不添加任何条件判断逻辑

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: NO (纯模板文本修改，已有测试覆盖模板渲染)
- **Framework**: bun test

### QA Policy
验证构建和测试通过即可，不需要额外 QA 场景。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Single task):
└── Task 1: 修改 created 模板 + 构建验证 [quick]

Wave FINAL:
└── F1: Plan compliance audit [quick]
```

### Dependency Matrix
- **1**: - - F1
- **F1**: 1 - -

### Agent Dispatch Summary
- **1**: 1 - T1 -> `quick`
- **FINAL**: 1 - F1 -> `quick`

---

## TODOs

- [x] 1. 修改 created 事件模板，追加项目级 Token 信息

  **What to do**:
  - 在 `src/locales.ts` 中修改 `en.created.body`（第 33-34 行），在现有内容末尾追加 `\n\nProject Token: {{projectTokensTotalHuman}}`
  - 在 `src/locales.ts` 中修改 `zh.created.body`（第 82-83 行），在现有内容末尾追加 `\n\n项目累计 Token: {{projectTokensTotalHuman}}`
  - 运行 `npm run typecheck` 确认类型检查通过
  - 运行 `npm run build` 确认构建成功
  - 运行 `npm run test` 确认测试全部通过
  - 使用 `git diff src/locales.ts` 确认仅修改了 created 事件的 body 字段

  **Must NOT do**:
  - 不修改 created.subject 或其他事件模板
  - 不修改 handler.ts、index.ts、types.ts 等其他文件
  - 不添加 session/total 级 Token 或费用变量
  - 不添加条件判断逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件 2 处文本修改，无逻辑变更
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - 无需额外 skill

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sole task)
  - **Blocks**: F1
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/locales.ts:39` (en.idle.body) - Token 行追加格式参考，使用 `\n\n` 前缀 + `{{projectTokensTotalHuman}}` 变量
  - `src/locales.ts:87` (zh.idle.body) - 中文版 Token 行格式参考

  **API/Type References**:
  - `src/handler.ts:189` - `projectTokensTotalHuman` 变量赋值逻辑，确认在 created 事件中有值
  - `src/index.ts:821` - `fillProjectData()` 调用点，确认对所有事件类型无条件调用

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 英文 created 模板包含项目级 Token
    Tool: Bash (grep)
    Preconditions: locales.ts 已修改
    Steps:
      1. grep -A2 "created:" src/locales.ts | grep "projectTokensTotalHuman"
      2. 确认 en 部分的 created.body 包含 "Project Token: {{projectTokensTotalHuman}}"
    Expected Result: grep 输出包含匹配行
    Failure Indicators: grep 无匹配或匹配到错误内容
    Evidence: .sisyphus/evidence/task-1-en-created-template.txt

  Scenario: 中文 created 模板包含项目级 Token
    Tool: Bash (grep)
    Preconditions: locales.ts 已修改
    Steps:
      1. grep "projectTokensTotalHuman" src/locales.ts
      2. 确认 zh 部分的 created.body 包含 "项目累计 Token: {{projectTokensTotalHuman}}"
    Expected Result: grep 输出包含匹配行
    Failure Indicators: grep 无匹配
    Evidence: .sisyphus/evidence/task-1-zh-created-template.txt

  Scenario: 构建和测试通过
    Tool: Bash
    Preconditions: 代码已修改
    Steps:
      1. npm run typecheck -> 期望 exit code 0
      2. npm run build -> 期望 exit code 0
      3. npm run test -> 期望全部 PASS
    Expected Result: 三个命令全部成功
    Failure Indicators: 任何命令失败或测试不通过
    Evidence: .sisyphus/evidence/task-1-build-test.txt

  Scenario: 仅修改 created.body，无其他文件变更
    Tool: Bash (git diff)
    Preconditions: 代码已修改
    Steps:
      1. git diff --stat -> 期望仅 src/locales.ts 被修改
      2. git diff src/locales.ts -> 期望只有 2 处 body 变更，无 subject 变更，无其他事件变更
    Expected Result: diff 仅显示 en.created.body 和 zh.created.body 各追加了项目级 Token 行
    Failure Indicators: 出现其他文件名或其他事件类型的修改
    Evidence: .sisyphus/evidence/task-1-diff.txt
  ```

  **Commit**: YES
  - Message: `feat(template): created 事件模板增加项目级 Token 总量`
  - Files: `src/locales.ts`
  - Pre-commit: `npm run typecheck && npm run build && npm run test`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `quick`
  读取计划，验证实现：Must Have 检查（en/zh body 各包含项目级 Token 行）、Must NOT Have 检查（无 subject 变更、无其他文件变更、无 session/total/cost 变量）。运行 `git diff --stat` 确认仅 `locales.ts` 变更。
  Output: `Must Have [2/2] | Must NOT Have [4/4] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

- **1**: `feat(template): created 事件模板增加项目级 Token 总量` - src/locales.ts

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck  # Expected: 无错误
npm run build      # Expected: 成功
npm run test       # Expected: 全部 PASS
git diff --stat    # Expected: 仅 src/locales.ts
```

### Final Checklist
- [ ] en.created.body 包含 `Project Token: {{projectTokensTotalHuman}}`
- [ ] zh.created.body 包含 `项目累计 Token: {{projectTokensTotalHuman}}`
- [ ] created.subject 未修改
- [ ] 其他事件模板未修改
- [ ] 无其他源文件被修改
- [ ] 所有测试通过
