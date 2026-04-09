# Fix Auto-Update: Align Path Resolution with OpenCode's Actual Install Location

## TL;DR

> **Quick Summary**: Fix `updater.ts` so auto-update correctly locates the plugin installation at `~/.cache/opencode/packages/`, invalidates old packages, syncs workspace package.json, and runs `bun install` in the right directory -- matching oh-my-openagent's proven approach.
>
> **Deliverables**:
> - Fixed `getCacheDir()` / `getUserConfigDir()` path resolution
> - Fixed `invalidatePackage()` covering actual install paths + bun.lock cleanup
> - Fixed `resolveWorkspaceDir()` detecting real installation location
> - New `syncCachePackageJsonToIntent()` to sync workspace package.json before update
> - Updated tests covering new paths and scenarios
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5

---

## Context

### Original Request
ul-opencode-event 插件的自动更新功能无法正常工作。安装版本停留在 0.1.19，而 npm 最新版已是 0.1.20。

### Interview Summary
**Key Discussions**:
- `getCacheDir()` 返回 `~/.local/share/opencode` 而非实际的 `~/.cache/opencode`
- `invalidatePackage()` 和 `resolveWorkspaceDir()` 路径全部错误
- 缺少 `syncCachePackageJsonToIntent()` 机制
- oh-my-openagent 的实现是成熟参考方案

**Research Findings**:
- oh-my-openagent `data-path.ts`: `getCacheDir()` 返回 `XDG_CACHE_HOME ?? ~/.cache`，然后拼接 `/opencode`
- oh-my-openagent `cache.ts`: 同时清理 `configDir/node_modules` 和 `cacheDir/node_modules`，删除 bun.lock
- oh-my-openagent `sync-package-json.ts`: 更新工作区 package.json 的版本号以匹配配置意图
- oh-my-openagent `background-update-check.ts`: `resolveActiveInstallWorkspace` 优先检查 configDir，回退 cacheDir

### Metis Review
**Identified Gaps** (addressed):
- 版本缓存文件迁移到正确目录: 将缓存文件从 `~/.local/share/opencode/` 移到 `~/.cache/opencode/`
- Windows 环境下 XDG 变量: OpenCode 在所有平台使用 xdg-basedir（包括 Windows），所以 `~/.cache` 是正确路径
- bun.lock 清理: 需要同时处理文本和二进制格式的 bun.lock
- 测试中的 `OPENCODE_DATA_DIR` 环境变量: 测试已使用此变量覆盖路径，需同步更新

---

## Work Objectives

### Core Objective
修复 updater.ts 中的路径解析，使其与 OpenCode 实际的插件安装位置 `~/.cache/opencode/packages/` 匹配，并增加工作区 package.json 同步机制。

### Concrete Deliverables
- `src/updater.ts` 中所有路径函数返回正确值
- 新增 `syncCachePackageJsonToIntent()` 函数
- `tests/updater.test.ts` 覆盖新路径和新功能
- 现有测试继续通过

### Definition of Done
- [ ] `bun test tests/updater.test.ts` 全部通过
- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 成功

### Must Have
- `getCacheDir()` 返回 `~/.cache/opencode`（与 OpenCode xdg-basedir 行为一致）
- `getUserConfigDir()` 保持返回 `~/.config/opencode`
- `invalidatePackage()` 清理 `cacheDir/node_modules` 和 `configDir/node_modules` 两处
- `invalidatePackage()` 删除 bun.lock / bun.lockb
- `resolveWorkspaceDir()` 正确检测实际安装位置
- 新增 `syncCachePackageJsonToIntent()` 在更新前同步工作区 package.json
- `runAutoUpdate()` 调用 sync + invalidate + bun install 完整流程
- 所有现有测试继续通过

### Must NOT Have (Guardrails)
- 不引入新的运行时依赖
- 不在库代码顶层导入 nodemailer
- 不改变 `getCurrentVersion()` 的向上遍历逻辑
- 不改变 `getLatestVersion()` 的 npm registry 请求逻辑
- 不改变 `runBunInstall()` 的 spawn 逻辑
- 不改变 `index.ts` 中 `runAutoUpdate` 的调用时机和条件
- 不过度抽象 -- 保持 updater.ts 单文件，不拆分 data-path.ts 等子模块
- 不修改 `config.ts`、`handler.ts`、`email.ts` 等无关文件
- 保留 `OPENCODE_DATA_DIR` 环境变量覆盖能力用于测试

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash - Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - path fixes):
+-- Task 1: Fix getCacheDir() and getUserConfigDir() path resolution [quick]
+-- Task 2: Fix invalidatePackage() to cover actual install paths + bun.lock [quick]

