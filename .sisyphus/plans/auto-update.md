# Auto-Update Feature for @ulthon/ul-opencode-event

## TL;DR

> **Quick Summary**: 为通知插件添加启动时自动更新功能，参照 oh-my-openagent 模式：npm registry 检查 + bun install 自动安装 + 24h 缓存 + toast 通知。
> 
> **Deliverables**:
> - `src/updater.ts` - 自动更新核心模块
> - `tests/updater.test.ts` - 完整单元测试
> - 修改 `src/index.ts`、`src/types.ts`、`src/config.ts` 集成更新功能
> - 配置支持 `auto_update` 开关
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6

---

## Context

### Original Request
用户希望本插件像 oh-my-openagent 插件一样，支持启动时自动更新。

### Interview Summary
**Key Discussions**:
- 更新方式：完全自动安装（bun install），非仅通知
- 配置开关：在 ul-opencode-event.json 中增加 `auto_update` 字段，默认 true
- 检查频率：带缓存间隔（24h 内不重复网络请求）
- 通知方式：通过 `ctx.client.tui.showToast()` 显示更新状态

**Research Findings**:
- oh-my-openagent 使用 `https://registry.npmjs.org/-/package/{name}/dist-tags` 轻量 API（响应极小）
- 缓存目录：`~/.local/share/opencode/packages/`（通过 `$OPENCODE_DATA_DIR` 或 `os.homedir()` 解析）
- bun install 超时 60s，通过 `Bun.spawn` 或 `child_process.spawn` 执行
- 通过 invalidatePackage（删除 node_modules 中的包 + 清理 bun.lock）强制重新解析
- 版本固定检测：`@ulthon/ul-opencode-event@1.2.3` 格式视为 pinned，仅通知不安装
- 本地开发检测：`file://` 开头的插件路径跳过更新
- Windows 兼容：使用 `child_process.spawn` + `windowsHide: true` + `shell: true`

### Metis Review
**Identified Gaps** (addressed):
- `ctx.client.tui.showToast()` API 兼容性：Metis 建议添加 try-catch 包裹，失败时降级到 logger
- DNS 预解析：npm registry 是 HTTPS 直连，无需 DNS 预解析（与 SMTP 不同）
- 本地开发模式检测：需要在 opencode settings 中检查 `file://` 路径
- 版本固定：需要在 opencode settings 中检查 `@版本号` 格式
- 缓存文件位置：使用 OpenCode 数据目录下的子目录
- bun install 失败降级：回退到仅通知模式，不崩溃

---

## Work Objectives

### Core Objective
为 @ulthon/ul-opencode-event 插件添加启动时自动更新功能，在 session.created 事件触发时异步检查并安装新版本。

### Concrete Deliverables
- `src/updater.ts` - 新模块，包含版本检查、缓存管理、bun install 执行、通知
- `tests/updater.test.ts` - 覆盖所有核心逻辑的单元测试
- 修改后的 `src/types.ts` - NotificationConfig 增加 `auto_update` 字段
- 修改后的 `src/config.ts` - 解析 `auto_update` 配置
- 修改后的 `src/index.ts` - 在 session.created 时触发更新检查

### Definition of Done
- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `bun test` 全部通过（含新增测试）
- [ ] 插件启动时不影响原有通知功能
- [ ] 更新检查在 5s 内完成（网络正常时）
- [ ] 更新安装失败时不崩溃，降级到通知模式

### Must Have
- 完全自动安装：检测到新版本后通过 bun install 自动更新
- 24h 缓存：上次检查结果缓存，24h 内不重复发网络请求
- auto_update 配置开关：默认 true，可关闭
- 本地开发模式跳过：file:// 路径不检查更新
- 版本固定跳过自动安装：仅通知
- 完善的错误降级：任何步骤失败不崩溃
- toast 通知：更新可用 / 已更新 / 更新失败
- 日志记录：所有关键步骤通过 logger 记录

