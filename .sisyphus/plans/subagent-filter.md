# 子代理事件过滤功能 (Sub-agent Event Filtering)

## TL;DR

> **Quick Summary**: 在通知插件中新增 `includeSubagentEvents` 全局配置项（**默认 false**），当子代理（通过 task() 调用）产生事件时，**默认跳过**邮件通知。用户需显式设为 `true` 才接收子代理通知。利用 SDK Session 类型已有的 `parentID` 字段识别子代理来源。
>
> **Deliverables**:
> - `src/types.ts` -- 新增配置类型和 payload 字段
> - `src/config.ts` -- 配置合并逻辑
> - `src/index.ts` -- parentID 提取 + 过滤逻辑
> - `tests/index.test.ts` -- 集成测试（主会话通知 / 子代理过滤 / 默认行为）
> - `tests/config.test.ts` -- 配置合并测试
>
> **Estimated Effort**: Small (~4 个源文件 + 2 个测试文件, ~60 行变更)
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 -> Task 3 -> Task 4

---

## Context

### Original Request
用户希望在 OpenCode 通知插件中能够识别事件是否来自子代理（subagent），并支持配置"子代理不触发通知"。核心场景：主会话使用 task() 派生子代理时，子代理产生的大量事件（idle、question、todo.updated 等）不应触发邮件通知。

### Interview Summary
**Key Discussions**:
- 确认 SDK 的 `Session.parentID?: string` 字段可用于判断子代理来源
- 确认采用全局配置方案（与 language/timezone 同级），不做通道级过滤 v1
- 确认过滤位置在 index.ts event 回调中（handler 调用前），保持 handler.ts 为纯分发器
- 确认 EventPayload 新增字段仅用于内部过滤，不在模板中展示

**Research Findings**:
- SDK `Session.parentID?: string`: 存在即为子代理会话 (`types.gen.d.ts:469`)
- `sessionMap` 已缓存完整 Session 对象 (`index.ts:203`)，非 session.created 事件可通过 sessionID 回溯
- `file.edited` 事件无 sessionID，无法判断来源（但默认关闭，无需处理）
- 测试框架: Bun test，mock.module() + mock() 模式成熟

### Metis Review
**Identified Gaps** (addressed):
- **session.created 过滤时机**: sessionMap.set() 在 line 211，过滤在 line 232 之后，缓存不受影响 -- 已确认安全
- **嵌套子代理**: 孙子级子代理也有 parentID，同样被过滤 -- 行为正确
- **sessionMap 未命中**: sessionInfo=undefined 时 parentID=undefined，视为主会话 -- 安全降级
- **file.edited 无 sessionID**: 默认关闭且不过滤 -- 无需改动
  - **向后兼容**: includeSubagentEvents 缺失/undefined 时默认 false = 不包含子代理事件（过滤）-- 已纳入 AC

---

## Work Objectives

### Core Objective
为通知插件添加子代理事件识别与过滤能力：通过 SDK Session.parentID 判断事件来源，**默认静默跳过所有子代理事件的通知**（`includeSubagentEvents` 默认为 `false`）。用户需显式配置 `includeSubagentEvents: true` 才能接收子代理通知。

### Concrete Deliverables
- `NotificationConfig.includeSubagentEvents?: boolean` -- 全局配置开关
- `EventPayload.isSubagent?: boolean` -- 事件是否来自子代理
- `EventPayload.parentSessionId?: string` -- 父会话 ID（原始值）
- `eventToPayload()` 提取 sessionInfo?.parentID 到 payload
- index.ts event 回调中的过滤检查
- config.ts 中 includeSubagentEvents 的合并逻辑
- 完整测试覆盖（集成 + 配置合并）

### Definition of Done
- [ ] `npm run typecheck` 通过 (tsc --noEmit exit 0)
- [ ] `npm run lint` 通过 (eslint src exit 0)
- [ ] `npm run test` 全部通过（含新测试 + 无回归）

### Must Have
- includeSubagentEvents 配置项（全局，boolean，**默认 false 即不包含/过滤子代理**）
- 所有带 sessionID 的事件类型均支持过滤
- **向前兼容**: 未配置时默认不包含子代理通知（新行为，但合理 -- 减少噪音）
- **显式接收**: 用户设 `includeSubagentEvents: true` 才接收子代理通知
- TDD 流程：先写失败测试，再实现