Wave 2 (After Wave 1 - workspace sync + integration):
+-- Task 3: Add syncCachePackageJsonToIntent() and fix resolveWorkspaceDir() [unspecified-high]
+-- Task 4: Fix runAutoUpdate() orchestration to use new functions [unspecified-high]
+-- Task 5: Update tests for new paths and scenarios [unspecified-high]

Wave FINAL (After ALL tasks):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2, 3, 4, 5 | 1 |
| 2 | 1 | 3, 4 | 1 |
| 3 | 1, 2 | 4, 5 | 2 |
| 4 | 1, 2, 3 | 5 | 2 |
| 5 | 1, 2, 3, 4 | F1-F4 | 2 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks - T1 `quick`, T2 `quick`
- **Wave 2**: 3 tasks - T3 `unspecified-high`, T4 `unspecified-high`, T5 `unspecified-high`
- **FINAL**: 4 tasks - F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Fix `getCacheDir()` and `getUserConfigDir()` path resolution

  **What to do**:
  - 修改 `getCacheDir()` 返回 `~/.cache/opencode` 而非 `~/.local/share/opencode`
    - 使用 `XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache')` 拼接 `opencode`
    - 保留 `OPENCODE_DATA_DIR` 环境变量覆盖能力（但注意此变量语义应指向数据目录而非缓存目录，考虑新增 `OPENCODE_CACHE_DIR` 或直接使用 oh-my-openagent 模式）
    - 实际做法：引入 `getCacheRootDir()` 返回 `XDG_CACHE_HOME ?? ~/.cache`，`getCacheDir()` 返回 `cacheRoot + '/opencode'`
  - 保留 `getUserConfigDir()` 返回 `~/.config/opencode`，确保与 oh-my-openagent 的 `getOpenCodeConfigDir` 行为一致
  - 导出 `CACHE_DIR` 常量 = `getCacheDir() + '/packages'`（对应 oh-my-openagent 的 `CACHE_DIR`）
  - 确保缓存文件路径 `getCacheFilePath()` 也更新到新目录（`~/.cache/opencode/ul-opencode-event-update-cache.json`）
  - 将 `CACHE_TTL` 从 24h 缩短到 1h（`60 * 60 * 1000`），提高更新检测及时性

  **Must NOT do**:
  - 不改变 `getCurrentVersion()` 逻辑
  - 不引入新依赖
  - 不删除 `OPENCODE_DATA_DIR` 环境变量支持（向后兼容，但可标记为 deprecated）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2 conceptually, but Task 2 depends on these paths)
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 2, 3, 4, 5
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/updater.ts:31-36` - 当前 `getCacheDir()` 和 `getCacheFilePath()` 实现，需要修改

  **API/Type References**:
  - oh-my-openagent `src/shared/data-path.ts:getCacheDir()` - 返回 `XDG_CACHE_HOME ?? ~/.cache`，然后 `getOpenCodeCacheDir()` 拼接 `opencode`
  - oh-my-openagent `src/hooks/auto-update-checker/constants.ts:CACHE_DIR` - `path.join(CACHE_ROOT_DIR, "packages")`

  **WHY Each Reference Matters**:
  - `src/updater.ts:31-36`: 这是 bug 的根源，需要修改返回值从 `~/.local/share/opencode` 到 `~/.cache/opencode`
  - oh-my-openagent `data-path.ts`: 证明了 OpenCode 在所有平台（包括 Windows）使用 xdg-basedir，`~/.cache` 是正确路径

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: getCacheDir returns ~/.cache/opencode on Windows
    Tool: Bash (bun test)
    Preconditions: 环境变量 OPENCODE_DATA_DIR 未设置
    Steps:
      1. 在测试中 import getCacheDir
      2. 验证返回值以 `.cache/opencode` 结尾（不包含 `.local/share`）
    Expected Result: 路径包含 `.cache/opencode`
    Failure Indicators: 路径包含 `.local/share`
    Evidence: .sisyphus/evidence/task-1-cache-dir.txt

  Scenario: CACHE_TTL is 1 hour (not 24 hours)
    Tool: Bash (bun test)
    Preconditions: 无
    Steps:
      1. 验证 CACHE_TTL 常量等于 3600000 (1小时)
    Expected Result: CACHE_TTL === 3600000
    Failure Indicators: CACHE_TTL 仍为 86400000 (24小时)
    Evidence: .sisyphus/evidence/task-1-cache-ttl.txt

  Scenario: OPENCODE_DATA_DIR override still works for backward compat
    Tool: Bash (bun test)
    Preconditions: 设置 OPENCODE_DATA_DIR=/tmp/test-override
    Steps:
      1. 验证 getCacheDir 仍然可用（不崩溃）
      2. 如果保留了 override，验证路径指向 override 目录
    Expected Result: 不崩溃，路径可解析
    Evidence: .sisyphus/evidence/task-1-override.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `fix(updater): correct cache and config path resolution`
  - Files: `src/updater.ts`

- [x] 2. Fix `invalidatePackage()` to cover actual install paths + bun.lock cleanup

  **What to do**:
  - 修改 `invalidatePackage()` 清理以下路径:
    - `~/.cache/opencode/packages/node_modules/@ulthon/ul-opencode-event` (实际安装位置)
    - `~/.config/opencode/node_modules/@ulthon/ul-opencode-event` (旧式安装位置)
  - 新增 bun.lock / bun.lockb 清理逻辑:
    - 检查 `~/.cache/opencode/packages/bun.lock`，如果存在则删除包条目（文本格式）或直接删除文件（二进制格式）
    - 检查 `~/.cache/opencode/packages/bun.lockb`，如果存在则直接删除
  - 同时清理 `~/.cache/opencode/packages/@ulthon/ul-opencode-event@latest/` 目录下的 `node_modules`
  - 参考 oh-my-openagent `cache.ts` 的 `removeFromBunLock()` 和 `deleteBinaryBunLock()` 模式

  **Must NOT do**:
  - 不引入新依赖
  - 不修改其他无关函数

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1 paths)
  - **Parallel Group**: Wave 1 (after Task 1)
  - **Blocks**: Tasks 3, 4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/updater.ts:202-241` - 当前 `invalidatePackage()` 实现

  **API/Type References**:
  - oh-my-openagent `src/hooks/auto-update-checker/cache.ts:invalidatePackage()` - 同时清理 configDir 和 cacheDir，删除 bun.lock
  - oh-my-openagent `src/hooks/auto-update-checker/cache.ts:removeFromBunLock()` - 文本/二进制 bun.lock 处理

  **WHY Each Reference Matters**:
  - `src/updater.ts:202-241`: 当前实现只清理错误的路径，需要扩展覆盖实际安装位置
  - oh-my-openagent `cache.ts`: 成熟的清理逻辑，需要同时清理 node_modules 和 lockfile

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: invalidatePackage removes package from cache node_modules
    Tool: Bash (bun test)
    Preconditions: 创建模拟的 ~/.cache/opencode/packages/node_modules/@ulthon/ul-opencode-event 目录
    Steps:
      1. 调用 invalidatePackage()
      2. 验证目录已被删除
    Expected Result: 目录不存在
    Failure Indicators: 目录仍然存在
    Evidence: .sisyphus/evidence/task-2-invalidate-cache.txt

  Scenario: invalidatePackage removes bun.lockb when present
    Tool: Bash (bun test)
    Preconditions: 创建模拟的 bun.lockb 文件
    Steps:
      1. 调用 invalidatePackage()
      2. 验证 bun.lockb 已被删除
    Expected Result: 文件不存在
    Failure Indicators: 文件仍然存在
    Evidence: .sisyphus/evidence/task-2-lockfile.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `fix(updater): correct cache and config path resolution`
  - Files: `src/updater.ts`

