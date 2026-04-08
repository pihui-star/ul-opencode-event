# 项目简称（projectName）与完整路径（projectPath）

## TL;DR

> **核心目标**: 将 `projectName` 从完整目录路径改为短名称（配置值或 `path.basename`），新增 `projectPath` 保留完整路径，两个变量均可在模板中使用。
> 
> **产出物**:
> - `NotificationConfig.projectName` 配置字段
> - `EventPayload.projectPath` 新字段
> - handler 模板变量映射增加 `projectPath`
> - 测试覆盖：basename 推导、配置覆盖、边界情况
> - 文档更新：变量表、配置示例
> 
> **规模估算**: Short
> **并行执行**: YES - 3 waves
> **关键路径**: Task 1 → Task 2 → Task 4 → Task 7

---

## Context

### Original Request

用户发现通知中的 `projectName` 显示的是完整目录路径（如 `D:\projects\ulthon\ul-opencode-event`），在邮件主题和钉钉消息中太长。希望增加一个项目简称。

### Interview Summary

**Key Discussions**:
- `projectName` 来自 `ctx.directory`（OpenCode SDK 插件上下文），始终是完整路径
- 用户选择"两个变量都保留"：`projectName` 改为简称，新增 `projectPath` 保留完整路径
- 简称来源优先级：配置文件中的 `projectName` > `path.basename(ctx.directory)`

**Research Findings**:
- 变更影响约 8 个源文件 + 6 个测试文件 + 4 个文档文件
- `config.ts` 不需要改动 —— `loadConfig()` 已会将 JSON 中的所有顶层字段原样返回，`projectName` 自然包含在内
- `locales.ts` 的 18 个默认模板不需要修改（值变了，模板不变）
- `template.ts` 渲染逻辑不需要修改

### Metis Review