### Must NOT Have (Guardrails)
- 不修改 handler.ts（过滤逻辑在 index.ts）
- 不修改 locales.ts / template.ts（不在模板中展示子代理信息）
- 不实现通道级（per-channel）子代理过滤
- 不实现按事件类型的细粒度子代理过滤
- 不修改 file.edited 处理逻辑
- 不添加 CLI 相关改动
- 不重构现有的 events 过滤模式

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: YES (TDD)
- **Framework**: bun test
- **If TDD**: Each task follows RED (failing test) -> GREEN (minimal impl)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run specific test files, assert exit code and output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - types + failing tests):
├── Task 1: 类型定义 (types.ts) [quick]
└── Task 2: 编写失败测试 (index.test.ts + config.test.ts) [quick]

Wave 2 (After Wave 1 - implementation):
├── Task 3: 配置合并 (config.ts) [quick]
├── Task 4: Payload 提取 + 过滤逻辑 (index.ts) [quick]
└── Task 5: 运行全量验证 (typecheck + lint + test) [unspecified-low]

Wave FINAL (After ALL tasks):
├── F1. Plan Compliance Audit (oracle)
├── F2. Code Quality Review (unspecified-high)
├── F3. Real Manual QA (unspecified-high)
└── F4. Scope Fidelity Check (deep)