- [x] 3. Add `syncCachePackageJsonToIntent()` and fix `resolveWorkspaceDir()`

  **What to do**:
  - 新增 `syncCachePackageJsonToIntent()` 函数:
    - 读取 opencode.json 配置中的插件条目，解析版本意图（latest / pinned version）
    - 更新 `~/.cache/opencode/packages/@ulthon/ul-opencode-event@latest/package.json` 中的版本号
    - 如果 package.json 不存在则创建
    - 如果版本号已匹配则跳过
    - 使用原子写入（write to temp + rename）防止损坏
  - 修改 `resolveWorkspaceDir()` 逻辑:
    - 优先检查 `~/.config/opencode/node_modules/@ulthon/ul-opencode-event/package.json`
    - 回退检查 `~/.cache/opencode/packages/node_modules/@ulthon/ul-opencode-event/package.json`
    - 再回退检查 `~/.cache/opencode/packages/package.json`（flat 模式）
    - 最终检查 `~/.cache/opencode/packages/@ulthon/ul-opencode-event@latest/package.json`（scoped flat 模式）
    - 默认返回 cacheDir

  **Must NOT do**:
  - 不引入新依赖
  - 不修改 `runBunInstall()` 的逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 4, 5
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/updater.ts:247-265` - 当前 `resolveWorkspaceDir()` 实现
  - `src/updater.ts:179-196` - `isPinnedVersion()` 中已有 EXACT_SEMVER_RE 正则和插件条目解析逻辑

  **API/Type References**:
  - oh-my-openagent `src/hooks/auto-update-checker/checker/sync-package-json.ts` - 完整的 sync 实现，包含原子写入和意图解析
  - oh-my-openagent `src/hooks/auto-update-checker/hook/background-update-check.ts:resolveActiveInstallWorkspace()` - 工作区解析模式

  **WHY Each Reference Matters**:
  - `src/updater.ts:247-265`: 当前实现检查的路径不对，需要覆盖实际安装位置
  - oh-my-openagent `sync-package-json.ts`: 展示了如何安全地更新工作区 package.json，包括原子写入和 JSON 解析错误处理
  - oh-my-openagent `background-update-check.ts`: 展示了正确的安装位置检测顺序

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: syncCachePackageJsonToIntent creates package.json when missing
    Tool: Bash (bun test)
    Preconditions: 目标目录存在但 package.json 不存在
    Steps:
      1. 调用 syncCachePackageJsonToIntent({ entry: '@ulthon/ul-opencode-event', isPinned: false, pinnedVersion: null })
      2. 验证 package.json 被创建，dependencies 中包含 "@ulthon/ul-opencode-event": "latest"
    Expected Result: 文件存在且内容正确
    Failure Indicators: 文件不存在或内容不正确
    Evidence: .sisyphus/evidence/task-3-sync-create.txt

  Scenario: syncCachePackageJsonToIntent updates version when different
    Tool: Bash (bun test)
    Preconditions: package.json 存在但版本为 "0.1.19"
    Steps:
      1. 调用 syncCachePackageJsonToIntent，意图版本为 "latest"
      2. 验证 package.json 中版本被更新为 "latest"
    Expected Result: 版本字段已更新
    Evidence: .sisyphus/evidence/task-3-sync-update.txt

  Scenario: resolveWorkspaceDir finds scoped flat installation
    Tool: Bash (bun test)
    Preconditions: 在 ~/.cache/opencode/packages/@ulthon/ul-opencode-event@latest/ 创建模拟 package.json
    Steps:
      1. 调用 resolveWorkspaceDir()
      2. 验证返回路径指向正确目录
    Expected Result: 返回包含 @ulthon 的路径
    Failure Indicators: 返回错误的默认路径
    Evidence: .sisyphus/evidence/task-3-resolve-workspace.txt
  ```

  **Commit**: YES (groups with Tasks 4, 5)
  - Message: `feat(updater): add workspace sync and fix auto-update orchestration`
  - Files: `src/updater.ts`

