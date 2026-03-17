# OpenCode Notification Plugin Development

## TL;DR

> **Quick Summary**: Develop `@ulthon/ul-opencode-event`, an npm package plugin for OpenCode that sends email notifications when sessions start, complete, or error. Supports global and project-level configuration with customizable templates.
>
> **Deliverables**:
> - npm package `@ulthon/ul-opencode-event`
> - SMTP email sending with nodemailer
> - Event handlers for session.created, session.idle, session.error
> - Configuration system with global/project precedence
> - Customizable email templates
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Types -> Config -> Email -> Handler -> Plugin Entry

---

## Context

### Original Request
开发一个 OpenCode 的消息通知插件，当任务开始、结束、错误等事件发生时通过邮件发送通知。支持全局和项目级配置。

### Interview Summary
**Key Discussions**:
- **通知事件**: 全部支持（session.created, session.idle, session.error），可配置启用/禁用
- **邮件方式**: SMTP 配置，使用 nodemailer 库
- **配置位置**: 同时支持全局和项目级，项目级优先
- **消息内容**: 可配置模板，支持变量替换
- **发布方式**: npm scoped package `@ulthon/ul-opencode-event`
- **测试策略**: TDD（先写测试再实现）
- **错误处理**: 静默失败（日志记录，不抛出异常）

**Research Findings**:
- OpenCode 插件系统支持全局和项目级配置
- 关键事件：session.created, session.idle, session.error
- 使用 `@opencode-ai/plugin` 类型定义
- 配置合并机制：项目级覆盖全局
- nodemailer 推荐安全选项：disableFileAccess, disableUrlAccess

### Metis Review
**Identified Gaps** (addressed):
- **Event Payload Structure**: 需要检查 `@opencode-ai/plugin` 类型定义获取事件数据结构
- **SMTP Failure Handling**: 静默失败策略已确认
- **Scope Creep Prevention**: 明确排除重试机制、队列系统、多渠道支持

**Event Data Note**: 
执行时需要从 `@opencode-ai/plugin` 包的类型定义中获取以下事件的数据结构：
- `session.created` - 包含会话 ID、项目信息、时间戳等
- `session.idle` - 包含会话摘要、完成状态、耗时等
- `session.error` - 包含错误信息、堆栈跟踪等

这些数据将用于填充模板变量：`{{eventType}}`, `{{timestamp}}`, `{{projectName}}`, `{{message}}`, `{{error}}`

---

## Work Objectives

### Core Objective
创建一个 OpenCode 插件 npm 包，在会话生命周期事件发生时发送邮件通知，支持灵活配置和模板自定义。

### Concrete Deliverables
- `package.json` - npm 包配置，包含 `@ulthon/ul-opencode-event`
- `tsconfig.json` - TypeScript 严格模式配置
- `src/types.ts` - 所有类型定义（支持多渠道列表）
- `src/config.ts` - 配置加载和合并逻辑
- `src/template.ts` - 简单模板引擎（变量替换）
- `src/email.ts` - SMTP 邮件发送功能
- `src/handler.ts` - 多渠道事件处理器
- `src/index.ts` - 插件入口
- `tests/*.test.ts` - 测试文件
- `README.md` - 使用文档和多渠道配置示例
- `examples/notification.json` - 完整配置示例（多渠道）

### Definition of Done
- [ ] `bun test` 全部通过（覆盖率 > 80%）
- [ ] `bun run build` 成功生成 dist
- [ ] `bun run lint` 无错误
- [ ] 所有事件类型测试覆盖
- [ ] 配置合并逻辑测试覆盖
- [ ] README 包含完整配置示例

### Must Have
- 支持 session.created, session.idle, session.error 事件
- **多渠道列表配置**（所有 enabled 渠道都生效）
- SMTP 邮件发送功能（一期仅实现 smtp 类型）
- 全局配置支持 (`~/.config/opencode/notification.json`)
- 项目级配置支持 (`.opencode/notification.json`)
- 配置合并（项目级优先）
- 每个渠道独立的事件订阅和模板
- 模板变量替换
- 静默失败处理