**Identified Gaps** (addressed):
- `path.basename()` 在根路径（`C:\`、`/`）返回空字符串 -> 加 fallback 到 `'unknown-project'`
- `eventToPayload` 签名需要调整 -> 加第 5 个参数 `projectPath`（最小改动）
- CLI 测试 payload 需加 `projectPath` -> 使用 `process.cwd()`
- `projectName` 是项目级配置，不需要全局合并逻辑 -> 无需修改 `config.ts`

---

## Work Objectives

### Core Objective

将 `projectName` 的语义从完整路径改为短名称，同时通过 `projectPath` 保留完整路径信息。

### Concrete Deliverables

- `NotificationConfig` 接口增加 `projectName?: string` 字段
- `EventPayload` 接口增加 `projectPath?: string` 字段
- `index.ts` 推导短名称：`config.projectName ?? path.basename(ctx.directory)` + fallback
- `handler.ts` 将 `projectPath` 加入模板变量映射
- `locales.ts` 18 个默认模板调整：subject 改为 `[{{projectName}}]` 开头，body 第一行改为 `[{{projectName}}]`，删除代理类型/父会话行
- 所有测试 payload helper 更新
- 新增测试：basename 推导、配置覆盖、边界情况、模板变量可用性
- 文档更新：README.md、docs/template-configuration.md、examples/

### Definition of Done

- [ ] `bun test` 全部通过
- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 成功
- [ ] 自定义模板 `{{projectPath}}` 能正确渲染完整路径
- [ ] 未配置 `projectName` 时自动取 `path.basename(ctx.directory)`

### Must Have

- `projectName` 配置字段（项目级，不需要全局合并）
- `path.basename` 自动推导 + 空字符串 fallback
- `projectPath` 在模板中可用
- 所有现有测试更新并通过

### Must NOT Have (Guardrails)

- 不修改 `template.ts` 渲染逻辑
- 不重构 `eventToPayload` 为 options 对象（保持最小参数改动）
- 不修改 `ChannelFormatter.format()` 签名
- 不给 `projectName` 配置值加验证（允许任意字符串）
- 不升级包版本号

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Module/Logic**: Use Bash (`bun test`) - Run tests, assert pass/fail
- **Type Safety**: Use Bash (`npm run typecheck`) - Verify no type errors

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - types + core logic):
+-- Task 1: types.ts 增加 projectName + projectPath 字段 [quick]
+-- Task 2: index.ts + handler.ts 推导短名称 + 模板变量 (depends: 1) [deep]

Wave 2 (After Wave 1 - locales + CLI, parallel):
+-- Task 3: locales.ts 调整默认模板格式 (no deps) [quick]
+-- Task 4: cli.ts 更新测试 payload (depends: 1) [quick]

Wave 3 (After Wave 2 - tests + docs, MAX PARALLEL):
+-- Task 5: 更新所有测试文件 (depends: 2, 3) [unspecified-high]
+-- Task 6: 更新文档和示例 (depends: 2, 4) [writing]

Wave FINAL (After ALL tasks -- 4 parallel reviews, then user okay):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real test QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 2 -> Task 5 -> F1-F4 -> user okay
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 2 (Waves 2 & 3)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1    | -         | 2, 4   | 1    |
| 2    | 1         | 5, 6   | 1    |
| 3    | -         | 5      | 2    |
| 4    | 1         | 6      | 2    |
| 5    | 2, 3      | F1-F4  | 3    |
| 6    | 2, 4      | F1-F4  | 3    |

### Agent Dispatch Summary

- **Wave 1**: 2 - T1 -> `quick`, T2 -> `deep`
- **Wave 2**: 2 - T3 -> `quick`, T4 -> `quick`
- **Wave 3**: 2 - T5 -> `unspecified-high`, T6 -> `writing`
- **FINAL**: 4 - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. types.ts: 增加 projectName 配置字段和 projectPath payload 字段

  **What to do**:
  - 在 `NotificationConfig` 接口（`src/types.ts:25-32`）中添加 `projectName?: string` 字段，位于 `timezone` 和 `language` 之后
  - 在 `EventPayload` 接口（`src/types.ts:141-163`）中添加 `projectPath?: string` 字段，位于 `projectName` 之后
  - 字段注释说明：`projectName` 是用户自定义的项目简称，`projectPath` 是项目完整路径

  **Must NOT do**:
  - 不修改 `projectName` 在 `EventPayload` 中的类型（保持 `string`，非 optional）
  - 不改动任何其他接口

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 仅修改一个文件的两个接口定义，添加 2 行代码
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:25-32` - NotificationConfig 接口结构，参考 `language` 和 `timezone` 字段的注释风格
  - `src/types.ts:141-163` - EventPayload 接口结构，参考 `projectName` 字段位置

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript 类型检查通过
    Tool: Bash
    Preconditions: types.ts 已修改
    Steps:
      1. 运行 `npm run typecheck`
    Expected Result: 输出无错误
    Failure Indicators: 出现类型错误
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(types): add projectName config field and projectPath payload field`
  - Files: `src/types.ts`

- [x] 2. index.ts + handler.ts: 推导短名称 + 模板变量映射

  **What to do**:

  **index.ts**:
  - 在 `eventToPayload` 函数签名中增加第 5 个参数 `projectPath?: string`
  - 在函数体中 `basePayload` 增加 `projectPath` 字段
  - 在 `NotificationPlugin` 主函数中（约 299 行）：
    - 从 `config.projectName` 获取配置的短名称（项目级配置）
    - 若未配置，用 `path.basename(ctx.directory)` 推导
    - 若 basename 为空字符串，fallback 为 `'unknown-project'`
    - 调用 `eventToPayload(event, resolvedProjectName, sessionInfo, resolvedTimezone, ctx.directory)`
  - 需在文件顶部 import `path`（`import * as path from 'path'`）

  **handler.ts**:
  - 在 `handler.ts:98-119` 的 variables 对象中添加 `projectPath: payload.projectPath`

  **注意**：`projectName` 是项目级配置，不需要全局合并逻辑。`config.ts` 的 `loadConfig()` 已会将 JSON 中的所有顶层字段原样返回（包括 `projectName`），无需额外修改 `config.ts`。

  **Must NOT do**:
  - 不重构 `eventToPayload` 为 options 对象
  - 不修改 `locales.ts` 默认模板
  - 不修改 `template.ts` 渲染逻辑
  - 不修改 `ChannelFormatter.format()` 签名

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及核心逻辑变更，需要理解 config → index → handler → template 的数据流
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (with Task 4, but depends on Wave 1)
  - **Blocks**: Task 5, Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/index.ts:299` - 当前 `eventToPayload(event, ctx.directory, sessionInfo, resolvedTimezone)` 调用点，需要改为传入短名称 + 完整路径
  - `src/index.ts:30-36` - `basePayload` 构造，需要增加 `projectPath` 字段
  - `src/handler.ts:98-119` - 模板变量映射，需要增加 `projectPath: payload.projectPath`

  **API/Type References**:
  - `src/types.ts:EventPayload.projectPath` - Task 1 新增的 payload 字段
  - `src/types.ts:NotificationConfig.projectName` - Task 1 新增的配置字段

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 未配置 projectName 时自动推导 basename
    Tool: Bash
    Preconditions: ctx.directory = '/test/my-project'
    Steps:
      1. 运行 `npm run typecheck` 确认无类型错误
    Expected Result: typecheck 通过，projectName 应为 'my-project'
    Failure Indicators: 类型错误或逻辑错误
    Evidence: .sisyphus/evidence/task-3-basename-derive.txt

  Scenario: 路径末尾有分隔符时正确处理
    Tool: Bash
    Preconditions: ctx.directory = '/test/my-project/' (trailing slash)
    Steps:
      1. 验证 path.basename('/test/my-project/') === 'my-project'
    Expected Result: 返回 'my-project' 而非空字符串
    Failure Indicators: basename 返回空
    Evidence: .sisyphus/evidence/task-3-trailing-slash.txt
  ```

  **Commit**: YES
  - Message: `feat(core): derive short projectName, add projectPath variable`
  - Files: `src/index.ts`, `src/handler.ts`

- [x] 3. locales.ts + dingtalk formatter: 调整默认模板格式 + 钉钉标题拼接

  **What to do**:

  **Part A - locales.ts 默认模板调整**：
  - 修改中英文共 18 个默认模板（2 语言 x 9 事件类型）
  - **Subject 格式变更**：`[OpenCode] 事件描述 - {{projectName}}` -> `[{{projectName}}] 事件描述`
  - **Body 格式变更**（SMTP 和 DingTalk 共用同一套模板）：
    - 删除 `项目: {{projectName}}` / `Project: {{projectName}}` 行（subject 已包含项目名）
    - 删除 `代理类型: {{sessionType}}` / `Agent Type: {{sessionType}}` 行
    - 删除 `父会话: {{parentSessionId}}` / `Parent Session: {{parentSessionId}}` 行
    - body 第一行不加 `[{{projectName}}]` —— 项目名统一由 subject 承载
  - 两种语言的模板都按相同规则修改

  **中文 idle 模板示例（之前 -> 之后）**：
  ```
  Subject:
    之前: [OpenCode] 任务已完成 - {{projectName}}
    之后: [{{projectName}}] 任务已完成

  Body:
    之前:                              之后:
    任务完成时间: {{timestamp}}        任务完成时间: {{timestamp}}
    项目: {{projectName}}              会话: {{sessionTitle}}...
    会话: {{sessionTitle}}...          消息: {{message}}
    消息: {{message}}                  耗时: {{duration}}
    耗时: {{duration}}
    代理类型: {{sessionType}}          (删除)
    父会话: {{parentSessionId}}        (删除)
  ```

  **英文 idle 模板示例（之前 -> 之后）**：
  ```
  Subject:
    之前: [OpenCode] Task Completed - {{projectName}}
    之后: [{{projectName}}] Task Completed

  Body:
    之前:                              之后:
    Task completed at {{timestamp}}    Task completed at {{timestamp}}
    Project: {{projectName}}           Session: {{sessionTitle}}...
    Session: {{sessionTitle}}...       Message: {{message}}
    Message: {{message}}               Duration: {{duration}}
    Duration: {{duration}}
    Agent Type: {{sessionType}}        (deleted)
    Parent Session: {{parentSessionId}}(deleted)
  ```

  **所有 9 种事件类型的 subject 统一格式**：
  | 事件 | 中文 Subject | 英文 Subject |
  |------|-------------|-------------|
  | created | `[{{projectName}}] 任务已启动` | `[{{projectName}}] Task Started` |
  | idle | `[{{projectName}}] 任务已完成` | `[{{projectName}}] Task Completed` |
  | error | `[{{projectName}}] 任务出错` | `[{{projectName}}] Task Error` |
  | question | `[{{projectName}}] AI 提问` | `[{{projectName}}] Question` |
  | permission | `[{{projectName}}] 需要权限确认` | `[{{projectName}}] Permission Required` |
  | status | `[{{projectName}}] 状态变更` | `[{{projectName}}] Status Change` |
  | command | `[{{projectName}}] 命令已执行` | `[{{projectName}}] Command Executed` |
  | fileEdited | `[{{projectName}}] 文件已编辑` | `[{{projectName}}] File Edited` |
  | todo | `[{{projectName}}] Todo 已更新` | `[{{projectName}}] Todos Updated` |

  **Part B - dingtalk.ts formatter 标题拼接**：
  - 当前钉钉 formatter（`src/dingtalk.ts:92-146`）把 `subject` 放到 `markdown.title`（仅用于消息列表预览），`markdown.text` 只包含 `body` 内容
  - 钉钉用户实际看到的是 `text` 字段，看不到 `title` 字段 —— 导致消息正文缺少标题
  - 修改 `createDingTalkFormatter` 的 `format()` 方法：在处理 body lines 之前，先把 subject 作为 markdown 标题插入 text 开头
  - 具体做法：在 `processedLines` 数组最前面加入 `### ` + subject 内容（经过转义）
  - 示例效果：钉钉消息正文开头会显示 `### [ul-opencode-event] 任务已完成`，然后是 body 各行
  - 注意：subject 转义使用已有的 `escapeMarkdown()` 函数；截断规则不变（title 100字符，text 4000字符）

  **Must NOT do**:
  - 不添加 `{{projectPath}}` 到默认模板（用户按需自定义）
  - 不改变模板变量语法
  - 不改变 `fileEdited` 事件中没有 `sessionTitle`/`sessionId` 的现有结构

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯文本替换 + 一处逻辑修改，规则明确，涉及 `src/locales.ts` 和 `src/dingtalk.ts`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: None（不依赖 Task 1/2，模板改的是文本内容）

  **References**:

  **Pattern References**:
  - `src/locales.ts:29-76` - 英文模板定义（en 块）
  - `src/locales.ts:78-125` - 中文模板定义（zh 块）
  - `src/dingtalk.ts:92-146` - `createDingTalkFormatter.format()` 方法，需要在 processedLines 构建前插入 subject 标题行

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 中文 idle 模板 subject 以项目名开头
    Tool: Bash
    Steps:
      1. 运行 `bun test tests/locales.test.ts`
    Expected Result: 测试通过，subject 格式为 [{{projectName}}] 任务已完成
    Evidence: .sisyphus/evidence/task-3-locales-zh.txt

  Scenario: 所有模板 body 不包含 "代理类型" 或 "Agent Type"
    Tool: Bash
    Steps:
      1. 在 src/locales.ts 中 grep "sessionType" 和 "parentSessionId"
    Expected Result: 0 匹配（全部删除）
    Evidence: .sisyphus/evidence/task-3-locales-cleanup.txt

  Scenario: 钉钉 formatter 在 text 开头插入 subject 标题
    Tool: Bash
    Steps:
      1. 运行 `bun test tests/dingtalk.test.ts`
    Expected Result: 测试通过，formatted message 的 text 字段以 `### ` 开头
    Evidence: .sisyphus/evidence/task-3-dingtalk-title.txt
  ```

  **Commit**: YES
  - Message: `refactor(locales,dingtalk): restructure templates and add subject to DingTalk body`
  - Files: `src/locales.ts`, `src/dingtalk.ts`

- [x] 4. cli.ts: 更新测试 payload 增加 projectPath

  **What to do**:
  - 在 `src/cli.ts:465` 的 DingTalk 测试 payload 中添加 `projectPath` 字段
  - 值使用 `process.cwd()`（与 CLI 运行环境一致）
  - 同时将 `projectName: 'test'` 改为更具描述性的值

  **Must NOT do**:
  - 不修改 CLI 的其他逻辑
  - 不增加新的 CLI 参数

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 仅修改一行测试 payload
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/cli.ts:465` - 当前测试 payload `{ eventType: 'idle', timestamp, projectName: 'test', sessionId: 'cli-test', sessionType: 'main' }`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CLI 构建无类型错误
    Tool: Bash
    Steps:
      1. 运行 `npm run typecheck`
    Expected Result: 无错误
    Evidence: .sisyphus/evidence/task-4-cli-typecheck.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(core): derive short projectName, add projectPath variable`
  - Files: `src/cli.ts`

- [x] 5. 更新所有测试文件

  **What to do**:
  - **tests/handler.test.ts**:
    - `createPayload()` helper（约 67-75 行）：添加 `projectPath: '/test/test-project'` 到默认 payload
    - 所有使用 `createPayload` 的测试自动继承新字段
    - 新增测试用例：自定义模板中 `{{projectPath}}` 正确渲染完整路径
  - **tests/template.test.ts**:
    - 新增测试：`renderTemplate('Path: {{projectPath}}', { projectPath: '/full/path/to/project' })` 返回正确值
  - **tests/dingtalk.test.ts**:
    - `dummyPayload`（约 38 行）：添加 `projectPath` 字段
    - 更新断言：formatted message 的 `text` 字段应以 `### ` 开头（subject 作为标题拼接进来了）
    - 更新断言：text 内容不再包含 `sessionType`/`parentSessionId` 相关文本
  - **tests/email.test.ts**:
    - 如有 payload 构造，添加 `projectPath`
  - **tests/integration/full-flow.test.ts**:
    - 所有 payload 构造处添加 `projectPath`
    - 检查断言中是否有检查完整路径在 `projectName` 中的测试，如有需更新
  - **tests/config.test.ts**:
    - 新增：项目级配置中设置了 projectName 时 loadConfig 返回该值
    - 新增：未配置 projectName 时 loadConfig 返回值不含该字段
  - **tests/locales.test.ts**（如存在）:
    - 更新断言：subject 格式应为 `[{{projectName}}] ...` 而非 `[OpenCode] ... - {{projectName}}`
    - 更新断言：body 不包含 `sessionType`、`parentSessionId`、`项目:`/`Project:` 行
  - **tests/index.test.ts**（如存在）:
    - 更新 payload 相关断言

  **Must NOT do**:
  - 不改变测试框架或测试结构
  - 不删除现有测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 涉及 6+ 个测试文件的批量更新，需要仔细检查每个文件的 payload 构造
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2, Task 3

  **References**:

  **Pattern References**:
  - `tests/handler.test.ts:67-75` - createPayload helper，所有 handler 测试用此构造 payload
  - `tests/dingtalk.test.ts:38` - dummyPayload 构造
  - `tests/integration/full-flow.test.ts:122` - integration 测试 payload

  **Test References**:
  - `tests/config.test.ts:608-773` - includeSessionTypes 合并测试模式，projectName 测试应遵循相同模式
  - `tests/template.test.ts:12-20` - 模板渲染测试模式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全部测试通过
    Tool: Bash
    Preconditions: 所有测试文件已更新
    Steps:
      1. 运行 `bun test`
    Expected Result: 所有测试通过，0 failures
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-5-all-tests.txt

  Scenario: 类型检查通过
    Tool: Bash
    Steps:
      1. 运行 `npm run typecheck`
    Expected Result: 无类型错误
    Failure Indicators: 任何类型错误
    Evidence: .sisyphus/evidence/task-5-typecheck.txt

  Scenario: 构建成功
    Tool: Bash
    Steps:
      1. 运行 `npm run build`
    Expected Result: 成功生成 dist/ 产物
    Failure Indicators: 构建失败
    Evidence: .sisyphus/evidence/task-5-build.txt
  ```

  **Commit**: YES
  - Message: `test: update all test payloads with projectPath, add config merge tests`
  - Files: `tests/`

- [x] 6. 更新文档和示例

  **What to do**:
  - **docs/template-configuration.md**:
    - 第五节"全部可用变量"的通用变量表格中增加 `{{projectPath}}` 行
    - 变量速查表中注明 `projectPath` 适用于所有事件类型
    - 第七节"内置默认模板参考"：同步更新所有 18 个模板为新格式（subject 改为 `[{{projectName}}]` 开头，body 去掉项目名/代理类型/父会话行）
    - 第九节 FAQ 中更新相关说明
  - **README.md**:
    - Template Variables 表格中增加 `{{projectPath}}` 行
    - Full Configuration Example 中可选展示 `projectName` 配置
  - **docs/dingtalk-channel.md**:
    - 模板示例中可选添加 `{{projectPath}}`
  - **examples/ul-opencode-event.json**:
    - 添加 `projectName` 配置示例（带注释）

  **Must NOT do**:
  - 不修改默认模板内容
  - 不添加不必要的长篇描述

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 纯文档更新任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 5)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2, Task 4

  **References**:

  **Pattern References**:
  - `docs/template-configuration.md:85-93` - 通用变量表格，需要增加 projectPath 行
  - `README.md` 中 Template Variables 段落 - 同步更新

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 文档变量表包含 projectPath
    Tool: Bash
    Steps:
      1. 在 docs/template-configuration.md 中搜索 projectPath
    Expected Result: 找到 projectPath 的表格行和说明
    Failure Indicators: 未找到
    Evidence: .sisyphus/evidence/task-6-docs-check.txt

  Scenario: README 包含 projectPath
    Tool: Bash
    Steps:
      1. 在 README.md 中搜索 projectPath
    Expected Result: 找到 projectPath 变量说明
    Failure Indicators: 未找到
    Evidence: .sisyphus/evidence/task-6-readme-check.txt
  ```

  **Commit**: YES
  - Message: `docs: document projectPath template variable and projectName config`
  - Files: `docs/template-configuration.md`, `README.md`, `docs/dingtalk-channel.md`, `examples/ul-opencode-event.json`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns -- reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Test QA** -- `unspecified-high`
  Run `bun test` and verify ALL tests pass. Run `npm run build` and verify dist/ builds correctly. Check that no test file was missed in the update.
  Output: `Tests [N/N pass] | Build [PASS/FAIL] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 -- everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit 1**: `feat(types): add projectName config field and projectPath payload field` - src/types.ts
- **Commit 2**: `feat(core): derive short projectName, add projectPath variable` - src/index.ts, src/handler.ts
- **Commit 3**: `refactor(locales,dingtalk): restructure templates and add subject to DingTalk body` - src/locales.ts, src/dingtalk.ts
- **Commit 4**: `feat(cli): add projectPath to CLI test payload` - src/cli.ts
- **Commit 5**: `test: update all test payloads with projectPath, update template assertions` - tests/
- **Commit 6**: `docs: document projectPath template variable and projectName config` - docs/, README.md, examples/

---

## Success Criteria

### Verification Commands
```bash
bun test                                    # Expected: all tests pass
npm run typecheck                           # Expected: no errors
npm run build                               # Expected: successful build to dist/
npm run lint                                # Expected: no errors
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] `{{projectPath}}` renders correctly in custom templates
- [ ] `{{projectName}}` shows short name (basename or config value)
