# 全事件通知支持 + 时区配置 + Duration 修复

## TL;DR

> **Quick Summary**: 为 ul-opencode-event 插件新增 7 种事件通知（question/permission **默认开启**，status/command/fileEdited/todo 默认关闭），支持时区配置，修复 Duration 0ms Bug。
>
> **Deliverables**:
> - `src/types.ts` -- EventType 从 3 种扩展到 10 种，EventPayload 新增 7 个字段
> - `src/index.ts` -- 新增 7 个 switch case + formatTimestamp() + Duration 修复
> - `src/handler.ts` -- 新增 7 套默认模板 + 变量映射
> - `tests/*.test.ts` -- 全部测试文件更新覆盖新功能
>
> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 2 waves (Wave 1: 类型+Bug修复, Wave 2: 全部事件+时区)
> **Critical Path**: Task 1(types) -> Task 2(duration fix) -> Task 3(timezone) -> Task 4(all events) -> Task 5(tests)

---

## Context

### Original Request

用户提出需求：
1. OpenCode 触发交互提问（如权限确认、方案选择）时能否发送事件提醒邮件？
2. 当前邮件通知内容存在问题：timestamp 始终 UTC 格式不可读，Duration 永远显示 0ms

用户后续明确：
- 主要目标是 `question.asked` 事件（AI 向用户提问）
- `permission.updated` 也要加上
- 中等价值事件（session.status, command.executed, file.edited, todo.updated）全部加上，但**默认关闭**

### Interview Summary

**Key Discussions**:
- 用户粘贴了实际收到的邮件内容作为问题证据
- 用户举例"在中国时区就按中国时区显示"，明确了时区的使用场景
- 用户查看了完整事件列表后，决定**全部有价值的都加上**，用默认开关控制
- **核心事件（question/permission）默认开启**；扩展事件（status/command/fileEdited/todo）**默认关闭**

**Research Findings**:
- SDK v1 (`@opencode-ai/sdk`) 暴露的事件类型中与通知相关的有: session.*, permission.*, command.executed, file.edited, todo.updated, session.status 等
- **重要发现 (librarian)**: OpenCode 源码 (`anomalyco/opencode`) 定义了 `question.asked` 事件（含 questions[]、options[]、multiple choice），但当前安装的 v1 SDK 的 Event 联合类型中**未包含此事件**
- 策略：对 `question.asked` 做**防御性监听**（运行时 type 检查），SDK 升级后自动生效；同时实现 `permission.updated` 作为 v1 可用的备选
- Duration Bug 根因：`sessionMap` 存储的是 `session.created` 时的 Session 快照，此时 `time.updated ≈ time.created`
- 项目使用 bun test 测试框架，有完整的 mock 基础设施
- Node.js/Bun 内置 `Intl.DateTimeFormat` 支持时区转换，零外部依赖

### Metis Review

**Identified Gaps** (addressed):
- **SDK 版本区分**: v1 SDK 未暴露 `question.asked`，需运行时防御处理；v2 SDK 改名为 `permission.asked`
- **timezone 配置位置**: NotificationConfig 顶层全局字段
- **扩展事件策略**: 默认全部关闭（opt-in），避免骚扰
- **formatTimestamp 向后兼容**: 未配置 timezone 时输出与当前完全一致
- **Duration 修复语义**: `Date.now() - sessionInfo.time.created`

---

## Work Objectives

### Core Objective

将插件的事件覆盖从 3 种扩展到 10 种，全面支持 OpenCode 的各类可通知事件，同时修复时间显示体验问题。

### Concrete Deliverables

1. **全事件支持**: 新增 question/permission/status/command/fileEdited/todo/sessionStatus 共 7 种事件类型
2. **时区配置**: 新增 `timezone` 配置项（IANA 标识符）
3. **Duration 0ms 修复**: 修正耗时计算逻辑

### Definition of Done

- [ ] `bun test` 全部通过（0 failures）
- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 构建成功
- [ ] 10 种事件均可独立配置开关
- [ ] 核心事件（idle/error）行为不变
- [ ] Timezone 配置后 timestamp 显示本地时间
- [ ] Duration 显示正确的非零值

### Must Have

#### 事件映射表（SDK event.type -> 内部 EventType）