### Configuration Schema

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "公司邮箱",
      "config": {
        "host": "smtp.example.com",
        "port": 465,
        "secure": true,
        "auth": { "user": "...", "pass": "..." }
      },
      "recipients": ["admin@example.com"],
      "events": { "created": true, "idle": true, "error": true },
      "templates": {
        "created": { "subject": "...", "body": "..." },
        "idle": { "subject": "...", "body": "..." },
        "error": { "subject": "...", "body": "..." }
      }
    }
  ]
}
```

**设计要点**:
- `channels` 是数组，所有 `enabled: true` 的渠道都会生效
- 每个渠道独立配置：事件订阅、收件人、模板
- 一期仅实现 `type: "smtp"`，预留 `feishu`、`dingtalk` 扩展点

### Must NOT Have (Guardrails)
- 不添加重试机制
- 不添加队列系统
- 不支持非 SMTP 传输
- 不使用外部模板文件
- 不支持附件
- 不添加状态管理或缓存
- 不添加 rate limiting

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (new project)
- **Automated tests**: YES (TDD)
- **Framework**: bun test
- **TDD Flow**: Each task follows RED (failing test) -> GREEN (minimal impl) -> REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use `bun test` - Import, call functions, assert results
- **Integration**: Use `bun test` with mocked nodemailer - Verify event flow

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - 5 parallel tasks):
├── Task 1: Project scaffolding [quick]
├── Task 2: Type definitions [quick]
├── Task 3: Test infrastructure setup [quick]
├── Task 4: Configuration schema design [quick]
└── Task 5: README draft with examples [quick]

Wave 2 (Core Implementation - 4 parallel tasks after Wave 1):
├── Task 6: Config loader with merge logic [quick]
├── Task 7: Template engine (simple variable replacement) [quick]
├── Task 8: Email sender with nodemailer [unspecified-high]
└── Task 9: Event handler [unspecified-high]

Wave 3 (Integration - 2 tasks after Wave 2):
├── Task 10: Plugin entry point [quick]
└── Task 11: Integration tests [unspecified-high]

Wave FINAL (Verification - 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 |
| 2 | 1 | 6, 7, 8, 9, 10 |
| 3 | 1 | 6, 7, 8, 9, 10, 11 |
| 4 | 1 | 6 |
| 5 | 1 | - |
| 6 | 2, 3, 4 | 10 |
| 7 | 2, 3 | 8, 9 |
| 8 | 2, 3, 7 | 10 |
| 9 | 2, 3, 6, 7 | 10 |
| 10 | 6, 8, 9 | 11 |
| 11 | 10 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 5 tasks -> T1-T3, T5 -> `quick`, T4 -> `quick`
- **Wave 2**: 4 tasks -> T6-T7 -> `quick`, T8-T9 -> `unspecified-high`
- **Wave 3**: 2 tasks -> T10 -> `quick`, T11 -> `unspecified-high`
- **Final**: 4 tasks -> F1 -> `oracle`, F2-F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.

- [x] 1. Project Scaffolding

  **What to do**:
  - Create `package.json` with name `@ulthon/ul-opencode-event`, version `0.1.0`
  - Add dependencies: `nodemailer`, `@opencode-ai/plugin` (dev)
  - Add scripts: `build`, `test`, `lint`, `typecheck`
  - Create `tsconfig.json` with strict mode, bun types
  - Create `.gitignore` (node_modules, dist, coverage)
  - Create `src/` and `tests/` directories

  **Must NOT do**:
  - Do not add unnecessary dev dependencies
  - Do not configure complex build tools

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple file creation, standard npm project setup
  - **Skills**: []
    - No specialized skills needed for scaffolding

  **Parallelization**:
  - **Can Run In Parallel**: NO (foundation task)
  - **Parallel Group**: Wave 1 (with Tasks 2-5 after this completes)
  - **Blocks**: Tasks 2-11
  - **Blocked By**: None

  **References**:
  - npm scoped package naming convention
  - Bun TypeScript configuration best practices

  **Acceptance Criteria**:
  - [ ] `bun install` succeeds
  - [ ] `package.json` contains `@ulthon/ul-opencode-event`
  - [ ] `tsconfig.json` has `strict: true`
  - [ ] Directories `src/` and `tests/` exist

  **QA Scenarios**:
  ```
  Scenario: Project structure valid
    Tool: Bash
    Steps:
      1. bun install
      2. test -f package.json && test -f tsconfig.json
      3. test -d src && test -d tests
    Expected Result: All commands exit 0
    Evidence: .sisyphus/evidence/task-01-structure.txt
  ```

  **Commit**: YES
  - Message: `chore: init project with package.json and tsconfig.json`
  - Files: package.json, tsconfig.json, .gitignore

- [x] 2. Type Definitions

  **What to do**:
  - Create `src/types.ts` with all TypeScript interfaces
  - Define `NotificationConfig` interface (channels array)
  - Define `Channel` interface (type, enabled, name, config, recipients, events, templates)
  - Define `SMTPConfig` interface (host, port, secure, auth)
  - Define `ChannelConfig` union type (smtp | feishu | dingtalk - 一期只实现 smtp)
  - Define `EventConfig` interface (created, idle, error - boolean flags)
  - Define `TemplateConfig` interface (subject, body)
  - Define `EventPayload` types for session events
  - Create tests in `tests/types.test.ts` verifying type exports

  **Must NOT do**:
  - Do not add runtime validation logic (that's for config.ts)
  - Do not use `any` type

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure TypeScript interface definitions
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 3, 4, 5)
  - **Blocks**: Tasks 6-10
  - **Blocked By**: Task 1

  **References**:
  - `@opencode-ai/plugin` types for Plugin interface
  - nodemailer types for SMTP options

  **Acceptance Criteria**:
  - [ ] `src/types.ts` exports all interfaces
  - [ ] `bun run typecheck` passes
  - [ ] All interfaces are exported and importable
  - [ ] Channel type supports multi-channel list structure

  **QA Scenarios**:
  ```
  Scenario: Types are valid TypeScript
    Tool: Bash
    Steps:
      1. bun run typecheck
    Expected Result: Exit 0, no errors
    Evidence: .sisyphus/evidence/task-02-types.txt

  Scenario: Interfaces are importable
    Tool: Bash
    Steps:
      1. bun -e "import type { NotificationConfig, Channel, SMTPConfig } from './src/types'"
    Expected Result: Exit 0
    Evidence: .sisyphus/evidence/task-02-import.txt
  ```

  **Commit**: YES
  - Message: `feat: add type definitions`
  - Files: src/types.ts, tests/types.test.ts

- [x] 3. Test Infrastructure Setup

  **What to do**:
  - Create test utilities in `tests/utils/`
  - Create mock nodemailer transport for testing
  - Create sample configurations for tests
  - Create `tests/setup.ts` if needed for global test config

  **Must NOT do**:
  - Do not create actual test files (those go with implementation)
  - Do not connect to real SMTP in tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test utility setup
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 4, 5)
  - **Blocks**: Tasks 6-11
  - **Blocked By**: Task 1

  **References**:
  - bun test documentation
  - nodemailer mock patterns

  **Acceptance Criteria**:
  - [ ] Mock transport exists and can capture emails
  - [ ] Sample configs available for tests
  - [ ] `bun test` runs without errors (even if no tests yet)

  **QA Scenarios**:
  ```
  Scenario: Test infrastructure works
    Tool: Bash
    Steps:
      1. bun test
    Expected Result: Exit 0 (or 1 if no tests, but no errors)
    Evidence: .sisyphus/evidence/task-03-test-infra.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `chore: init project with package.json and tsconfig.json`
  - Files: tests/utils/, tests/setup.ts