### Must NOT Have (Guardrails)
- 不在顶层导入任何新依赖（遵循延迟导入模式）
- 不使用 npm install（仅 bun install）
- 不引入新的 runtime 依赖（使用 Node.js 内置模块）
- 不在非 session.created 事件时触发更新检查
- 不在 CLI 模式下触发更新检查
- 不在子会话中触发更新检查
- 不做 semver 复杂比较（简单字符串相等判断）
- DNS 预解析不需要（npm registry 是标准 HTTPS，非 SMTP 场景）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (Tests-after)
- **Framework**: Bun test
- **Test approach**: 先实现功能逻辑，再补充单元测试覆盖核心路径

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run tests, assert pass/fail counts
- **Integration**: Use Bash (bun test + typecheck) - Verify full suite passes

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - type definitions + config + core module):
+-- Task 1: Add auto_update to types and config [quick]
+-- Task 2: Create updater.ts core module [deep]

Wave 2 (After Wave 1 - integration + tests):
+-- Task 3: Integrate updater into index.ts [unspecified-high]
+-- Task 4: Create updater.test.ts unit tests [deep]

Wave FINAL (After ALL tasks):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 3 -> Task 4 -> F1-F4 -> user okay
Max Concurrent: 2 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2, 3 | 1 |
| 2 | - | 3, 4 | 1 |
| 3 | 1, 2 | 4 | 2 |
| 4 | 2, 3 | F1-F4 | 2 |

### Agent Dispatch Summary

- **Wave 1**: **2** - T1 -> `quick`, T2 -> `deep`
- **Wave 2**: **2** - T3 -> `unspecified-high`, T4 -> `deep`
- **FINAL**: **4** - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. Add `auto_update` Configuration Field to Types and Config

  **What to do**:
  - In `src/types.ts`: Add `auto_update?: boolean` field to `NotificationConfig` interface
  - In `src/config.ts`: Parse `auto_update` from config JSON, default to `true` if not specified
  - Ensure backward compatibility: existing configs without `auto_update` work fine (default true)

  **Must NOT do**:
  - Do not make `auto_update` required (must be optional with default)
  - Do not change any existing config behavior
  - Do not add validation errors for missing `auto_update`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, well-scoped type/config change, 2 files, clear pattern to follow
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 2, 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:NotificationConfig` - Current config interface, add `auto_update` here following existing optional field pattern
  - `src/config.ts:loadConfig()` - Config loading function, add `auto_update` parsing following existing field extraction pattern (e.g., how `language`, `timezone` are read)

  **External References**:
  - oh-my-openagent config: `auto_update: exports_external.boolean().optional()` - Confirms boolean optional is the right pattern

  **WHY Each Reference Matters**:
  - `src/types.ts:NotificationConfig` shows exact interface shape and JSDoc conventions to follow
  - `src/config.ts:loadConfig()` shows how to extract and default top-level config fields

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Type definition exists and is optional
    Tool: Bash (grep + bun test)
    Preconditions: Task 1 changes are saved
    Steps:
      1. grep "auto_update" src/types.ts -> should find the field
      2. grep "auto_update" src/config.ts -> should find the parsing logic
      3. bun test tests/config.test.ts -> ALL existing tests still pass
    Expected Result: Field found in both files, all existing config tests pass
    Failure Indicators: grep returns empty, or any existing test fails
    Evidence: .sisyphus/evidence/task-1-types-config.txt

  Scenario: Backward compatibility - config without auto_update works
    Tool: Bash (bun test)
    Preconditions: Existing test configs without auto_update field
    Steps:
      1. bun test tests/config.test.ts
      2. Verify no new failures introduced
    Expected Result: All existing tests pass, auto_update defaults to true
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-1-backward-compat.txt
  ```

  **Commit**: YES
  - Message: `feat(config): 添加 auto_update 自动更新配置项`
  - Files: `src/types.ts`, `src/config.ts`
  - Pre-commit: `bun test tests/config.test.ts`

