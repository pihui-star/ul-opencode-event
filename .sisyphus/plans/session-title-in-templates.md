# 在默认模板中增加会话标题 (sessionTitle)

## TL;DR

> **Quick Summary**: 从 OpenCode SDK 的 `Session.title` 字段提取会话标题，通过 `EventPayload.sessionTitle` 传递到所有默认通知模板，以 `{{sessionTitle}} ({{sessionId}})` 格式显示在邮件正文中。
>
> **Deliverables**:
> - `EventPayload` 新增 `sessionTitle?: string` 类型字段
> - `eventToPayload()` 全部分支提取 `sessionInfo?.title`
> - handler 模板变量映射加入 `sessionTitle`
> - 中英文默认模板（16 个事件模板）统一更新为 `Title (ID)` 格式
> - 测试覆盖：类型检查 + 提取逻辑 + 模板渲染 + 集成流程
>
> **Estimated Effort**: Small
> **Parallel Execution**: NO - sequential (数据流链路：types -> extraction -> mapping -> templates -> tests)
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> F1-F4

---

## Context

### Original Request
用户发现当前通知模板中只有会话 ID（`{{sessionId}}`），没有会话标题。OpenCode SDK 的 `Session` 类型已包含 `title: string`（必填字段），但插件未将其传递到通知模板中。需要在默认模板中增加会话标题，放在会话 ID 前面。

### Interview Summary
**Key Discussions**:
- 确认 SDK `Session.title` 是必填字符串字段（`types.gen.d.ts:479`）
- 现有 `EventPayload.title` 仅用于 question/permission 事件的问题/权限标题，需用新字段名避免冲突
- 用户选择模板格式：**`{{sessionTitle}} ({{sessionId}})`** -- 标题在前，ID 用括号包裹
- `file.edited` 事件无 sessionInfo，sessionTitle 为 undefined 是预期行为

**Research Findings**:
- `Session.title` 是 SDK 必填字段，所有有 sessionInfo 的事件分支都可提取
- 模板引擎基于正则，支持任意 `{{varName}}`，无需修改 template.ts
- 现有测试的 mock sessionInfo 已包含 title 字段（如 `'Test Session'`）
- `basePayload` 模式（index.ts:32-36）可用于设置默认值

### Metis Review
**Identified Gaps** (addressed):
- **模板格式歧义**: 已确认使用 `Title (ID)` 格式
- **file.edited 无 sessionInfo**: 明确不在此事件模板中加入 sessionTitle（与 sessionId 行为一致）
- **命名冲突**: 使用 `sessionTitle` 区别于现有 `title`（question/permission 专用）
- **向后兼容**: 新字段为 optional，旧自定义模板不受影响
- **Subject 行范围**: 不在邮件主题行中添加 sessionTitle（超出本次范围）

---

## Work Objectives

### Core Objective
将 OpenCode 会话标题从 SDK `Session` 对象完整传递到通知邮件正文的默认模板中，以紧凑可读的格式展示。

### Concrete Deliverables
- `src/types.ts`: `EventPayload` 接口新增 `sessionTitle?: string` 字段及 JSDoc
- `src/index.ts`: `eventToPayload()` 9 个分支全部提取 `sessionTitle`
- `src/handler.ts`: 模板变量映射新增 `sessionTitle: payload.sessionTitle`
- `src/locales.ts`: 16 个默认模板（8 事件 x 2 语言）更新为 `{{sessionTitle}} ({{sessionId}})` 格式
- 测试文件：补充 sessionTitle 相关断言

### Definition of Done
- [ ] `npm run typecheck` 通过（exit code 0）
- [ ] `npm run lint` 通过（exit code 0）
- [ ] `npm run build` 成功
- [ ] `bun test` 全部通过
- [ ] 所有含 sessionId 的默认模板都正确渲染 sessionTitle