| 内部 EventType | SDK event.type | 默认启用 | 说明 | EventPayload 额外字段 |
|---------------|---------------|---------|------|---------------------|
| `created` | `session.created` | YES (不变) | 任务开始 | (无新增) |
| `idle` | `session.idle` | YES (不变) | 任务完成 | message, duration |
| `error` | `session.error` | YES (不变) | 任务出错 | error |
| **`question`** | **`question.asked`** | **YES (默认开启)** | **AI 提问(主要目标)** | **title, questionText, options** |
| **`permission`** | **`permission.updated`** | **YES (默认开启)** | **权限确认** | **title, permissionType** |
| **`status`** | **`session.status`** | **NO (opt-in)** | **状态变化** | **statusType** |
| **`command`** | **`command.executed`** | **NO (opt-in)** | **命令执行** | **commandName, arguments** |
| **`fileEdited`** | **`file.edited`** | **NO (opt-in)** | **文件修改** | **filePath** |
| **`todo`** | **`todo.updated`** | **NO (opt-in)** | **Todo 更新** | **todoSummary** |

#### 类型系统变更

- **EventType**: `'created' | 'idle' | 'error' | 'question' | 'permission' | 'status' | 'command' | 'fileEdited' | 'todo'`
- **EventConfig**: 每种事件对应一个 `boolean?` 字段（created/idle/error 保持不变，其余 7 个新增）
- **ChannelTemplates**: 每种事件对应可选的 `TemplateConfig`
- **EventPayload** 新增字段:
  - `title?: string` -- question/permission 的标题
  - `questionText?: string` -- question 的完整问题文本
  - `options?: string` -- question 的选项摘要
  - `permissionType?: string` -- permission 的类型（bash/edit 等）
  - `statusType?: string` -- status 的类型（idle/busy/retry）
  - `commandName?: string` -- 执行的命令名
  - `arguments?: string` -- 命令参数
  - `filePath?: string` -- 被编辑的文件路径
  - `todoSummary?: string` -- todo 列表摘要
- **NotificationConfig** 新增: `timezone?: string`

### Must NOT Have (Guardrails)

- 不实现任何 `.replied` / `.rejected` 事件（仅 ask/updated 阶段）
- 不添加 rate limiting / coalescing / deduplication
- 不引入任何外部日期库
- 不修改 template.ts 的正则或渲染逻辑
- 不创建新的源代码文件
- 不修改 email.ts 发送逻辑
- 不更新 CLI 工具或 README 文档
- 不支持 HTML 邮件模板
- **不监听高频事件**: message.updated/part.updated/removed, file.watcher.updated, lsp.* （这些一次任务可能触发几十次）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** -- ALL verification is agent-executed.

### Test Decision

- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD
- **Framework**: bun test

### QA Policy

Every task MUST include agent-executed QA scenarios.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: Types 全面扩展 (types.ts) [quick]
└── Task 2: Duration 0ms Bug 修复 (index.ts) [quick]

Wave 2 (After Wave 1 — all new features):
├── Task 3: 时区配置支持 (index.ts) [quick]
└── Task 4: 全事件支持 + handler 集成 (index.ts + handler.ts) [unspecified-high]

Wave 3 (After Wave 2 — tests):
└── Task 5: 测试全覆盖与集成验证 (all test files) [unspecified-high]