Critical Path: Task 1 -> Task 2 -> Task 3/Task 4 -> Task 5 -> F1-F4
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Wave 1), 3 (Wave 2)
```

### Dependency Matrix

- **1**: - - 2, 3, 4, 5, F
- **2**: 1 - 3, 4, 5, F
- **3**: 1, 2 - 5, F
- **4**: 1, 2 - 5, F
- **5**: 3, 4 - F
- **F1-F4**: 5 -

### Agent Dispatch Summary

- **1**: **2** - T1 -> `quick`, T2 -> `quick`
- **2**: **3** - T3 -> `quick`, T4 -> `quick`, T5 -> `unspecified-low`
- **FINAL**: **4** - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. 类型定义 -- 新增 includeSubagentEvents 配置和 payload 字段

  **What to do**:
  - 在 `src/types.ts` 的 `NotificationConfig` 接口中新增字段: `includeSubagentEvents?: boolean`
  - 放置位置: 与 `timezone`、`language` 同级（顶层配置）
  - 在 `src/types.ts` 的 `EventPayload` 接口中新增两个字段:
    - `isSubagent?: boolean` -- 是否来自子代理（由 parentID 派生的布尔值）
    - `parentSessionId?: string` -- 父会话 ID（原始 parentID 值）
  - 保持现有字段不变，仅追加

  **Must NOT do**:
  - 不修改 Channel 接口
  - 不修改 EventConfig 接口
  - 不在 Channel 级别添加子代理过滤选项

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件类型定义变更，改动量小且明确
  - **Skills**: []
    - 无需特殊技能
  - **Skills Evaluated but Omitted**:
    - 所有技能均不涉及纯类型定义工作

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Wave 1 首任务)
  - **Blocks**: Task 2, Task 3, Task 4
  - **Blocked By**: None (可立即开始)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/types.ts:14-18` -- NotificationConfig 接口定义，includeSubagentEvents 追加到 timezone 之后
  - `src/types.ts:120-137` -- EventPayload 接口定义，新字段追加到 todoSummary 之后

  **API/Type References** (contracts to implement against):
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:465-492` -- Session 类型定义，确认 `parentID?: string` 字段签名

  **Test References** (testing patterns to follow):
  - 无需测试文件引用（类型定义本身不产生运行时行为）

  **External References** (libraries and frameworks):
  - TypeScript strict mode (`strict: true`) -- 新增可选字段无需初始化器

  **WHY Each Reference Matters**:
  - types.ts 的 NotificationConfig 和 EventPayload 是唯一直接修改目标
  - SDK Session.parentID 字段名必须准确匹配（camelCase: parentID）

  **Acceptance Criteria**:

  - [ ] `src/types.ts` 中 NotificationConfig 包含 `includeSubagentEvents?: boolean` 字段
  - [ ] `src/types.ts` 中 EventPayload 包含 `isSubagent?: boolean` 字段
  - [ ] `src/types.ts` 中 EventPayload 包含 `parentSessionId?: string` 字段
  - [ ] `npm run typecheck` 通过（类型定义无语法错误）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 类型定义编译通过
    Tool: Bash (npm run typecheck)
    Preconditions: Task 1 实现完成
    Steps:
      1. 运行 npm run typecheck
      2. 检查退出码
    Expected Result: exit code 0, 无类型错误
    Failure Indicators: tsc 报错 "Property 'includeSubagentEvents' does not exist" 或类似
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: 新字段出现在类型导出中
    Tool: Bash (grep)
    Preconditions: Task 1 实现完成
    Steps:
      1. grep -n "includeSubagentEvents" src/types.ts
      2. grep -n "isSubagent" src/types.ts
      3. grep -n "parentSessionId" src/types.ts
    Expected Result: 3 个字段各找到 1 处定义
    Failure Indicators: 任一字段未找到
    Evidence: .sisyphus/evidence/task-1-fields.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-typecheck.txt (typecheck 输出)
  - [ ] task-1-fields.txt (grep 结果)

  **Commit**: NO (与后续实现合并)

- [x] 2. 编写失败测试 -- TDD Red Phase (index.test.ts + config.test.ts)

  **What to do**:
  - 在 `tests/index.test.ts` 中新增 `describe('sub-agent filtering')` 测试组，包含以下测试用例:
    1. **主会话事件正常通知**: config 不设 includeSubagentEvents（或任意值），发送无 parentID 的 session.created 事件 --> 断言 sentEmails.length === 1
    2. **子代理事件默认被过滤**: config **不包含** includeSubagentEvents 字段，发送带 parentID 的 session.created 事件 --> 断言 sentEmails.length === 0（**默认行为：过滤子代理**）
    3. **显式 true 接收**: config 设置 `includeSubagentEvents: true`，发送带 parentID 的事件 --> 断言 sentEmails.length === 1（**显式开启子代理通知**）
    4. **显式 false 过滤**: config 设置 `includeSubagentEvents: false`，发送带 parentID 的事件 --> 断言 sentEmails.length === 0（**显式关闭，同默认行为**）
    5. **idle 事件子代理默认过滤**: 子代理 session idle 事件默认被过滤（需先创建带 parentID 的 session 再触发 idle）
    6. **error 事件子代理默认过滤**: 子代理 session error 事件默认被过滤
    7. **question 事件子代理默认过滤**: 子代理 question.asked 事件默认被过滤
    8. **多通道统一过滤**: 多个通道配置时，子代理事件对所有通道都不发送（默认行为）
  - 在 `tests/config.test.ts` 中新增 `describe('includeSubagentEvents merge')` 测试组:
    1. **全局有项目无**: global.includeSubagentEvents=true, project 无此字段 --> 合并结果为 true（全局值保留）
    2. **全局有项目覆盖**: global.includeSubagentEvents=false, project.includeSubagentEvents=true --> 合并结果为 true（项目覆盖）
    3. **都没有**: 两者都无此字段 --> 合并结果不含此字段（或 undefined，index.ts 应将其视为 false）
  - 更新 `configMock` 类型以支持 `includeSubagentEvents` 字段
  - 更新 `createMockEvent` helper 以支持构造带 parentID 的 Session 对象

  **Must NOT do**:
  - 不修改现有测试用例（只新增）
  - 不 mock handler 或 email 模块的新行为（测试应因缺少实现而失败）
  - 不在测试中实现任何生产代码逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 测试编写是确定性工作，遵循已有模式即可
  - **Skills**: []
    - 无需特殊技能
  - **Skills Evaluated but Omitted**:
    - 无相关技能

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (依赖 Task 1 类型就绪)
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: Task 1 (需要 isSubagent/parentSessionId/includeSubagentEvents 类型存在)

  **References**:

  **Pattern References** (existing code to follow):
  - `tests/index.test.ts:82-92` -- describe 块结构 + beforeEach/afterEach 模式
  - `tests/index.test.ts:59-75` -- createMockChannel / createMockEvent helper 函数模式
  - `tests/index.test.ts:128-162` -- session.created 事件完整测试流程（创建 ctx -> hooks -> event -> assert sentEmails）
  - `tests/index.test.ts:164-204` -- session.idle 测试（先 created 再 idle 的两步模式）
  - `tests/index.test.ts:42-54` -- configMock 定义和 mock.module 模式
  - `tests/config.test.ts:159-274` -- 配置合并测试模式（global + project 构造 -> mock fs -> loadConfig -> assert）

  **API/Type References** (contracts to implement against):
  - `src/types.ts` -- Task 1 新增的类型定义（includeSubagentEvents, isSubagent, parentSessionId）

  **Test References** (testing patterns to follow):
  - `tests/index.test.ts:889-924` -- "extended events disabled by default" 测试组（多事件批量验证模式）

  **External References** (libraries and frameworks):
  - Bun test API: `describe`, `test`, `expect`, `mock`, `beforeEach`, `afterEach`

  **WHY Each Reference Matters**:
  - index.test.ts 的 helper 函数和 mock 模式是新测试的基础设施
  - config.test.ts 的合并测试模式确保 includeSubagentEvents 正确参与全局+项目合并
  - session.idle 两步模式（created + idle）对子代理 idle 过滤测试至关重要

  **Acceptance Criteria**:

  - [ ] tests/index.test.ts 新增 describe('sub-agent filtering') 测试组
  - [ ] 至少 8 个集成测试用例覆盖主要场景
  - [ ] tests/config.test.ts 新增 describe('includeSubagentEvents merge') 测试组
  - [ ] 至少 3 个配置合并测试用例
  - [ ] 当前阶段测试应**失败**（TDD red phase -- 实现尚未完成）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 新测试在实现前应失败 (TDD Red Phase 验证)
    Tool: Bash (bun test)
    Preconditions: Task 1 完成, Task 2 完成, Task 3/4 未开始
    Steps:
      1. 运行 bun test tests/index.test.ts --timeout=30000 2>&1 | tail -30
      2. 检查 sub-agent filtering 相关测试的结果
    Expected Result: 子代理过滤相关测试 FAIL（因为 config 未合并 includeSubagentEvents、index.ts 未提取 parentID、未执行过滤逻辑）
    Failure Indicators: 所有新测试意外通过（说明可能有误判或已有隐式行为满足条件）
    Evidence: .sisyphus/evidence/task-2-red-phase.txt

  Scenario: 配置合并在实现前应失败
    Tool: Bun (bun test)
    Preconditions: Task 1 完成, Task 2 完成, Task 3 未开始
    Steps:
      1. 运行 bun test tests/config.test.ts --timeout=30000 2>&1 | tail -20
      2. 检查 includeSubagentEvents merge 相关测试结果
    Expected Result: 配置合并测试 FAIL（config.ts 尚未处理 includeSubagentEvents 字段）
    Failure Indicators: 测试意外通过
    Evidence: .sisyphus/evidence/task-2-config-red.txt
  ```

  **Evidence to Capture**:
  - [ ] task-2-red-phase.txt (index.test.ts 新测试的失败输出)
  - [ ] task-2-config-red.txt (config.test.ts 新测试的失败输出)

  **Commit**: NO (与实现合并)