### Must Have
- `EventPayload.sessionTitle` 为 optional 字段（`?: string`）
- 所有有 sessionInfo 的事件分支必须提取 title
- handler 变量映射必须包含 sessionTitle
- 中英文模板格式完全一致
- file.edited 模板不加 sessionTitle（无 sessionInfo）
- 现有 `title` 字段（question/permission）语义不变

### Must NOT Have (Guardrails)
- 不修改 `template.ts`（模板引擎无需改动）
- 不修改 `email.ts`、`config.ts`、`cli.ts`（无关模块）
- 不在邮件 Subject 行添加 sessionTitle
- 不添加任何配置项或用户选项
- 不做 full README 重写（至多更新变量表）
- 不改变现有 `EventPayload.title` 的语义和用途

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: Tests-after（现有测试框架完善，新断言追加到已有测试即可）
- **Framework**: bun test
- **If TDD**: 每个任务包含具体测试断言作为验收标准

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run tests, assert specific output values

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Task 1 - 类型定义基础):
├── Task 1: EventPayload 新增 sessionTitle 字段 [quick]

Wave 2 (Task 2-3 - 数据提取与传递, 依赖 Task 1):
├── Task 2: eventToPayload() 全分支提取 sessionTitle [quick]
└── Task 3: handler 模板变量映射 [quick]

Wave 3 (Task 4-5 - 模板与测试, 依赖 Task 2,3):
├── Task 4: 默认模板更新 (locales.ts) [quick]
└── Task 5: 测试补充与验证 [unspecified-high]

Wave FINAL (F1-F4 - 最终验证, 全部完成后):
├── F1: Plan Compliance Audit [oracle]
├── F2: Code Quality Review [unspecified-high]
├── F3: Real Manual QA [unspecified-high]
└── F4: Scope Fidelity Check [deep]

Critical Path: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → F1-F4
Parallel Speedup: N/A (sequential data flow)
Max Concurrent: 1 (chain dependency)
```

### Dependency Matrix

- **1**: - - 2, 3, 4, 5, F
- **2**: 1 - 3, 4, 5, F
- **3**: 1, 2 - 4, 5, F
- **4**: 1, 2, 3 - 5, F
- **5**: 1, 2, 3, 4 - F1, F2, F3, F4
- **F1-F4**: 1, 2, 3, 4, 5 - -

### Agent Dispatch Summary

- **1**: **1** - T1 → `quick`
- **2**: **2** - T2 → `quick`, T3 → `quick`
- **3**: **2** - T4 → `quick`, T5 → `unspecified-high`
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.

- [x] 1. **EventPayload 类型定义新增 sessionTitle 字段**

  **What to do**:
  - 在 `src/types.ts` 的 `EventPayload` 接口中新增 `sessionTitle?: string;` 字段
  - 放置位置：在 `parentSessionId` 字段之后、接口闭合 `}` 之前
  - 为新字段添加 JSDoc 注释：`// 会话标题（来自 SDK Session.title）`
  - 为现有 `title` 字段补充 `@remarks` 注释，明确其仅用于 question/permission 事件
  - 确保不修改任何其他字段或接口

  **Must NOT do**:
  - 不修改 `title` 字段的类型或名称
  - 不修改其他任何接口（Channel、NotificationConfig 等）
  - 不将 sessionTitle 设为必填（保持 optional）
  - 不修改 template.ts、email.ts、config.ts 等无关文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件单字段添加，改动量 < 10 行，无复杂逻辑
  - **Skills**: []
    - 无需特殊技能，纯类型定义编辑

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (Sequential foundation)
  - **Blocks**: Task 2, Task 3, Task 4, Task 5, F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/types.ts:132-151` - EventPayload 接口完整定义，参考 parentSessionId 字段的声明风格（optional + 行内注释）
  - `src/types.ts:140` - 现有 title 字段（question/permission 专用），需补充 @remarks 区分语义

  **API/Type References**:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:465-492` - Session 类型定义，确认 `title: string` 为必填字段

  **Test References**:
  - 无需测试文件修改（纯类型变更，typecheck 验证即可）

  **Acceptance Criteria**:

  - [ ] `npm run typecheck` 通过（exit code 0），无类型错误
  - [ ] `EventPayload` 接口包含 `sessionTitle?: string` 字段
  - [ ] `sessionTitle` 位于 `parentSessionId` 之后
  - [ ] 现有 `title` 字段有 @remarks 注释区分用途
  - [ ] `lsp_diagnostics(src/types.ts)` 无 error 级别诊断

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript 编译验证 - 新字段不影响现有类型
    Tool: Bash (npm run typecheck)
    Preconditions: src/types.ts 已添加 sessionTitle 字段
    Steps:
      1. 运行 npm run typecheck
      2. 检查 exit code
    Expected Result: exit code 0，无类型错误输出
    Failure Indicators: exit code 非 0，或输出包含 "error TS"
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: LSP 诊断检查 - types.ts 无新增错误
    Tool: lsp_diagnostics
    Preconditions: src/types.ts 已修改
    Steps:
      1. 对 src/types.ts 运行 lsp_diagnostics(severity="error")
      2. 检查诊断结果
    Expected Result: 零个 error 级别诊断（已有的 bun:test 警告忽略）
    Failure Indicators: 出现新的 error 级别诊断与 sessionTitle 相关
    Evidence: .sisyphus/evidence/task-1-lsp.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-typecheck.txt (typecheck 完整输出)
  - [ ] task-1-lsp.txt (LSP 诊断结果)

  **Commit**: YES
  - Message: `feat(types): EventPayload 新增 sessionTitle 可选字段`
  - Files: `src/types.ts`
  - Pre-commit: `npm run typecheck`