Wave FINAL (After ALL tasks):
├── F1: Plan Compliance Audit (oracle)
├── F2: Code Quality Review (unspecified-high)
├── F3: Full Test Suite Execution (unspecified-high)
└── F4: Scope Fidelity Check (deep)
```

### Dependency Matrix

- **1**: -- 2, 3, 4, 5
- **2**: 1 -- 5
- **3**: 1 -- 5
- **4**: 1, 3 -- 5
- **5**: 1, 2, 3, 4 -- F1-F4

### Agent Dispatch Summary

- **1**: **2** -- T1 -> `quick`, T2 -> `quick`
- **2**: **2** -- T3 -> `quick`, T4 -> `unspecified-high`
- **3**: **1** -- T5 -> `unspecified-high`
- **FINAL**: **4** -- F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. Types 全面扩展 -- 10 种事件类型 + timezone + 9 个 payload 字段

  **What to do**:
  - `EventType` 联合类型: 从 `'created' | 'idle' | 'error'` 扩展为 `'created' | 'idle' | 'error' | 'question' | 'permission' | 'status' | 'command' | 'fileEdited' | 'todo'`
  - `EventConfig` 接口: 新增 `question?`, `permission?`, `status?`, `command?`, `fileEdited?`, `todo?` (全部 `boolean?`)
  - `ChannelTemplates` 接口: 新增对应的 6 个可选模板字段
  - `EventPayload` 接口: 新增 `title?`, `questionText?`, `options?`, `permissionType?`, `statusType?`, `commandName?`, `arguments?`, `filePath?`, `todoSummary?`
  - `NotificationConfig` 接口: 新增 `timezone?: string`

  **Must NOT do**:
  - 不修改已有字段签名
  - 不删除或重命名现有类型
  - 不引入新接口（仅扩展现有）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯类型定义扩展，单文件，模式重复
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 1, Task 1)
  - **Blocks**: Tasks 2-5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:75-79` -- EventConfig 模式
  - `src/types.ts:84-88` -- ChannelTemplates 模式
  - `src/types.ts:98-109` -- EventPayload 模式
  - `src/types.ts:114` -- EventType 联合类型
  - `src/types.ts:9-11` -- NotificationConfig 模式

  **API/Type References**:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:384-395` -- EventPermissionUpdated
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:369-383` -- Permission 类型
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:406-412` -- EventSessionStatus + SessionStatus
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:456-464` -- EventCommandExecuted
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:425-430` -- EventFileEdited
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:449-455` -- EventTodoUpdated + Todo 类型

  **Acceptance Criteria**:

  - [ ] `npm run typecheck` 通过
  - [ ] EventType 包含全部 9 个值
  - [ ] EventConfig 包含 9 个布尔字段
  - [ ] EventPayload 包含原有字段 + 9 个新增可选字段
  - [ ] NotificationConfig 包含 timezone

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All type definitions compile without errors
    Tool: Bash (npm run typecheck)
    Steps:
      1. Run npm run typecheck
      2. Verify exit code 0
    Expected Result: No TypeScript errors
    Failure Indicators: Type errors about missing fields in Record/switch
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(types): expand to 10 event types with full payload fields and timezone config`
  - Files: `src/types.ts`
  - Pre-commit: `npm run typecheck`

- [x] 2. Duration 0ms Bug 修复

  **What to do**:
  - 修改 `src/index.ts:37`: `sessionInfo.time.updated - sessionInfo.time.created` -> `Date.now() - sessionInfo.time.created`
  - 更新相关测试预期值

  **Must NOT do**:
  - 不修改 formatDuration() 函数
  - 不改变显示格式
  - 不修改 sessionMap 存储逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 1 with Task 1)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:
  - `src/index.ts:31-38` -- 修复目标位置
  - `src/index.ts:58-64` -- formatDuration() (不修改)

  **Acceptance Criteria**:
  - [ ] `bun test tests/index.test.ts` 通过
  - [ ] duration 使用 Date.now() 计算

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Duration shows non-zero elapsed time
    Tool: Bun test
    Steps:
      1. Run bun test tests/index.test.ts
      2. Locate idle duration test
      3. Confirm value matches \d+[ms|m|s] pattern and is non-zero
    Expected Result: Test passes with realistic duration
    Evidence: .sisyphus/evidence/task-2-duration.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `fix: resolve Duration always showing 0ms by using real elapsed time`
  - Files: `src/index.ts`, `tests/index.test.ts`

- [x] 3. 时区配置支持 -- formatTimestamp() 函数

  **What to do**:
  - 在 `src/index.ts` 新增 `formatTimestamp(isoString: string, timezone?: string): string`
  - 使用 `Intl.DateTimeFormat`（零依赖）
  - 未配置 timezone -> 返回原始 ISO 字符串（向后兼容）
  - 已配置 -> 返回本地格式化时间（如 `"2026/04/04 21:49:53"`）
  - 无效时区 -> try-catch 降级到原始字符串
  - 修改 `eventToPayload()` 中 basePayload.timestamp 的生成方式
  - 将 config.timezone 传入（闭包变量可用）

  **Must NOT do**:
  - 不引入外部日期库
  - 不修改 template.ts
  - 不改变未配置时的输出

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:
  - `src/index.ts:18-19` -- timestamp 当前生成位置
  - `src/index.ts:58-64` -- formatDuration() 模式参考
  - `src/index.ts:82-131` -- 闭包结构（config 可访问）

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` 通过
  - [ ] 无参数时返回原始 ISO 字符串
  - [ ] `"Asia/Shanghai"` 时 UTC+8 正确转换
  - [ ] 无效时区不崩溃

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Shanghai timezone conversion
    Tool: Bash (node)
    Steps:
      1. node -e "const m=require('./dist/index.js'); console.log(m.formatTimestamp('2026-01-15T06:30:00Z','Asia/Shanghai'))"
      2. Assert output contains '14' (hour) or '30' (minute per UTC+8)
    Expected Result: Local Shanghai time shown
    Evidence: .sisyphus/evidence/task-3-timezone.txt

  Scenario: No timezone = backward compatible
    Tool: Bash (node)
    Steps:
      1. node -e "const m=require('./dist/index.js'); console.log(m.formatTimestamp('2026-01-15T06:30:00Z'))"
      2. Assert equals input exactly
    Expected Result: Identical to current behavior
    Evidence: .sisyphus/evidence/task-3-compat.txt

  Scenario: Invalid timezone fallback
    Tool: Bash (node)
    Steps:
      1. node -e "const m=require('./dist/index.js'); console.log(m.formatTimestamp('2026-01-15T06:30:00Z','Fake/Zone'))"
      2. Assert no crash, returns valid string
    Expected Result: Graceful fallback
    Evidence: .sisyphus/evidence/task-3-fallback.txt
  ```

  **Commit**: YES
  - Message: `feat: add timezone configuration for localized timestamps`
  - Files: `src/index.ts`, `tests/index.test.ts`

- [x] 4. 全事件支持 -- 7 个新 switch case + handler 模板集成

  **What to do**:

  **4a. index.ts -- eventToPayload() 扩展 switch**

  在现有 3 个 case 之后、default 之前，新增 7 个 case：

  ```typescript
  // question.asked -- AI 向用户提问（主要目标）
  // 注意：v1 SDK 的 Event 联合类型可能不包含此事件，
  // 但运行时仍可能收到。做防御性处理。
  case 'question.asked': {
    const props = event.properties as Record<string, unknown>;
    const questions = props.questions as Array<Record<string, unknown>> | undefined;
    const firstQ = questions?.[0];
    return {
      ...basePayload,
      eventType: 'question' as EventType,
      sessionId: (props.sessionID as string) || '',
      title: firstQ?.header ? String(firstQ.header) : undefined,
      questionText: firstQ?.question ? String(firstQ.question) : undefined,
      options: firstQ?.options ? JSON.stringify(firstQ.options) : undefined,
    };
  }

  // permission.updated -- 权限确认请求
  case 'permission.updated': {
    const perm = event.properties as { sessionID?: string; title?: string; type?: string };
    return {
      ...basePayload,
      eventType: 'permission' as EventType,
      sessionId: perm.sessionID || '',
      title: perm.title,
      permissionType: perm.type,
    };
  }

  // session.status -- 会话状态变化
  case 'session.status': {
    const statusEvent = event.properties as { sessionID?: string; status?: { type?: string } };
    return {
      ...basePayload,
      eventType: 'status' as EventType,
      sessionId: statusEvent.sessionID || '',
      statusType: statusEvent.status?.type,
    };
  }

  // command.executed -- shell 命令执行完毕
  case 'command.executed': {
    const cmd = event.properties as { name?: string; arguments?: string; sessionID?: string };
    return {
      ...basePayload,
      eventType: 'command' as EventType,
      sessionId: cmd.sessionID || '',
      commandName: cmd.name,
      arguments: cmd.arguments,
    };
  }

  // file.edited -- 文件被编辑
  case 'file.edited': {
    const fileEvt = event.properties as { file?: string };
    return {
      ...basePayload,
      eventType: 'fileEdited' as EventType,
      filePath: fileEvt.file,
    };
  }

  // todo.updated -- Todo 列表更新
  case 'todo.updated': {
    const todoEvt = event.properties as { todos?: Array<{ content: string; status: string }> | undefined; sessionID?: string };
    const summary = todoEvt.todos
      ?.map(t => `[${t.status}] ${t.content}`).join('\n');
    return {
      ...basePayload,
      eventType: 'todo' as EventType,
      sessionId: todoEvt.sessionID || '',
      todoSummary: summary,
    };
  }
  ```

  **4b. handler.ts -- defaultTemplates 扩展**

  在现有 3 个模板后追加 6 个：

  ```typescript
  question: {
    subject: '[OpenCode] Question - {{projectName}}',
    body: 'OpenCode has a question at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nQuestion: {{title}}\n{{questionText}}',
  },
  permission: {
    subject: '[OpenCode] Permission Required - {{projectName}}',
    body: 'Permission needed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\n{{title}} ({{permissionType}})',
  },
  status: {
    subject: '[OpenCode] Status Change - {{projectName}}',
    body: 'Session status changed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nStatus: {{statusType}}',
  },
  command: {
    subject: '[OpenCode] Command Executed - {{projectName}}',
    body: 'Command executed at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\nCommand: {{commandName}} {{arguments}}',
  },
  fileEdited: {
    subject: '[OpenCode] File Edited - {{projectName}}',
    body: 'File edited at {{timestamp}}\nProject: {{projectName}}\nFile: {{filePath}}',
  },
  todo: {
    subject: '[OpenCode] Todos Updated - {{projectName}}',
    body: 'Todos updated at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}\n{{todoSummary}}',
  },
  ```

  **4c. handler.ts -- variables 对象扩展**

  在 handle() 的 variables 中追加所有新字段：

  ```typescript
  const variables = {
    // 现有字段 (不变)
    eventType: payload.eventType,
    timestamp: payload.timestamp,
    projectName: payload.projectName,
    sessionId: payload.sessionId,
    message: payload.message,
    error: payload.error,
    duration: payload.duration,
    // 新增字段
    title: payload.title,
    questionText: payload.questionText,
    options: payload.options,
    permissionType: payload.permissionType,
    statusType: payload.statusType,
    commandName: payload.commandName,
    arguments: payload.arguments,
    filePath: payload.filePath,
    todoSummary: payload.todoSummary,
  };
  ```

  **Must NOT do**:
  - 不处理 replied/rejected 事件
  - 不添加 rate limiting
  - 不修改 email.ts / config.ts / template.ts
  - 不假设任何字段非空（全部用 optional chaining）
  - **注意**: question 和 permission 默认开启（EventConfig 中 question/permission 默认 true 或不设时视为开启）；其余 4 个扩展事件默认关闭

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 7 个事件类型的完整实现，涉及 index.ts 和 handler.ts 两个文件的大量改动
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Wave 2, with Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (types), Task 3 (timezone 可并行但建议在之后)

  **References**:

  **Pattern References**:
  - `src/index.ts:24-52` -- switch 结构（插入位置在 error 之后、default 之前）
  - `src/handler.ts:18-31` -- defaultTemplates Record
  - `src/handler.ts:79-87` -- variables 对象
  - `src/handler.ts:69-73` -- events[eventType] 启用检查

  **API/Type References**:
  - SDK types.gen.d.ts 各事件 properties 定义（见 Task 1 references）

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` 通过
  - [ ] `bun test` 通过
  - [ ] 7 种新事件均可独立配置开关
  - [ ] 默认均关闭（不配置时不发送）
  - [ ] question.asked 防御性处理（运行时 type 检查，不依赖编译时类型）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Question event from question.asked triggers notification
    Tool: Bun test
    Preconditions: Config has events.question: true
    Steps:
      1. Construct mock event { type: "question.asked", properties: { sessionID: "s1", questions: [{ question: "Which framework?", header: "Framework Choice", options: [{label:"React"},{label:"Vue"}] }] } }
      2. Call eventToPayload -> assert eventType='question', title='Framework Choice'
      3. Call handle -> assert email sent with "Question" in subject
    Expected Result: Email sent with correct question content
    Evidence: .sisyphus/evidence/task-4-question.txt

  Scenario: Permission event triggers notification
    Tool: Bun test
    Preconditions: Config has events.permission: true
    Steps:
      1. Construct mock event { type: "permission.updated", properties: { sessionID: "s1", title: "Bash: npm install", type: "bash" } }
      2. Call eventToPayload -> assert eventType='permission', title='Bash: npm install'
      3. Call handle -> assert email sent
    Expected Result: Permission notification sent
    Evidence: .sisyphus/evidence/task-4-permission.txt

  Scenario: Extended events (status/command/fileEdited/todo) disabled by default
    Tool: Bun test
    Preconditions: Config does NOT set events.status/command/fileEdited/todo (question and permission may or may not be set)
    Steps:
      1. For each of status/command/fileEdited/todo: construct mock event + call pipeline
      2. Assert no email sent for any of them
    Expected Result: All extended events silently ignored when not configured (question/permission still work if configured or by default)
    Evidence: .sisyphus/evidence/task-4-defaults-off.txt

  Scenario: Command event with explicit enable
    Tool: Bun test
    Preconditions: Config has events.command: true
    Steps:
      1. Construct mock event { type: "command.executed", properties: { name: "npm", arguments: "install", sessionID: "s1" } }
      2. Call full pipeline
      3. Assert email contains "npm" and "install"
    Expected Result: Command notification sent when enabled
    Evidence: .sisyphus/evidence/task-4-command.txt

  Scenario: File edited event
    Tool: Bun test
    Preconditions: Config has events.fileEdited: true
    Steps:
      1. Construct mock event { type: "file.edited", properties: { file: "src/index.ts" } }
      2. Call full pipeline
      3. Assert email contains "src/index.ts"
    Expected Result: File edit notification sent
    Evidence: .sisyphus/evidence/task-4-file.txt

  Scenario: Todo updated event
    Tool: Bun test
    Preconditions: Config has events.todo: true
    Steps:
      1. Construct mock event with todos array containing items
      2. Call full pipeline
      3. Assert email contains todo summary with [status] markers
    Expected Result: Todo notification sent with summary
    Evidence: .sisyphus/evidence/task-4-todo.txt

  Scenario: Status change event
    Tool: Bun test
    Preconditions: Config has events.status: true
    Steps:
      1. Construct mock event { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }
      2. Call full pipeline
      3. Assert email contains "busy"
    Expected Result: Status notification sent
    Evidence: .sisyphus/evidence/task-4-status.txt
  ```

  **Commit**: YES
  - Message: `feat: support 7 new events (question/permission/status/command/fileEdited/todo)`
  - Files: `src/index.ts`, `src/handler.ts`, `tests/index.test.ts`, `tests/handler.test.ts`
  - Pre-commit: `bun test`

- [x] 5. 测试全覆盖与集成验证

  **What to do**:
  - 更新 `tests/index.test.ts`: 补充全部 7 种新事件的 eventToPayload 测试、timezone 测试、duration 测试
  - 更新 `tests/handler.test.ts`: 补充 6 套新模板的渲染测试和变量替换测试
  - 更新 `tests/utils/sample-configs.ts`: 添加包含新事件的示例配置
  - 运行完整回归: `bun test` + `npm run typecheck` + `npm run build`

  **Must NOT do**:
  - 不跳过任何现有测试
  - 不降低覆盖率

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 3)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1-4

  **Acceptance Criteria**:
  - [ ] `bun test` 全部通过 (0 failures)
  - [ ] `npm run typecheck` 无错误
  - [ ] `npm run build` 成功
  - [ ] 每种新事件 >= 1 个正向测试 + 默认关闭验证

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full suite passes
    Tool: Bash (bun test)
    Steps:
      1. bun test
      2. Assert 0 failures
    Evidence: .sisyphus/evidence/task-5-suite.txt

  Scenario: Cross-feature integration (timezone + all events)
    Tool: Bun test
    Steps:
      1. Config with timezone + all events enabled
      2. Fire each event type
      3. Verify all emails have local timestamps
    Evidence: .sisyphus/evidence/task-5-integration.txt
  ```

  **Commit**: YES (if needed)
  - Message: `test: comprehensive coverage for all new events`
  - Files: `tests/*.test.ts`