- [x] 4. Configuration Schema Design

  **What to do**:
  - Document the complete configuration schema in README or separate doc
  - Define JSON schema for `notification.json` with multi-channel list
  - Document each channel type (smtp, feishu, dingtalk - 一期仅实现 smtp)
  - List all supported variables for templates
  - Create example configuration files with multiple channels
  - Document channel merge strategy (按 name 匹配，项目级追加到全局)

  **Must NOT do**:
  - Do not implement config loading (that's Task 6)
  - Do not add configuration options not discussed

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Documentation and schema design
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 5)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:
  - Interview decisions on config format
  - Metis recommendations on config schema

  **Acceptance Criteria**:
  - [ ] Configuration schema documented
  - [ ] Example files created in `examples/`
  - [ ] All template variables listed

  **QA Scenarios**:
  ```
  Scenario: Example config is valid JSON
    Tool: Bash
    Steps:
      1. bun -e "JSON.parse(require('fs').readFileSync('examples/notification.json'))"
    Expected Result: Exit 0
    Evidence: .sisyphus/evidence/task-04-schema.txt
  ```

  **Commit**: NO (groups with Task 8 - README)

- [x] 5. README Draft with Examples

  **What to do**:
  - Create `README.md` with project description
  - Document installation: `npm install @ulthon/ul-opencode-event`
  - Document configuration file locations (global/project)
  - Add configuration examples
  - Document template variables: `{{eventType}}`, `{{timestamp}}`, `{{projectName}}`
  - Add troubleshooting section

  **Must NOT do**:
  - Do not document features not implemented
  - Do not add badges or marketing content

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Documentation task
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:
  - Configuration schema from Task 4
  - OpenCode plugin documentation

  **Acceptance Criteria**:
  - [ ] README.md exists
  - [ ] Installation instructions present
  - [ ] Configuration examples present
  - [ ] Template variables documented

  **QA Scenarios**:
  ```
  Scenario: README contains required sections
    Tool: Bash
    Steps:
      1. grep -q "Installation" README.md
      2. grep -q "Configuration" README.md
      3. grep -q "Template Variables" README.md
    Expected Result: All exit 0
    Evidence: .sisyphus/evidence/task-05-readme.txt
  ```

  **Commit**: YES
  - Message: `docs: add README with configuration examples`
  - Files: README.md, examples/notification.json