- [x] 2. **eventToPayload() 全分支提取会话标题**

  **What to do**:
  - 在 `src/index.ts` 的 `eventToPayload()` 函数中，所有 9 个事件分支提取 `sessionTitle`
  - 利用现有的 `basePayload`（第 32-36 行）设置默认值 `sessionTitle: undefined`
  - 各分支提取策略：
    - `session.created`: `event.properties.info.title`（Session 对象直接可用）
    - `session.idle`: `sessionInfo?.title`（从 sessionMap 获取的 Session）
    - `session.error`: `sessionInfo?.title`
    - `question.asked`: `sessionInfo?.title`
    - `permission.updated`: `sessionInfo?.title`
    - `session.status`: `sessionInfo?.title`
    - `command.executed`: `sessionInfo?.title`
    - `file.edited`: 保持 undefined（无 sessionInfo，符合预期）
    - `todo.updated`: `sessionInfo?.title`
  - 在 `tests/index.test.ts` 中为关键分支添加 sessionTitle 断言：
    - session.created 测试：断言邮件 body 包含 mock 的 title 值
    - session.idle 测试：断言 body 包含 title
    - 至少一个扩展事件（如 question.asked）也加断言

  **Must NOT do**:
  - 不改变现有分支的逻辑结构或返回值的其他字段
  - 不修改 sessionMap 或 sessionType 相关逻辑
  - 不在 file.edited 分支强行添加 sessionTitle
  - 不修改 NotificationPlugin 主函数的事件分发逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 同一函数内多分支添加同一字段提取，模式重复但简单
  - **Skills**: []
    - 无需特殊技能

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (depends on Task 1 type definition)
  - **Blocks**: Task 3, Task 4, Task 5, F1-F4
  - **Blocked By**: Task 1 (需要 EventPayload.sessionTitle 类型存在)

  **References**:

  **Pattern References**:
  - `src/index.ts:32-36` - basePayload 定义处，在此添加 `sessionTitle: undefined`
  - `src/index.ts:39-46` - session.created 分支：从 `event.properties.info` 提取模式
  - `src/index.ts:47-57` - session.idle 分支：从 `sessionInfo` 提取模式（duration 就是这么做的）
  - `src/index.ts:134-143` - file.edited 分支：确认此处无 sessionInfo，sessionTitle 保持 undefined

  **Test References**:
  - `tests/index.test.ts:146-153` - session.created 的 mock sessionInfo 已包含 `title: 'Test Session'`
  - `tests/index.test.ts:182-189` - session.idle 的 mock sessionInfo 已包含 `title: 'Test Session'`
  - `tests/index.test.ts:129-163` - session.created 完整流程测试，可在此追加 sessionTitle 断言
  - `tests/index.test.ts:165-205` - session.idle 完整流程测试，可在此追加 sessionTitle 断言

  **Acceptance Criteria**:

  - [ ] `bun test tests/index.test.ts` 全部通过
  - [ ] eventToPayload() 所有 9 个分支都处理了 sessionTitle（8 个有值，1 个 undefined）
  - [ ] basePayload 包含 `sessionTitle: undefined` 默认值
  - [ ] 新增测试断言通过：created/idle/question 事件的 payload/sessionInfo 包含正确的 title

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: session.created 正确提取 sessionTitle
    Tool: Bash (bun test)
    Preconditions: index.ts 已修改，index.test.ts 已添加断言
    Steps:
      1. 运行 bun test tests/index.test.ts --test-name-pattern "session.created event triggers"
      2. 检查测试是否通过且断言了 sessionTitle / title 出现在 body 中
    Expected Result: 测试通过，邮件 body 包含 'Test Session'
    Failure Indicators: 测试失败，或 body 中不含 'Test Session'
    Evidence: .sisyphus/evidence/task-2-created.txt

  Scenario: session.idle 正确传递 sessionTitle
    Tool: Bash (bun test)
    Preconditions: 同上
    Steps:
      1. 运行 bun test tests/index.test.ts --test-name-pattern "session.idle event triggers"
      2. 验证 idle 事件的邮件 body 包含 session title
    Expected Result: 测试通过，body 含 'Test Session'
    Failure Indicators: 测试失败
    Evidence: .sisyphus/evidence/task-2-idle.txt

  Scenario: 全量 index 测试无回归
    Tool: Bash (bun test)
    Preconditions: 所有修改完成
    Steps:
      1. 运行 bun test tests/index.test.ts
      2. 检查总通过数和失败数
    Expected Result: 所有测试通过（0 failures）
    Failure Indicators: 任何已有测试失败
    Evidence: .sisyphus/evidence/task-2-full.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-created.txt (created 事件测试输出)
  - [ ] task-2-idle.txt (idle 事件测试输出)
  - [ ] task-2-full.txt (完整测试套件输出)

  **Commit**: YES
  - Message: `feat(index): eventToPayload 全分支提取会话标题`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- [x] 3. **handler 模板变量映射加入 sessionTitle**

  **What to do**:
  - 在 `src/handler.ts` 的 `handle()` 方法中，模板变量对象（约第 85-105 行）新增一行：
    ```typescript
    sessionTitle: payload.sessionTitle,
    ```
  - 放置位置：在 `sessionId` 之后、`message` 之前（与 EventPayload 字段顺序一致）
  - 在 `tests/handler.test.ts` 中验证模板渲染包含 sessionTitle：
    - 使用自定义模板 `{{sessionTitle}} ({{sessionId}})` 创建测试
    - 传入含 sessionTitle 的 payload，断言渲染结果正确

  **Must NOT do**:
  - 不修改变量映射中任何现有字段
  - 不修改模板选择或渲染逻辑
  - 不修改 send 调用或 channel 遍历逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单行添加 + 一个测试用例，极小改动
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (可与 Task 2 并行，但依赖 Task 1)
  - **Blocks**: Task 4, Task 5, F1-F4
  - **Blocked By**: Task 1 (类型定义)

  **References**:

  **Pattern References**:
  - `src/handler.ts:85-105` - variables 对象定义，参考 `parentSessionId` 的添加方式（第 104 行附近）

  **Test References**:
  - `tests/handler.test.ts` - handler 单元测试文件
  - `tests/integration/full-flow.test.ts:93-101` - createPayload 辅助函数，需注意更新以支持 sessionTitle

  **Acceptance Criteria**:

  - [ ] `bun test tests/handler.test.ts` 通过
  - [ ] variables 对象包含 `sessionTitle` 键
  - [ ] 自定义模板 `{{sessionTitle}} ({{sessionId}})` 渲染正确

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: handler 变量映射包含 sessionTitle
    Tool: Bash (bun test)
    Preconditions: handler.ts 已添加 sessionTitle 到 variables
    Steps:
      1. 运行 bun test tests/handler.test.ts
      2. 确认全部通过
    Expected Result: 所有 handler 测试通过
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-3-handler.txt

  Scenario: 模板渲染正确替换 sessionTitle 变量
    Tool: Bash (bun test)
    Preconditions: 有使用 {{sessionTitle}} 的测试用例
    Steps:
      1. 运行包含自定义模板的测试
      2. 验证渲染输出包含预期值
    Expected Result: 渲染结果形如 "My Title (sess-123)"
    Failure Indicators: 渲染结果缺少 title 或格式错误
    Evidence: .sisyphus/evidence/task-3-render.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-handler.txt (handler 测试输出)
  - [ ] task-3-render.txt (渲染测试输出)

  **Commit**: YES
  - Message: `feat(handler): 模板变量映射加入 sessionTitle`
  - Files: `src/handler.ts`, `tests/handler.test.ts`
  - Pre-commit: `bun test tests/handler.test.ts`