---


## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [x] F1. **Plan Compliance Audit** -- `oracle`
  For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review for `as any`, empty catches, console.log in prod, AI slop.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Full Test Suite Execution** -- `unspecified-high`
  Run `bun test`. Execute EVERY QA scenario. Cross-feature integration. Edge cases.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read spec vs actual diff. Verify 1:1. Check "Must NOT do". Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `feat(types): expand to 10 event types with full payload fields and timezone config` -- src/types.ts
- **2**: `fix: resolve Duration always showing 0ms by using real elapsed time` -- src/index.ts, tests/index.test.ts
- **3**: `feat: add timezone configuration for localized timestamps` -- src/index.ts, tests/index.test.ts
- **4**: `feat: support 7 new events (question/permission/status/command/fileEdited/todo)` -- src/index.ts, src/handler.ts, tests/
- **5**: `test: comprehensive coverage for all new events` -- tests/*.test.ts

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck    # Expected: success (no output)
npm run build        # Expected: success (no output)
bun test             # Expected: All tests passed (0 failures)
```

### Final Checklist
- [ ] All "Must Have" present (10 event types, timezone, duration fix)
- [ ] All "Must NOT Have" absent (no replied events, no rate limiting, no new files)
- [ ] All tests pass (existing + new)
- [ ] question.asked 和 permission.updated 均可触发通知
- [ ] 扩展事件默认关闭，显式开启后才发送
- [ ] Duration 显示正确非零值
- [ ] Timezone 配置后显示本地时间