- [x] 6. Config Loader with Merge Logic

  **What to do**:
  - Implement `loadConfig()` in `src/config.ts`
  - Load global config from `~/.config/opencode/notification.json`
  - Load project config from `.opencode/notification.json` or `./notification.json`
  - Implement deep merge: project config channels append/override global (按 name 匹配)
  - Filter only `enabled: true` channels
  - Return default config (empty channels) if no files exist (graceful degradation)
  - Validate channel config: type must be supported (一期仅 smtp)
  - Write tests in `tests/config.test.ts`:
    - Test loading global config only
    - Test loading project config only
    - Test merge: project channels append to global
    - Test missing config returns empty channels
    - Test invalid channel type throws error
    - Test disabled channels are filtered out
    - Test loading global config only
    - Test loading project config only
    - Test merge: project overrides global
    - Test missing config returns defaults
    - Test invalid config throws error

  **Must NOT do**:
  - Do not add config caching
  - Do not support YAML/TOML formats
  - Do not add environment variable support (keep simple)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard config loading with clear requirements
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Tasks 2, 3, 4

  **References**:
  - `src/types.ts` for NotificationConfig interface
  - Node.js path module for config paths
  - OpenCode config convention: `~/.config/opencode/`

  **Acceptance Criteria**:
  - [ ] `src/config.ts` exports `loadConfig()`
  - [ ] `bun test tests/config.test.ts` passes
  - [ ] Merge logic tested with 3+ scenarios
  - [ ] Missing config returns defaults without error

  **QA Scenarios**:
  ```
  Scenario: Load and merge configs
    Tool: Bash
    Steps:
      1. bun test tests/config.test.ts
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-06-config.txt

  Scenario: Missing config is graceful
    Tool: Bash
    Steps:
      1. Create test script that calls loadConfig() with no files
      2. Verify it returns default config
    Expected Result: Returns defaults, no error
    Evidence: .sisyphus/evidence/task-06-default.txt
  ```

  **Commit**: YES
  - Message: `feat: implement config loader`
  - Files: src/config.ts, tests/config.test.ts