---

- [x] 2. Create `src/updater.ts` Auto-Update Core Module

  **What to do**:
  - Create `src/updater.ts` with the following exported functions:
    1. `getCurrentVersion(): string | null` - Read version from this module's package.json (use `import.meta.url` to locate)
    2. `getLatestVersion(): Promise<string | null>` - HTTP fetch `https://registry.npmjs.org/-/package/@ulthon%2Ful-opencode-event/dist-tags`, 5s timeout, return `latest` tag value
    3. `getCachedCheck(): { latestVersion: string; timestamp: number } | null` - Read cache file from OpenCode data dir (`$OPENCODE_DATA_DIR/ul-opencode-event-update-cache.json` or `~/.local/share/opencode/ul-opencode-event-update-cache.json`)
    4. `setCachedCheck(latestVersion: string): void` - Write cache file with `{ latestVersion, timestamp: Date.now() }`
    5. `isCacheValid(): boolean` - Check if cache exists and timestamp is within 24h
    6. `invalidatePackage(packageDir: string): void` - Delete `node_modules/@ulthon/ul-opencode-event` from the given workspace dir, remove from bun.lock if exists
    7. `runBunInstall(workspaceDir: string): Promise<boolean>` - Execute `bun install` in workspace dir, 60s timeout, return success boolean. Use `Bun.spawn` if available, fallback to `child_process.spawn` with `windowsHide: true` on Windows
    8. `runAutoUpdate(ctx: any, autoUpdate: boolean): Promise<void>` - Main entry point orchestrating the full flow:
       - Skip if local dev mode (check opencode settings for `file://` plugin entry)
       - Skip if version pinned (check for `@1.2.3` pattern)
       - Check cache -> if valid, use cached result
       - Fetch latest version -> compare with current
       - If update available and autoUpdate=true: sync package.json -> invalidate -> bun install -> toast "Updated!"
       - If update available and autoUpdate=false: toast "Update available"
       - If already latest: no action
       - All errors: log + gracefully degrade

  - Constants:
    - `PACKAGE_NAME = '@ulthon/ul-opencode-event'`
    - `NPM_REGISTRY_URL = 'https://registry.npmjs.org/-/package/@ulthon%2Ful-opencode-event/dist-tags'`
    - `NPM_FETCH_TIMEOUT = 5000` (5s)
    - `BUN_INSTALL_TIMEOUT = 60000` (60s)
    - `CACHE_TTL = 24 * 60 * 60 * 1000` (24h in ms)

  - Use existing `logger` from `./logger.js` for all logging
  - Use Node.js built-in `fs`, `path`, `os` modules
  - For `child_process`: use dynamic import or conditional `Bun.spawn` vs `node:child_process`
  - All toast calls wrapped in try-catch with `.catch(() => {})` fallback

  **Must NOT do**:
  - Do NOT import nodemailer (irrelevant to this module)
  - Do NOT use semver library for version comparison (simple string equality)
  - Do NOT add new runtime dependencies to package.json
  - Do NOT block the event loop (all I/O must be async)
  - Do NOT throw errors from the main `runAutoUpdate` function (catch everything)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex module with multiple concerns (HTTP, filesystem, process spawning, caching), needs thorough understanding of OpenCode plugin architecture and oh-my-openagent patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/logger.ts` - Logger pattern: `import { logger } from './logger.js'`, use `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
  - `src/email.ts:sendEmail()` - DNS pre-resolution pattern for reference (but NOT needed for npm registry - just noting the contrast)
  - `src/index.ts:NotificationPlugin` - Plugin context pattern: `ctx.directory`, `ctx.client.tui.showToast()`

  **API/Type References**:
  - `src/types.ts:NotificationConfig` - Config interface where `auto_update` will be added (Task 1)

  **External References**:
  - oh-my-openagent `background-update-check.ts` lines 85105-85164 (in extracted dist) - Core update orchestration pattern: check version -> sync package.json -> invalidate -> bun install -> toast
  - oh-my-openagent `latest-version.ts` lines 84655-84671 - npm dist-tags fetch pattern with AbortController timeout
  - oh-my-openagent `bun-install.ts` lines 84879-84940 - bun install execution with timeout and error handling
  - oh-my-openagent `cache.ts` lines 84986-85012 - Package invalidation (delete node_modules + bun.lock)
  - oh-my-openagent `constants.ts` lines 84457-84480 - Constants pattern (PACKAGE_NAME, NPM_REGISTRY_URL, CACHE_DIR)
  - oh-my-openagent `cached-version.ts` lines 84617-84650 - getCurrentVersion via import.meta.url package.json lookup

  **WHY Each Reference Matters**:
  - `src/logger.ts` shows the exact import pattern and log level conventions to follow
  - `src/index.ts` shows how `ctx` is used in the plugin, critical for toast and directory access
  - oh-my-openagent lines 85105-85164 is the EXACT reference implementation to adapt (not copy)
  - oh-my-openagent lines 84655-84671 shows the npm registry fetch with proper timeout handling
  - oh-my-openagent lines 84879-84940 shows bun install with spawn + timeout + error capture

  **Acceptance Criteria**:
  - [ ] `src/updater.ts` file exists and exports `runAutoUpdate`
  - [ ] No new runtime dependencies in package.json
  - [ ] All imports use `.js` extension (NodeNext)
  - [ ] `npm run typecheck` passes with new file

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Module exports and typecheck
    Tool: Bash (npx tsc + grep)
    Preconditions: src/updater.ts exists
    Steps:
      1. npx tsc --noEmit -> exit code 0
      2. grep "export.*runAutoUpdate" src/updater.ts -> found
      3. grep "import.*from.*nodemailer" src/updater.ts -> NOT found (no nodemailer import)
    Expected Result: Typecheck passes, function exported, no forbidden imports
    Failure Indicators: Typecheck fails, export not found, or nodemailer imported
    Evidence: .sisyphus/evidence/task-2-module-check.txt

  Scenario: Error resilience - runAutoUpdate never throws
    Tool: Bash (bun test inline)
    Preconditions: Module compiled
    Steps:
      1. Write a minimal test that calls runAutoUpdate with mock ctx (no network)
      2. Verify it completes without throwing (even with fetch failure)
    Expected Result: Function completes, no unhandled rejection
    Failure Indicators: Uncaught exception or unhandled promise rejection
    Evidence: .sisyphus/evidence/task-2-error-resilience.txt
  ```

  **Commit**: YES
  - Message: `feat(updater): 添加自动更新核心模块`
  - Files: `src/updater.ts`
  - Pre-commit: `npm run typecheck`

---

- [x] 3. Integrate Auto-Update into Plugin Entry Point

  **What to do**:
  - Modify `src/index.ts`:
    1. Import `runAutoUpdate` from `./updater.js` at the top level (this is fine - it's not nodemailer)
    2. In the `event` handler, add logic at the `session.created` case:
       - Skip if session has `parentID` (subagent)
       - Skip if `OPENCODE_CLI_RUN_MODE` env is `true`
       - Only trigger once per plugin load (use a module-level `hasChecked` flag)
       - Call `runAutoUpdate(ctx, config.auto_update ?? true)` with `setTimeout(..., 0)` (non-blocking)
    3. Pass `ctx` to `runAutoUpdate` so it can access `ctx.client.tui.showToast()` and `ctx.directory`
  - Ensure the auto-update runs completely asynchronously and does not affect event handling

  **Must NOT do**:
  - Do NOT make update check synchronous or blocking
  - Do NOT change any existing event handling logic
  - Do NOT add auto-update trigger to events other than `session.created`
  - Do NOT import nodemailer in this change

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires understanding of plugin lifecycle, event flow, and careful integration without breaking existing functionality
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential within wave)
  - **Blocks**: Task 4
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/index.ts:257-261` - The exact location where `session.created` is handled. Add auto-update trigger here, after `sessionMap.set()`
  - oh-my-openagent `hook.ts` lines 85311-85364 - Exact integration pattern: `hasChecked` flag, `session.created` trigger, `setTimeout(async () => {...}, 0)`, skip conditions (CLI mode, parentID)

  **API/Type References**:
  - `src/types.ts:NotificationConfig` - Config interface now includes `auto_update` from Task 1

  **WHY Each Reference Matters**:
  - `src/index.ts:257-261` is the EXACT insertion point for the auto-update trigger
  - oh-my-openagent lines 85311-85364 shows the proven integration pattern with all skip conditions

  **Acceptance Criteria**:
  - [ ] `npm run typecheck` passes
  - [ ] Auto-update only triggers on first `session.created` of main session
  - [ ] Existing event handling (notifications) still works unchanged
  - [ ] `grep "runAutoUpdate" src/index.ts` finds the import and call

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Integration - auto-update trigger in session.created
    Tool: Bash (grep + typecheck)
    Preconditions: Task 3 changes saved
    Steps:
      1. grep "runAutoUpdate" src/index.ts -> found (import + call)
      2. grep "hasChecked" src/index.ts -> found (guard against duplicate triggers)
      3. grep "parentID" src/index.ts -> found (skip subagent sessions)
      4. npx tsc --noEmit -> exit code 0
    Expected Result: All patterns found, typecheck passes
    Failure Indicators: Any pattern missing or typecheck fails
    Evidence: .sisyphus/evidence/task-3-integration.txt

  Scenario: Existing tests still pass after integration
    Tool: Bash (bun test)
    Preconditions: All changes from Tasks 1-3
    Steps:
      1. bun test tests/index.test.ts -> all pass
      2. bun test tests/config.test.ts -> all pass
    Expected Result: Zero test failures
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-3-existing-tests.txt
  ```

  **Commit**: YES
  - Message: `feat(plugin): 集成自动更新到插件入口`
  - Files: `src/index.ts`
  - Pre-commit: `bun test tests/index.test.ts`

---

- [x] 4. Create Unit Tests for Auto-Update Module

  **What to do**:
  - Create `tests/updater.test.ts` with comprehensive tests:
    1. **getCurrentVersion tests**: Mock `import.meta.url` to point to a fake package.json, verify version extraction; test missing package.json returns null
    2. **getLatestVersion tests**: Mock `globalThis.fetch` to return dist-tags response; test timeout behavior (AbortController); test network failure returns null
    3. **Cache tests**: Test `getCachedCheck`/`setCachedCheck`/`isCacheValid` - write cache, read it back, verify TTL logic; test expired cache returns null; test missing cache file
    4. **invalidatePackage tests**: Mock `fs.rmSync`, verify it deletes the right directory; test missing directory doesn't throw
    5. **runBunInstall tests**: Mock `Bun.spawn` or `child_process.spawn`, test success (exit code 0) and failure; test timeout (kill process after 60s)
    6. **runAutoUpdate integration tests**: Mock all dependencies (fetch, spawn, fs), test the full flow:
       - Happy path: update available -> install success -> toast shown
       - No update: same version -> no action
       - Auto-update disabled: update available -> only toast, no install
       - Version pinned: only notification, no install
       - Local dev mode: skip entirely
       - Network failure: graceful degradation
       - bun install failure: fallback to notification
       - Cache hit within 24h: skip network request

  - Follow existing test patterns:
    - `import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'`
    - Use `mock.module()` for module-level mocking
    - Use `mock()` for function-level mocking
    - Dynamic import after mock setup

  **Must NOT do**:
  - Do NOT make real network requests in tests
  - Do NOT write to real filesystem (use temp dirs or mocks)
  - Do NOT skip error scenario tests
  - Do NOT use `@types/bun` or any new test dependency

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex test file requiring careful mocking of HTTP, filesystem, and process spawning; must cover many edge cases
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential, after Task 3)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 3

  **References**:

  **Pattern References**:
  - `tests/email.test.ts` - Module mock pattern with `mock.module('nodemailer', ...)` then dynamic import
  - `tests/dingtalk.test.ts` - Fetch mock pattern: `globalThis.fetch = mock(async (url, options) => {...})`
  - `tests/logger.test.ts` - Filesystem mock pattern for log file testing
  - `tests/index.test.ts:describe("NotificationPlugin")` - Plugin integration test patterns with mock ctx

  **API/Type References**:
  - `src/updater.ts` - The module being tested (created in Task 2)

  **Test References**:
  - `tests/config.test.ts` - Config parsing test patterns, shows how to test optional fields with defaults

  **WHY Each Reference Matters**:
  - `tests/email.test.ts` shows the exact `mock.module()` before dynamic import pattern to use
  - `tests/dingtalk.test.ts` shows how to mock `globalThis.fetch` for HTTP request testing
  - `tests/index.test.ts` shows how to create mock `ctx` objects for plugin testing

  **Acceptance Criteria**:
  - [ ] `bun test tests/updater.test.ts` passes all tests
  - [ ] At least 12 individual test cases (covering happy path + edge cases)
  - [ ] `bun test` full suite passes (new + existing tests)
  - [ ] No real network calls in tests

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full test suite passes
    Tool: Bash (bun test)
    Preconditions: All implementation and test files saved
    Steps:
      1. bun test -> run full suite
      2. Check output for pass/fail counts
    Expected Result: All tests pass, 0 failures
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-4-full-suite.txt

  Scenario: Test coverage completeness
    Tool: Bash (grep)
    Preconditions: tests/updater.test.ts exists
    Steps:
      1. grep -c "test(" tests/updater.test.ts -> count >= 12
      2. grep "describe" tests/updater.test.ts -> at least 4 describe blocks
      3. grep "mock.module\\|globalThis.fetch.*mock\\|mock(" tests/updater.test.ts -> mocking present
    Expected Result: Adequate test count and mocking present
    Failure Indicators: Fewer than 12 tests or missing mocks
    Evidence: .sisyphus/evidence/task-4-test-coverage.txt
  ```

  **Commit**: YES
  - Message: `test(updater): 添加自动更新模块单元测试`
  - Files: `tests/updater.test.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Verify cross-task integration. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