- [x] 4. Fix `runAutoUpdate()` orchestration to use new functions

  **What to do**:
  - 修改 `runAutoUpdate()` 中的更新流程:
    1. 在 `invalidatePackage()` 之前调用 `syncCachePackageJsonToIntent()`
    2. 使用新的 `resolveWorkspaceDir()` 获取工作区路径
    3. 调用 `invalidatePackage()` 清理旧包
    4. 在正确的工作区目录执行 `runBunInstall()`
  - 参考 oh-my-openagent `background-update-check.ts` 的执行顺序: sync -> invalidate -> install
  - 确保 sync 失败时不阻止后续流程（降级为通知模式）

  **Must NOT do**:
  - 不改变 `runAutoUpdate` 的入口签名
  - 不改变 `index.ts` 中的调用方式
  - 不修改 `runBunInstall()` 内部逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/updater.ts:362-453` - 当前 `runAutoUpdate()` 实现
  - `src/index.ts:265-280` - `runAutoUpdate` 的调用方式

  **API/Type References**:
  - oh-my-openagent `src/hooks/auto-update-checker/hook/background-update-check.ts:runBackgroundUpdateCheck()` - 完整的 sync -> invalidate -> install 流程

  **WHY Each Reference Matters**:
  - `src/updater.ts:362-453`: 当前流程缺少 sync 步骤，且 workspace 解析错误
  - oh-my-openagent 的流程: 证明了 sync 必须在 invalidate 之前执行，否则 bun install 无法知道要安装什么版本

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full auto-update flow calls sync before invalidate
    Tool: Bash (bun test)
    Preconditions: 模拟新版本可用 (latest=99.0.0)，auto-update=true
    Steps:
      1. 运行 runAutoUpdate(ctx, true)
      2. 验证 sync 被调用（通过 mock 追踪或副作用验证）
      3. 验证 bun install 在正确目录执行
    Expected Result: sync 更新了 package.json，install 在正确目录运行
    Failure Indicators: install 在错误目录运行或未执行
    Evidence: .sisyphus/evidence/task-4-orchestration.txt

  Scenario: Sync failure gracefully degrades to notification-only
    Tool: Bash (bun test)
    Preconditions: 模拟 sync 抛出异常
    Steps:
      1. 运行 runAutoUpdate(ctx, true)
      2. 验证显示 "Update available" toast 而非崩溃
    Expected Result: 显示通知 toast，无异常
    Evidence: .sisyphus/evidence/task-4-sync-fallback.txt
  ```

  **Commit**: YES (groups with Tasks 3, 5)
  - Message: `feat(updater): add workspace sync and fix auto-update orchestration`
  - Files: `src/updater.ts`