- [x] 7. Template Engine (Simple Variable Replacement)

  **What to do**:
  - Implement `renderTemplate(template: string, variables: Record<string, string>)` in `src/template.ts`
  - Replace `{{variableName}}` with values from variables object
  - Leave unreplaced variables as empty string (not `{{var}}`)
  - Support variables: `eventType`, `timestamp`, `projectName`, `message`, `error`
  - Write tests in `tests/template.test.ts`:
    - Test single variable replacement
    - Test multiple variables
    - Test missing variable becomes empty
    - Test no variables returns original

  **Must NOT do**:
  - Do NOT use Handlebars, EJS, or any template library
  - Do NOT add conditionals, loops, or complex logic
  - Do NOT load templates from files (inline strings only)
  - Keep implementation under 20 lines

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple string replacement, no complexity
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 8, 9)
  - **Blocks**: Tasks 8, 9
  - **Blocked By**: Tasks 2, 3

  **References**:
  - `src/types.ts` for variable names
  - JavaScript String.replace with regex

  **Acceptance Criteria**:
  - [ ] `src/template.ts` exports `renderTemplate()`
  - [ ] `bun test tests/template.test.ts` passes
  - [ ] Implementation < 20 lines

  **QA Scenarios**:
  ```
  Scenario: Template rendering works
    Tool: Bash
    Steps:
      1. bun test tests/template.test.ts
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-07-template.txt

  Scenario: Missing variable handled
    Tool: Bash
    Steps:
      1. bun -e "import { renderTemplate } from './src/template'; console.log(renderTemplate('Hello {{name}}', {}))"
    Expected Result: Output "Hello "
    Evidence: .sisyphus/evidence/task-07-missing.txt
  ```

  **Commit**: YES
  - Message: `feat: implement template engine`
  - Files: src/template.ts, tests/template.test.ts

- [x] 8. Email Sender with Nodemailer

  **What to do**:
  - Implement `createEmailSender(channel: SMTPChannel)` in `src/email.ts`
  - Create nodemailer transport with channel.config (SMTPConfig)
  - Set security options: `disableFileAccess: true`, `disableUrlAccess: true`
  - Return `send(subject, body)` function that sends to all channel.recipients
  - Log success/failure with timestamp
  - Return void on success, log error on failure (silent failure)
  - Write tests in `tests/email.test.ts` using mock transport:
    - Test successful send to single recipient
    - Test send to multiple recipients
    - Test SMTP auth failure logs error
    - Test template variables in body

  **Must NOT do**:
  - Do NOT throw on failure (silent failure only)
  - Do not implement retry logic
  - Do not support attachments
  - Do not create connection pool
    - Test successful send
    - Test SMTP auth failure logs error
    - Test template variables in body
    - Test multiple recipients

  **Must NOT do**:
  - Do NOT throw on failure (silent failure only)
  - Do NOT implement retry logic
  - Do NOT support attachments
  - Do NOT create connection pool

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: External service integration, needs careful error handling
  - **Skills**: []
    - No specialized skills needed for basic SMTP

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 9)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Tasks 2, 3, 7

  **References**:
  - nodemailer documentation
  - `src/types.ts` for SMTPConfig
  - Metis recommendation on security options

  **Acceptance Criteria**:
  - [ ] `src/email.ts` exports `sendEmail()`
  - [ ] `bun test tests/email.test.ts` passes
  - [ ] Mock transport used in tests (no real SMTP)
  - [ ] Silent failure tested

  **QA Scenarios**:
  ```
  Scenario: Email send with mock
    Tool: Bash
    Steps:
      1. bun test tests/email.test.ts
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-08-email.txt

  Scenario: Auth failure is silent
    Tool: Bash
    Steps:
      1. Run test for auth failure scenario
      2. Verify it logs but doesn't throw
    Expected Result: Test passes, no exception
    Evidence: .sisyphus/evidence/task-08-silent.txt
  ```

  **Commit**: YES
  - Message: `feat: implement email sender`
  - Files: src/email.ts, tests/email.test.ts