- [x] 3. 配置合并 -- loadConfig() 中合并 includeSubagentEvents 字段

  **What to do**:
  - 在 `src/config.ts` 的 `loadConfig()` 函数中，与 `language` 和 `timezone` 合并逻辑并列的位置（约第 181-187 行），新增 includeSubagentEvents 的合并:
    ```typescript
    const mergedIncludeSubagentEvents = projectConfig?.includeSubagentEvents ?? globalConfig?.includeSubagentEvents;
    ```
  - 在 return 对象中展开此字段:
    ```typescript
    ...(mergedIncludeSubagentEvents !== undefined && { includeSubagentEvents: mergedIncludeSubagentEvents }),
    ```
  - 保持与 language/timezone 完全一致的合并模式（project 覆盖 global）
  - **注意**: 当 global 和 project 都没有 includeSubagentEvents 时，mergedIncludeSubagentEvents 为 undefined，返回对象不含此字段。index.ts 的过滤逻辑需要将 undefined 视为 false（默认不包含/过滤子代理）

  **Must NOT do**:
  - 不修改 mergeChannels / filterEnabledChannels 等函数
  - 不在 Channel 级别处理 includeSubagentEvents
  - 不改变现有字段（language、timezone）的合并逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单函数单位置追加，遵循已有模式
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES (与 Task 4 并行)
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1, Task 2

  **References**:

  **Pattern References** (existing code to follow):
  - `src/config.ts:180-188` -- language 和 timezone 的合并模式（?? 运算符 + 条件展开），includeSubagentEvents 紧跟其后

  **API/Type References**:
  - `src/types.ts` -- NotificationConfig.includeSubagentEvents 类型定义

  **WHY Each Reference Matters**:
  - 第 180-188 行是唯一的修改目标区域，必须精确匹配已有 ?? 模式

  **Acceptance Criteria**:

  - [ ] config.ts loadConfig() 中包含 includeSubagentEvents 合并逻辑
  - [ ] 使用 `??` 运算符（project 优先于 global）
  - [ ] 使用条件展开（仅在值非 undefined 时才加入返回对象）
  - [ ] `npm run test tests/config.test.ts` 通过（含新测试用例）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 配置合并 -- 全局有项目无时保留全局值
    Tool: Bash (bun test)
    Preconditions: Task 3 实现完成
    Steps:
      1. bun test tests/config.test.ts -t "global has project absent" 2>&1 | tail -15
    Expected Result: 测试 PASS, 断言 merged config 包含 includeSubagentEvents: true
    Failure Indicators: 测试 FAIL 或 includeSubagentEvents 为 undefined
    Evidence: .sisyphus/evidence/task-3-merge-global.txt

  Scenario: 配置合并 -- 项目覆盖全局
    Tool: Bash (bun test)
    Preconditions: Task 3 实现完成
    Steps:
      1. bun test tests/config.test.ts -t "project overrides" 2>&1 | tail -15
    Expected Result: 测试 PASS, 断言 merged config.includeSubagentEvents === false
    Failure Indicators: 值为 true（未被覆盖）
    Evidence: .sisyphus/evidence/task-3-merge-override.txt

  Scenario: 配置合并 -- 都没有时不污染结果
    Tool: Bash (bun test)
    Preconditions: Task 3 实现完成
    Steps:
      1. bun test tests/config.test.ts -t "neither has" 2>&1 | tail -15
    Expected Result: 测试 PASS, 断言结果不含 includeSubagentEvents 键或值为 undefined
    Failure Indicators: 结果中出现了 includeSubagentEvents: true/false
    Evidence: .sisyphus/evidence/task-3-merge-absent.txt
  ```

  **Evidence to Capture**:
  - [ ] task-3-merge-global.txt
  - [ ] task-3-merge-override.txt
  - [ ] task-3-merge-absent.txt

  **Commit**: YES (可与 Task 4 合并)
  - Message: `feat(config): 合并 includeSubagentEvents 配置字段`
  - Files: `src/config.ts`
  - Pre-commit: `bun test tests/config.test.ts`

- [x] 4. Payload 提取 + 过滤逻辑 -- eventToPayload 提取 parentID + event 回调过滤

  **What to do**:

  **Part A: eventToPayload() 提取 parentID**
  - 在 `src/index.ts` 的 `eventToPayload()` 函数中:
    - 对于 `session.created` 分支（line 27-31）: 从 `event.properties.info.parentID` 提取，写入 payload 的 `isSubagent` 和 `parentSessionId`
    - 对于所有其他分支（idle/error/question/permission/status/command/todo）: 从参数 `sessionInfo?.parentID` 提取
    - 对于 `default` 分支中的各事件处理: 同样从 `sessionInfo?.parentID` 提取
    - `isSubagent` = `parentID !== undefined && parentID !== ''`（布尔派生值）
    - `parentSessionId` = `parentID ?? undefined`（原始字符串或 undefined）
  - 注意: basePayload 定义在 switch 外部（line 19-23），但 sessionInfo 在各分支可用。最佳方案是在每个 return 前将这两个字段 spread 到 payload 对象上

  **Part B: event 回调过滤**
  - 在 `src/index.ts` 的 NotificationPlugin event 回调中（约 line 223-232）:
    - 在 `eventToPayload()` 返回后（line 223）、`if (!payload)` 检查后（line 225）、`eventHandler.handle()` 调用前（line 232）
    - 新增过滤判断:
      ```typescript
      // Filter sub-agent events by default (includeSubagentEvents defaults to false)
  const shouldFilterSubagents = config.includeSubagentEvents !== true; // undefined | false = filter, true = allow
  if (payload.isSubagent && shouldFilterSubagents) {
        if (DEBUG_ENABLED) {
          console.info(`${LOG_PREFIX} Skipping sub-agent event ${payload.eventType} for session ${payload.parentSessionId}`);
        }
        return;
      }
      ```
    - **核心逻辑**: `config.includeSubagentEvents !== true` -- 只有显式设为 true 才不过滤，undefined 和 false 都过滤

  **Must NOT do**:
  - 不修改 handler.ts（handler 保持纯分发器）
  - 不修改 template.ts 或 locales.ts
  - 不在模板变量中暴露 isSubagent/parentSessionId
  - 不重构现有的 eventToPayload switch-case 结构

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 两处精准改动（eventToPayload + event 回调），逻辑清晰
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES (与 Task 3 并行)
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1, Task 2

  **References**:

  **Pattern References** (existing code to follow):
  - `src/index.ts:18-132` -- eventToPayload() 完整函数，每个 case 分支的 return 语句处需追加 isSubagent/parentSessionId
  - `src/index.ts:19-23` -- basePayload 定义（不含 sessionInfo，所以 parentID 需在各分支单独提取）
  - `src/index.ts:208-236` -- NotificationPlugin event 回调，过滤逻辑插入点在 line 225 之后、line 232 之前
  - `src/index.ts:203` -- sessionMap 定义，确认缓存了完整 Session 对象
  - `src/index.ts:13` -- LOG_PREFIX 常量，调试日志使用
  - `src/index.ts:13` -- DEBUG_ENABLED 常量，条件日志使用

  **API/Type References**:
  - `src/types.ts` -- EventPayload.isSubagent / EventPayload.parentSessionId 类型定义（Task 1 新增）
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:469` -- Session.parentID?: string

  **Test References**:
  - `tests/index.test.ts` -- Task 2 编写的子代理过滤测试用例（此时应开始由红变绿）

  **WHY Each Reference Matters**:
  - eventToPayload 有 ~10 个 return 点（3 个 case + default 内 ~7 个 if），每个都需要处理 parentID 提取
  - event 回调中的插入点必须在 payload 非空检查之后、handle 调用之前
  - DEBUG_ENABLED 日志模式与文件中其他地方一致（line 204-206, 228-230）

  **Acceptance Criteria**:

  - [ ] eventToPayload() 所有分支均提取 parentID 到 isSubagent 和 parentSessionId
  - [ ] session.created 从 event.properties.info.parentID 提取
  - [ ] 其他事件从 sessionInfo?.parentID 提取
  - [ ] event 回调中存在 includeSubagentEvents 过滤逻辑
  - [ ] 过滤时 DEBUG 模式输出日志
  - [ ] `bun test tests/index.test.ts` 中子代理过滤相关测试全部 PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 主会话事件正常通知 (默认行为)
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "primary session notifies" 2>&1 | tail -15
    Expected Result: 测试 PASS, sentEmails.length === 1, subject 含项目名
    Failure Indicators: 主会话事件被误过滤
    Evidence: .sisyphus/evidence/task-4-primary-notifies.txt

  Scenario: 子代理事件默认被静默过滤 (无 includeSubagentEvents 配置时)
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "sub-agent filtered" 2>&1 | tail -15
    Expected Result: 测试 PASS, sentEmails.length === 0, 无错误抛出
    Failure Indicators: 子代理事件仍发送邮件（默认未生效）
    Evidence: .sisyphus/evidence/task-4-subagent-filtered.txt

  Scenario: 显式 true 时接收子代理通知
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "explicit true allows" 2>&1 | tail -15
    Expected Result: 测试 PASS, sentEmails.length === 1（includeSubagentEvents: true 时子代理通知通过）
    Failure Indicators: 显式 true 未生效，子代理仍被过滤
    Evidence: .sisyphus/evidence/task-4-explicit-true-allows.txt

  Scenario: idle 事件子代理默认过滤
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "idle sub-agent" 2>&1 | tail -15
    Expected Result: 测试 PASS, 子代理 idle 不触发邮件
    Failure Indicators: idle 事件未正确提取 parentID 或默认值错误
    Evidence: .sisyphus/evidence/task-4-idle-filter.txt

  Scenario: error 事件子代理默认过滤
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "error sub-agent" 2>&1 | tail -15
    Expected Result: 测试 PASS, 子代理 error 不触发邮件
    Failure Indicators: error 事件未正确提取 parentID
    Evidence: .sisyphus/evidence/task-4-error-filter.txt

  Scenario: question 事件子代理默认过滤
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "question sub-agent" 2>&1 | tail -15
    Expected Result: 测试 PASS, 子代理 question 不触发邮件
    Failure Indicators: question 事件未正确提取 parentID
    Evidence: .sisyphus/evidence/task-4-question-filter.txt

  Scenario: 多通道统一默认过滤
    Tool: Bash (bun test)
    Preconditions: Task 4 实现完成
    Steps:
      1. bun test tests/index.test.ts -t "multi-channel" 2>&1 | tail -15
    Expected Result: 测试 PASS, 多通道均不发送子代理邮件
    Failure Indicates: 部分通道仍发送
    Evidence: .sisyphus/evidence/task-4-multi-channel.txt
  ```

  **Evidence to Capture**:
  - [ ] task-4-primary-notifies.txt
  - [ ] task-4-subagent-filtered.txt
  - [ ] task-4-explicit-true-allows.txt
  - [ ] task-4-idle-filter.txt
  - [ ] task-4-error-filter.txt
  - [ ] task-4-question-filter.txt
  - [ ] task-4-multi-channel.txt

  **Commit**: YES (可与 Task 3 合并为一个 commit)
  - Message: `feat: 支持子代理事件识别与过滤 (includeSubagentEvents)`
  - Files: `src/index.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- [x] 5. 全量验证 -- typecheck + lint + 全量测试回归

  **What to do**:
  - 运行 `npm run typecheck` 确认类型无误
  - 运行 `npm run lint` 确认代码风格无误
  - 运行 `npm run test` 确认全部测试通过（含新旧测试，无回归）
  - 如有失败，修复问题并重新运行直到全部通过

  **Must NOT do**:
  - 不跳过任何测试套件
  - 不忽略 lint 警告
  - 不修改测试来适配实现（应修改实现来通过测试）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: 标准验证流程，按命令执行即可
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 最后一步
  - **Blocks**: F1-F4 (Final Verification Wave)
  - **Blocked By**: Task 3, Task 4

  **References**:

  **Pattern References**:
  - AGENTS.md 中的命令定义: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`

  **Acceptance Criteria**:

  - [ ] `npm run typecheck` exit 0
  - [ ] `npm run lint` exit 0
  - [ ] `npm run test` 全部 PASS（含全部已有测试 + 新增测试）
  - [ ] 无回归（已有测试用例数量不变且全部通过）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript 类型检查
    Tool: Bash (npm run typecheck)
    Preconditions: Task 3, 4 实现完成
    Steps:
      1. npm run typecheck 2>&1
    Expected Result: exit code 0, 无错误输出
    Failure Indicators: tsc 报错（类型不匹配、缺少属性等）
    Evidence: .sisyphus/evidence/task-5-typecheck.txt

  Scenario: ESLint 代码检查
    Tool: Bash (npm run lint)
    Preconditions: Task 3, 4 实现完成
    Steps:
      1. npm run lint 2>&1
    Expected Result: exit code 0, 无 warning/error
    Failure Indicators: eslint 报错（命名规范、未使用变量等）
    Evidence: .sisyphus/evidence/task-5-lint.txt

  Scenario: 全量测试无回归
    Tool: Bash (npm run test)
    Preconditions: Task 3, 4 实现完成
    Steps:
      1. npm run test 2>&1 | tail -40
    Expected Result: 所有测试 PASS, 总数 >= 已有测试数 + 11（8 集成 + 3 配置合并）
    Failure Indicators: 任何已有测试 FAIL（回归）
    Evidence: .sisyphus/evidence/task-5-full-test.txt
  ```

  **Evidence to Capture**:
  - [ ] task-5-typecheck.txt
  - [ ] task-5-lint.txt
  - [ ] task-5-full-test.txt

  **Commit**: 如有修复则单独 commit; 否则无需 commit