- [x] 4. **默认模板更新 -- 中英文 locales 加入会话标题**

  **What to do**:
  - 更新 `src/locales.ts` 中所有 16 个默认模板字符串（8 事件类型 x 2 语言）
  - 格式统一为：`{{sessionTitle}} ({{sessionId}})`
  - 具体变更（每个模板都将 `{{sessionId}}` 替换为 `{{sessionTitle}} ({{sessionId}})`）：

  **英文模板 (en)**:
  - created: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - idle: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - error: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - question: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - permission: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - status: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - command: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`
  - todo: `Session: {{sessionId}}` -> `Session: {{sessionTitle}} ({{sessionId}})`

  **中文模板 (zh)** -- 对应同样的 8 个事件，相同的替换模式：
  - created: `会话: {{sessionId}}` -> `会话: {{sessionTitle}} ({{sessionId}})`
  - idle/error/question/permission/status/command/todo: 同上模式

  **不变更**: fileEdited 模板（两个语言版本都不含 sessionId，无需改）
  - 在 `tests/integration/full-flow.test.ts` 中添加集成测试：
    - 测试 created 事件使用默认模板时，body 包含 `Title (ID)` 格式
    - 测试 idle 事件同上
    - 验证中英文模板都正确渲染

  **Must NOT do**:
  - 不修改 Subject 行模板（不在主题中加入 sessionTitle）
  - 不修改 fileEdited 模板
  - 不改变模板中其他变量的位置或格式
  - 不修改 template.ts 引擎代码

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯文本替换，16 处相同模式的机械性修改
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (depends on Task 2 + Task 3)
  - **Blocks**: Task 5, F1-F4
  - **Blocked By**: Task 2 (extraction), Task 3 (variable mapping)

  **References**:

  **Pattern References**:
  - `src/locales.ts:30-76` - 英文模板定义（localeTemplates.en）
  - `src/locales.ts:78-124` - 中文模板定义（localeTemplates.zh）
  - 参考 `src/locales.ts:34` - created 英文模板当前格式: `'Session: {{sessionId}}\\nAgent Type: ...'`

  **Test References**:
  - `tests/integration/full-flow.test.ts:241-258` - 默认模板渲染测试（"should use default templates when no custom templates"）
  - `tests/integration/full-flow.test.ts:283-305` - 自定义模板变量测试（"should include all variables in templates"）

  **Acceptance Criteria**:

  - [ ] `bun test tests/integration/full-flow.test.ts` 通过
  - [ ] `bun test tests/locales.test.ts` 通过（locale 测试无回归）
  - [ ] 16 个模板全部更新为 `{{sessionTitle}} ({{sessionId}})` 格式
  - [ ] fileEdited 模板未修改
  - [ ] 集成测试验证默认模板渲染包含 Title (ID) 格式

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 英文默认模板渲染 sessionTitle
    Tool: Bun (bun test)
    Preconditions: locales.ts 已更新，full-flow.test.ts 已添加断言
    Steps:
      1. 运行 bun test tests/integration/full-flow.test.ts --test-name-pattern "default templates"
      2. 检查 captured email text 是否包含 "Test Session" 和 "(test-session)" 模式
    Expected Result: body 匹配 /Test Session \(.*test-session\)/
    Failure Indicators: body 不含 sessionTitle 或格式不是 Title (ID)
    Evidence: .sisyphus/evidence/task-4-en-template.txt

  Scenario: 中文默认模板渲染 sessionTitle
    Tool: Bun (bun test)
    Preconditions: 同上，配置 language: 'zh'
    Steps:
      1. 运行带 zh locale 的集成测试
      2. 验证中文模板输出包含会话标题
    Expected Result: 中文 body 包含 sessionTitle 值
    Failure Indicators: 中文模板未更新或渲染异常
    Evidence: .sisyphus/evidence/task-4-zh-template.txt

  Scenario: locales 测试无回归
    Tool: Bash (bun test)
    Preconditions: locales.ts 已修改
    Steps:
      1. 运行 bun test tests/locales.test.ts
      2. 检查全部通过
    Expected Result: 所有 locale 测试通过
    Failure Indicators: 任何 locale 测试失败
    Evidence: .sisyphus/evidence/task-4-locales.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-en-template.txt (英文模板渲染验证)
  - [ ] task-4-zh-template.txt (中文模板渲染验证)
  - [ ] task-4-locales.txt (locales 测试输出)

  **Commit**: YES
  - Message: `feat(locales): 默认模板统一加入会话标题显示`
  - Files: `src/locales.ts`, `tests/integration/full-flow.test.ts`
  - Pre-commit: `bun test tests/locales.test.ts tests/integration/full-flow.test.ts`

- [x] 5. **测试完善与全量验证**

  **What to do**:
  - 补充 sessionTitle 边界用例到各测试文件：
    - `file.edited` 事件确认 sessionTitle 为 undefined（不被渲染）
    - sessionInfo 缺失时的降级行为（sessionTitle 为空字符串）
    - question/permission 事件的 `title` 字段不受 `sessionTitle` 影响（语义隔离验证）
  - 更新 `tests/integration/full-flow.test.ts` 的 `createPayload()` 辅助函数使其支持 sessionTitle
  - 运行完整测试套件确认零回归：
    - `bun test` （全部测试文件）
    - `npm run typecheck`
    - `npm run lint`
    - `npm run build`

  **Must NOT do**:
  - 不修改生产代码（src/ 下文件）
  - 不改变已有测试的断言逻辑（只追加新断言）
  - 不引入新的测试框架或依赖

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 跨多个测试文件的边界用例补充，需全面覆盖
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (final verification wave before F1-F4)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: Tasks 1-4 (all production code complete)

  **References**:

  **Pattern References**:
  - `tests/index.test.ts:237-259` - unhandled event skip 测试模式
  - `tests/index.test.ts:796-825` - file.edited 测试组（可用于添加 sessionTitle undefined 断言）
  - `tests/integration/full-flow.test.ts:93-101` - createPayload 辅助函数

  **Test References**:
  - 所有已修改的测试文件均为参考

  **Acceptance Criteria**:

  - [ ] `bun test` 全部通过（0 failures）
  - [ ] `npm run typecheck` exit code 0
  - [ ] `npm run lint` exit code 0
  - [ ] `npm run build` 成功
  - [ ] file.edited 边界用例确认 sessionTitle undefined
  - [ ] question 事件 title 与 sessionTitle 语义隔离验证通过

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全量测试套件零回归
    Tool: Bash (bun test)
    Preconditions: Tasks 1-4 全部完成
    Steps:
      1. 运行 bun test（无过滤，全量）
      2. 记录总测试数、通过数、失败数
    Expected Result: 0 failures，所有测试通过
    Failure Indicators: 任何失败，包括已有测试的回归
    Evidence: .sisyphus/evidence/task-5-full-test.txt

  Scenario: 类型检查与构建验证
    Tool: Bash (npm commands)
    Preconditions: 所有源码修改完成
    Steps:
      1. 运行 npm run typecheck
      2. 运行 npm run lint
      3. 运行 npm run build
    Expected Result: 三条命令均 exit code 0
    Failure Indicators: 任何命令非 0 退出
    Evidence: .sisyphus/evidence/task-5-build.txt

  Scenario: file.edited sessionTitle 为 undefined
    Tool: Bun (bun test assertion)
    Preconditions: 有 file.edited sessionTitle 边界测试
    Steps:
      1. 运行 file.edited 相关测试
      2. 确认 sessionTitle 未被错误设置
    Expected Result: file.edited 事件不包含 sessionTitle 或为 undefined
    Failure Indicators: file.edited 错误地包含了 sessionTitle 值
    Evidence: .sisyphus/evidence/task-5-fileedited.txt

  Scenario: question 事件 title 与 sessionTitle 语义隔离
    Tool: Bun (bun test assertion)
    Preconditions: 有语义隔离测试
    Steps:
      1. 触发 question.asked 事件（有 question header 作为 title，也有 sessionTitle）
      2. 验证模板中 {{title}} 显示 question header
      3. 验证模板中 {{sessionTitle}} 显示 session title
    Expected Result: 两个字段各自独立显示正确值
    Failure Indicators: 两个字段值混淆或覆盖
    Evidence: .sisyphus/evidence/task-5-isolation.txt
  ```

  **Evidence to Capture**:
  - [ ] task-5-full-test.txt (完整测试输出)
  - [ ] task-5-build.txt (typecheck + lint + build 输出)
  - [ ] task-5-fileedited.txt (file.edited 边界验证)
  - [ ] task-5-isolation.txt (语义隔离验证)

  **Commit**: YES (如果测试文件有实质修改)
  - Message: `test: 补充 sessionTitle 边界用例与集成验证`
  - Files: `tests/*.test.ts` (如有修改)
  - Pre-commit: `bun test && npm run typecheck && npm run lint`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for quality issues.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Run FULL test suite. Verify every QA scenario from every task. Test cross-task integration.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 compliance. Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `feat(types): EventPayload 新增 sessionTitle 可选字段` - src/types.ts, npm run typecheck
- **2**: `feat(index): eventToPayload 全分支提取会话标题` - src/index.ts, tests/index.test.ts, bun test tests/index.test.ts
- **3**: `feat(handler): 模板变量映射加入 sessionTitle` - src/handler.ts, tests/handler.test.ts, bun test tests/handler.test.ts
- **4**: `feat(locales): 默认模板统一加入会话标题显示` - src/locales.ts, tests/integration/full-flow.test.ts, bun test tests/integration/full-flow.test.ts
- **5**: `test: 补充 sessionTitle 边界用例与集成验证` - tests/*.test.ts, bun test

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck    # Expected: exit code 0
npm run lint         # Expected: exit code 0
npm run build        # Expected: dist/ populated
bun test             # Expected: All tests pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] 中英文模板格式一致
- [ ] file.edited 模板未受影响
- [ ] 现有 title 字段语义未变