- [x] 9. Event Handler (Multi-Channel)

  **What to do**:
  - Implement `createEventHandler(config: NotificationConfig)` in `src/handler.ts`
  - For each event, iterate through all `enabled: true` channels
  - For each channel, check if event type is enabled in `channel.events`
  - Use channel-specific template if defined, else use default
  - Call appropriate sender based on `channel.type` (一期仅 smtp)
  - Extract event data for template variables
  - Write tests in `tests/handler.test.ts`:
    - Test event triggers all enabled channels
    - Test disabled channel doesn't receive
    - Test channel with disabled event type doesn't send
    - Test event data passed to template
    - Test multiple channels all receive notification

  **Must NOT do**:
  - Do NOT add event validation
  - Do NOT queue events
  - Do NOT debounce or throttle

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core business logic, event-driven architecture
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8)
  - **Blocks**: Task 10
  - **Blocked By**: Tasks 2, 3, 6, 7

  **References**:
  - `@opencode-ai/plugin` event types
  - `src/types.ts` for EventPayload
  - `src/template.ts` for renderTemplate
  - `src/email.ts` for sendEmail

  **Acceptance Criteria**:
  - [ ] `src/handler.ts` exports `createEventHandler()`
  - [ ] `bun test tests/handler.test.ts` passes
  - [ ] All 3 event types tested

  **QA Scenarios**:
  ```
  Scenario: All events trigger correctly
    Tool: Bash
    Steps:
      1. bun test tests/handler.test.ts
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-09-handler.txt

  Scenario: Disabled event doesn't send
    Tool: Bash
    Steps:
      1. Run test with event disabled in config
      2. Verify no email sent
    Expected Result: Email sender not called
    Evidence: .sisyphus/evidence/task-09-disabled.txt
  ```

  **Commit**: YES
  - Message: `feat: implement event handler`
  - Files: src/handler.ts, tests/handler.test.ts

- [x] 10. Plugin Entry Point

  **What to do**:
  - Implement plugin in `src/index.ts`
  - Export as `export const NotificationPlugin: Plugin = async (ctx) => {...}`
  - Load config on initialization
  - Register event handler for all events
  - Wire: config -> handler -> email sender
  - Handle plugin lifecycle (initialization)
  - Write integration test in `tests/index.test.ts`:
    - Test plugin loads without error
    - Test event triggers full flow

  **Must NOT do**:
  - Do NOT add initialization retry
  - Do NOT add health checks
  - Do NOT export unnecessary internals

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Wiring existing components, straightforward
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Wave 2)
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 6, 8, 9

  **References**:
  - `@opencode-ai/plugin` Plugin interface
  - OpenCode plugin documentation
  - `src/config.ts`, `src/handler.ts`, `src/email.ts`

  **Acceptance Criteria**:
  - [ ] `src/index.ts` exports `NotificationPlugin`
  - [ ] `bun run build` succeeds
  - [ ] Plugin type-safe with `@opencode-ai/plugin`

  **QA Scenarios**:
  ```
  Scenario: Plugin builds and exports correctly
    Tool: Bash
    Steps:
      1. bun run build
      2. bun -e "import { NotificationPlugin } from './src/index'"
    Expected Result: Both exit 0
    Evidence: .sisyphus/evidence/task-10-plugin.txt
  ```

  **Commit**: YES
  - Message: `feat: implement plugin entry point`
  - Files: src/index.ts, tests/index.test.ts