---

## Final Verification Wave (MANDATORY -- after ALL implementation tasks)

> 4 个 review agent 并行运行。全部 APPROVE 后呈现给用户并等待明确确认。

- [x] F1. **Plan Compliance Audit** -- `oracle`
  逐项对照计划验证实现:
  - **Must Have 检查**:
    1. `src/types.ts` NotificationConfig 包含 `includeSubagentEvents?: boolean` -- 读取文件验证
    2. `src/types.ts` EventPayload 包含 `isSubagent?: boolean` 和 `parentSessionId?: string` -- 读取文件验证
    3. `src/config.ts` loadConfig() 合并 includeSubagentEvents（?? 运算符）-- 读取文件验证
    4. `src/index.ts` eventToPayload() 提取 parentID -- grep 验证所有 return 分支
    5. `src/index.ts` event 回调包含过滤逻辑 -- 读取文件验证
  - **Must NOT Have 检查**:
    1. handler.ts 未被修改 -- git diff 确认
    2. locales.ts / template.ts 未被修改 -- git diff 确认
    3. Channel 接口未新增子代理字段 -- grep 确认
  - **Evidence 文件检查**: .sisyphus/evidence/ 下所有 task-{N}-*.txt 均存在
  Output: `Must Have [5/5] | Must NOT Have [3/3] | Evidence [N/N present] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  运行完整质量检查:
  - `npm run typecheck` -- tsc --noEmit 无错误
  - `npm run lint` -- eslint src 无 warning
  - `npm run test` -- 全部测试通过
  - 代码审查: 检查 `as any`、空 catch、console.log（prod）、注释代码、未使用导入
  - AI slop 检查: 过度注释、过度抽象、泛型命名（data/result/item/temp）
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  从干净状态执行每个 QA 场景:
  - 执行 Task 2 中所有测试用例的精确步骤
  - 跨任务集成验证: includeSubagentEvents=false（默认）+ 多事件类型 + 多通道
  - 边界测试: parentID 为空字符串、sessionMap 未命中、显式 false
  - 保存证据到 `.sisyphus/evidence/final-qa/`
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  逐任务对比计划与实际 diff:
  - Task 1: types.ts 变更是否仅包含 3 个新字段定义
  - Task 2: 测试文件变更是否仅包含新增 describe 块
  - Task 3: config.ts 变更是否仅包含 includeSubagentEvents 合并（~3 行）
  - Task 4: index.ts 变更是否包含 parentID 提取 + 过滤逻辑，无其他改动
  - "Must NOT do" 合规检查: handler/template/locale/channel 是否未被触碰
  - 跨任务污染检测: Task N 是否修改了 Task M 的文件
  Output: `Tasks [5/5 compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| # | Scope | Files | Description |
|---|-------|-------|-------------|
| C1 | Types | `src/types.ts` | feat: 新增 includeSubagentEvents 配置和 isSubagent/parentSessionId payload 字段 |
| C2 | Tests | `tests/index.test.ts`, `tests/config.test.ts` | test: 子代理过滤功能测试（TDD red phase） |
| C3 | Config merge | `src/config.ts` | feat: 合并 includeSubagentEvents 配置字段 |
| C4 | Filter logic | `src/index.ts` | feat: 提取 parentID 并实现子代理事件过滤 |

C3 和 C4 可合并为一个 commit。

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck    # Expected: exit 0, no errors
npm run lint        # Expected: exit 0, no warnings
npm run test        # Expected: all tests pass (existing + new)
```

### Final Checklist
- [ ] 所有 "Must Have" 已实现
- [ ] 所有 "Must NOT Have" 未触碰
- [ ] 全部测试通过
- [ ] 类型检查通过
- [ ] Lint 通过
- [ ] 无回归