- [x] 5. Update tests for new paths and scenarios

  **What to do**:
  - 更新 `tests/updater.test.ts`:
    - 修改所有使用 `OPENCODE_DATA_DIR` 的测试，确保新路径逻辑正确
    - 新增测试: `getCacheDir` 返回正确路径
    - 新增测试: `invalidatePackage` 清理正确的目录和 lockfile
    - 新增测试: `syncCachePackageJsonToIntent` 创建/更新 package.json
    - 新增测试: `resolveWorkspaceDir` 找到实际安装位置
    - 新增测试: `runAutoUpdate` 完整流程中 sync -> invalidate -> install 顺序
  - 确保所有现有测试继续通过（不破坏现有行为）
  - 测试中使用临时目录模拟文件系统结构

  **Must NOT do**:
  - 不修改 src/ 下的任何源代码
  - 不引入新的测试框架
  - 不删除现有测试用例

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (last task)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 2, 3, 4

  **References**:

  **Pattern References**:
  - `tests/updater.test.ts` - 现有测试结构、mock 策略、辅助函数

  **Test References**:
  - `tests/updater.test.ts:createTmpDir()` - 临时目录创建模式
  - `tests/updater.test.ts:createProjectDir()` - 模拟项目目录结构
  - `tests/updater.test.ts:writeCacheFileForTest()` - 缓存文件写入辅助

  **WHY Each Reference Matters**:
  - `tests/updater.test.ts`: 必须复用现有的 mock 策略和辅助函数，保持测试一致性

  **Acceptance Criteria**:

  - [ ] `bun test tests/updater.test.ts` -> PASS (all tests, 0 failures)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All updater tests pass
    Tool: Bash
    Preconditions: 所有源码修改已完成
    Steps:
      1. 运行 bun test tests/updater.test.ts
      2. 检查退出码为 0
      3. 检查所有测试通过
    Expected Result: 0 failures, all tests pass
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-5-all-tests.txt

  Scenario: Typecheck passes after changes
    Tool: Bash
    Preconditions: 所有修改完成
    Steps:
      1. 运行 npm run typecheck
      2. 检查退出码为 0
    Expected Result: No type errors
    Failure Indicators: 任何类型错误
    Evidence: .sisyphus/evidence/task-5-typecheck.txt
  ```

  **Commit**: YES (groups with Tasks 3, 4)
  - Message: `feat(updater): add workspace sync and fix auto-update orchestration`
  - Files: `tests/updater.test.ts`
  - Pre-commit: `bun test tests/updater.test.ts`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `tsc --noEmit` + `bun test`. Review changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, unused imports. Check AI slop: excessive comments, over-abstraction.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `fix(updater): correct cache and config path resolution` - src/updater.ts
- **Wave 2**: `feat(updater): add workspace sync and fix auto-update orchestration` - src/updater.ts, tests/updater.test.ts

---

## Success Criteria

### Verification Commands
```bash
bun test tests/updater.test.ts    # Expected: all tests pass
npm run typecheck                  # Expected: no errors
npm run build                      # Expected: clean build
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