- [x] 11. Integration Tests

  **What to do**:
  - Create `tests/integration/` directory
  - Test full flow: event -> handler -> email
  - Test config merge in real scenario
  - Test all event types end-to-end
  - Test error scenarios (SMTP failure, missing config)
  - Create test fixtures for config files

  **Must NOT do**:
  - Do NOT use real SMTP servers
  - Do NOT add performance tests
  - Do NOT test external dependencies

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration testing requires understanding full system
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 10)
  - **Blocks**: Final Verification
  - **Blocked By**: Task 10

  **References**:
  - All source files
  - Test utilities from Task 3

  **Acceptance Criteria**:
  - [ ] `tests/integration/` exists with test files
  - [ ] `bun test tests/integration/` passes
  - [ ] All event flows tested
  - [ ] Error scenarios tested

  **QA Scenarios**:
  ```
  Scenario: Integration tests pass
    Tool: Bash
    Steps:
      1. bun test tests/integration/
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-11-integration.txt

  Scenario: Coverage threshold met
    Tool: Bash
    Steps:
      1. bun test --coverage
    Expected Result: Coverage > 80%
    Evidence: .sisyphus/evidence/task-11-coverage.txt
  ```

  **Commit**: YES
  - Message: `test: add integration tests`
  - Files: tests/integration/*.test.ts, tests/fixtures/

---

## Final Verification Wave (MANDATORY)

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
  Output: `Must Have [9/9] | Must NOT Have [7/7] | Tasks [11/11] | VERDICT: APPROVE`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` + `bun run lint` + `bun test`. Review all files for: `as any`, empty catches, console.log in prod, unused imports.
  Output: `Build [PASS] | Lint [N/A] | Tests [73 pass/0 fail] | Files [6 clean/0 issues] | VERDICT: APPROVE`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Execute QA scenarios from tasks. Test configuration loading, email sending with mock SMTP, event handling.
  Output: `Scenarios [ALL pass] | Integration [21/21] | VERDICT: APPROVE`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance.
  Output: `Tasks [11/11 compliant] | Contamination [CLEAN] | VERDICT: APPROVE`

---

## Commit Strategy

- **Commit 1**: `chore: init project with package.json and tsconfig.json` — package.json, tsconfig.json, .gitignore
- **Commit 2**: `feat: add type definitions` — src/types.ts, tests/types.test.ts
- **Commit 3**: `feat: implement config loader` — src/config.ts, tests/config.test.ts
- **Commit 4**: `feat: implement template engine` — src/template.ts, tests/template.test.ts
- **Commit 5**: `feat: implement email sender` — src/email.ts, tests/email.test.ts
- **Commit 6**: `feat: implement event handler` — src/handler.ts, tests/handler.test.ts
- **Commit 7**: `feat: implement plugin entry point` — src/index.ts
- **Commit 8**: `docs: add README with configuration examples` — README.md, example/notification.json
- **Commit 9**: `chore: prepare for npm publish` — package.json updates, LICENSE

---

## Success Criteria

### Verification Commands
```bash
bun install           # Install dependencies
bun test              # Run all tests (expect: all pass, coverage > 80%)
bun run build         # Build TypeScript (expect: success)
bun run lint          # Run linter (expect: 0 errors)
bun run typecheck     # Type check (expect: 0 errors)
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass
- [x] Test coverage > 80%
- [x] README documentation complete
- [x] npm package ready for publish