| Commit | Message | Files | Pre-commit Check |
|--------|---------|-------|------------------|
| 1 | `feat(config): 添加 auto_update 自动更新配置项` | `src/types.ts`, `src/config.ts` | `bun test tests/config.test.ts` |
| 2 | `feat(updater): 添加自动更新核心模块` | `src/updater.ts` | `npm run typecheck` |
| 3 | `feat(plugin): 集成自动更新到插件入口` | `src/index.ts` | `bun test tests/index.test.ts` |
| 4 | `test(updater): 添加自动更新模块单元测试` | `tests/updater.test.ts` | `bun test` |

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck   # Expected: exit code 0, no errors
npm run lint        # Expected: exit code 0, no errors
bun test            # Expected: all tests pass (existing + new updater tests)
grep "auto_update" src/types.ts   # Expected: field found
grep "runAutoUpdate" src/index.ts # Expected: import + call found
```

### Final Checklist
- [ ] All "Must Have" present (auto_update config, 24h cache, bun install, toast, local dev skip, pinned version skip, error degradation, logging)
- [ ] All "Must NOT Have" absent (no nodemailer import in updater, no npm install, no new runtime deps, no blocking I/O)
- [ ] All tests pass (existing + new)
- [ ] Plugin still sends notifications normally
- [ ] Auto-update runs asynchronously without affecting startup
