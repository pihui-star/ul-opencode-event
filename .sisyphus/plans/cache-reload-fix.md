# 缓存刷新修复 + 命令注册

## TL;DR

> **Quick Summary**: 修复 ul-token-rebuild 工具执行后插件内存缓存不刷新的问题，并添加 `/token-rebuild` slash 命令和 CLI `rebuild` 子命令
> 
> **Deliverables**:
> - 修复 in-memory sessionCache 刷新机制
> - 插件初始化时自动写入 command md 文件注册 slash 命令
> - CLI 新增 `rebuild` 子命令
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 (cache fix) -> Task 4 (tests)

---

## Context

### Original Request
ul-token-rebuild 工具执行后，通知中的项目级 token 总量没有明显变化。根因是 `sessionCache` 在插件初始化时加载一次后固化在闭包里，工具写入文件后内存 Map 未刷新。

### Interview Summary
**Key Discussions**:
- 根因确认：`const sessionCache = loadSessionCache(baseDir)` (index.ts:655) 只执行一次
- tool execute 与 sessionCache 在同一个闭包内，改为 `let` 后可直接赋值刷新
- OpenCode 插件 API 不支持 TUI 命令注册 (PluginModule.tui = never)
- slash 命令可通过写入 `~/.config/opencode/command/*.md` 文件注册
- CLI rebuild 子命令作为终端备选入口

**Research Findings**:
- TuiCommand.slash 字段存在但 npm 插件无法使用 (tui = never)
- tokenscope 的实现方式：Hooks.tool + 手动创建 command md
- 插件可在初始化时自动写入 command md 文件

### Metis Review
**Identified Gaps** (addressed):
- tool execute 确实在同一闭包内，可直接修改 let 变量
- CLI rebuild 使用 process.cwd() 作为 projectPath
- 命令文件写入需处理目录不存在的情况
- 命令文件幂等性：已存在时不覆盖

---

## Work Objectives

### Core Objective
让 ul-token-rebuild 工具执行后立即生效，并为用户提供方便的触发入口。

### Concrete Deliverables
- `src/index.ts`: sessionCache 改为 let，tool execute 后刷新
- `src/index.ts`: 初始化时写入 command md 文件
- `src/cli.ts`: 新增 rebuild 子命令
- 测试更新

### Definition of Done
- [ ] `bun test` 全部通过（396+ pass，9 pre-existing updater failures）
- [ ] `npx tsc --noEmit` 零错误
- [ ] ul-token-rebuild 执行后，下次通知的项目级 token 包含缓存数据

### Must Have
- tool execute 成功后刷新内存中的 sessionCache
- 命令文件写入失败不影响插件初始化
- CLI rebuild 子命令输出格式化的同步结果

### Must NOT Have (Guardrails)
- 不修改 session-cache.ts 的任何导出函数签名
- 不修改 fillProjectData 函数签名或逻辑
- 不为 CLI rebuild 添加额外参数（--project, --force 等）
- 不引入新的外部依赖
- 不实现命令文件版本管理或更新逻辑
- 不处理并发刷新（JSONL 去重机制已足够）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun:test)
- **Automated tests**: Tests-after
- **Framework**: bun test

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
+-- Task 1: 修复 sessionCache 内存刷新 (index.ts) [quick]
+-- Task 2: 命令文件自动注册 (index.ts init) [quick]
+-- Task 3: CLI rebuild 子命令 (cli.ts) [quick]

Wave 2 (After Wave 1):
+-- Task 4: 测试更新 [unspecified-high]

Wave FINAL:
+-- F1: Plan compliance audit (oracle)
+-- F2: Code quality review (unspecified-high)
+-- F3: Real manual QA (unspecified-high)
+-- F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 4 -> F1-F4
Parallel Speedup: Tasks 1-3 fully parallel
Max Concurrent: 3 (Wave 1)
```

---

## TODOs

- [x] 1. 修复 sessionCache 内存刷新

  **What to do**:
  - 在 `src/index.ts` 第655行，将 `const sessionCache = loadSessionCache(baseDir)` 改为 `let sessionCache = loadSessionCache(baseDir)`
  - 在 tool execute 函数中（第862-871行），`syncFromDB` 成功后添加 `sessionCache = loadSessionCache(baseDir)` 刷新内存缓存
  - 删除 tool execute 中第866行多余的 `const currentCache = loadSessionCache(cacheDir)` 调用（syncFromDB 内部已经自己加载缓存了），改为直接使用闭包中的 `sessionCache` 变量
  - 注意：`baseDir` 在同一闭包中可直接访问（定义在第640行附近）

  **Must NOT do**:
  - 不修改 fillProjectData 函数
  - 不修改 session-cache.ts 的任何函数
  - 不引入新变量或新函数

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `src/index.ts:640` - `baseDir` 定义（函数作用域）
  - `src/index.ts:655` - `const sessionCache` 需改为 `let`
  - `src/index.ts:858-874` - tool execute 闭包，与 sessionCache 在同一函数作用域
  - `src/index.ts:866` - 冗余的 `loadSessionCache(cacheDir)` 需改为使用闭包变量
  - `src/session-cache.ts:257-400` - syncFromDB 函数，内部已调用 loadSessionCache

  **Acceptance Criteria**:
  - [ ] `npx tsc --noEmit` passes
  - [ ] `bun test` passes (396+ pass, 9 pre-existing fail)
  - [ ] sessionCache 声明为 `let`
  - [ ] tool execute 中 syncFromDB 成功后有 `sessionCache = loadSessionCache(baseDir)`

  **QA Scenarios**:
  ```
  Scenario: tsc and tests pass after change
    Tool: Bash
    Steps:
      1. Run `npx tsc --noEmit`
      2. Run `bun test`
    Expected Result: tsc zero errors, 396+ tests pass
    Evidence: .sisyphus/evidence/task-1-build-test.txt
  ```

  **Commit**: YES (groups with Tasks 2, 3)
  - Message: `fix(cache): 修复 ul-token-rebuild 后内存缓存不刷新`
  - Files: `src/index.ts`
  - Pre-commit: `npx tsc --noEmit && bun test`

- [x] 2. 命令文件自动注册

  **What to do**:
  - 在 `src/index.ts` 的 `NotificationPluginImpl` 中，`loadSessionCache(baseDir)` 之后、`return` 之前（约655-659行之间），添加命令文件写入逻辑
  - 写入路径：`~/.config/opencode/command/ul-token-rebuild.md`
  - 文件内容格式参照 `C:\Users\augushong\.config\opencode\command\tokenscope.md`
  - 命令文件内容：
    ```markdown
    ---
    description: 从数据库重建 token 缓存，提升项目级聚合准确度
    ---
    直接调用 ul-token-rebuild 工具，不要委派给其他 agent。执行后向用户报告同步结果。
    ```
  - 使用 `path.join(os.homedir(), '.config', 'opencode', 'command')` 确定目录
  - 使用 `fs.mkdirSync(dir, { recursive: true })` 确保目录存在
  - 写入前检查文件是否已存在（`fs.existsSync`），已存在则跳过（幂等性）
  - 写入失败时 `logger.warn` 但不阻塞插件初始化
  - fs 使用 `createRequire` 模式，与 session-cache.ts 一致

  **Must NOT do**:
  - 不使用已有的 `baseDir` 变量（那是数据目录，不是配置目录）
  - 不添加文件版本管理或更新逻辑
  - 不在每次事件触发时重写文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `C:\Users\augushong\.config\opencode\command\tokenscope.md` - 命令文件格式参考
  - `src/session-cache.ts:17-18` - createRequire + fs 模式参考
  - `src/index.ts:7` - `import * as os from 'node:os'` 已存在
  - `src/index.ts:655-659` - 插入位置（loadSessionCache 之后）

  **Acceptance Criteria**:
  - [ ] `npx tsc --noEmit` passes
  - [ ] 命令文件路径：`~/.config/opencode/command/ul-token-rebuild.md`
  - [ ] 文件已存在时跳过写入（幂等）
  - [ ] 写入失败不阻塞插件

  **QA Scenarios**:
  ```
  Scenario: Command file created on fresh install
    Tool: Bash
    Preconditions: ~/.config/opencode/command/ul-token-rebuild.md does not exist
    Steps:
      1. Import and initialize plugin (or just verify the code logic)
      2. Check file exists: Test-Path "$env:USERPROFILE\.config\opencode\command\ul-token-rebuild.md"
    Expected Result: File exists with correct YAML frontmatter
    Evidence: .sisyphus/evidence/task-2-command-file.txt

  Scenario: Idempotent - no error when file already exists
    Tool: Bash
    Preconditions: File already exists
    Steps:
      1. Run plugin init again
      2. Verify file content unchanged
    Expected Result: No error, file content preserved
    Evidence: .sisyphus/evidence/task-2-idempotent.txt
  ```

  **Commit**: YES (groups with Tasks 1, 3)
  - Message: `feat(cache): 自动注册 ul-token-rebuild slash 命令`
  - Files: `src/index.ts`

- [x] 3. CLI rebuild 子命令

  **What to do**:
  - 在 `src/cli.ts` 中添加 `rebuild` 子命令支持
  - 更新 `parseArgs()` 函数（约97-121行）识别 `rebuild` 命令
  - 更新 usage/help 输出，包含 `rebuild` 子命令说明
  - 实现 `rebuild` 子命令逻辑：
    1. 获取 dataDir: `process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode')`
    2. 获取 projectPath: `process.cwd()`
    3. 导入 `loadSessionCache` 和 `syncFromDB` from `./session-cache.js`
    4. 调用 `loadSessionCache(dataDir)` 获取当前缓存
    5. 调用 `syncFromDB(dataDir, projectPath, currentCache)` 执行同步
    6. 打印格式化结果，包含人类可读格式（如 57.7M、728.2M）。输出格式示例：
    ```
    [ul-opencode-event-cli] Token cache rebuild complete.
    
    Project: D:\projects\ulthon\ul-opencode-event
    New sessions synced: 501
    Total cached sessions: 503
    
    Token breakdown:
      Input:       57,724,649 (57.7M)
      Output:       3,079,028 (3.1M)
      Cache Read: 667,435,116 (667.4M)
      Cache Write:         0 (0)
      Total:     728,238,793 (728.2M)
    ```
  - 人类可读格式化函数：定义一个 `humanize(n: number): string` 辅助函数，>1M 显示 `x.xM`，>1K 显示 `x.xK`，否则显示原始数字
  - 注意：CLI 通过 `npx` 运行，需要用 Bun 运行（因为 syncFromDB 依赖 `bun:sqlite`）。在 CLI 头部添加检测，如果运行在 Node.js 下给出提示
  - 不需要动态导入 nodemailer 等 CLI 已有的静态导入

  **Must NOT do**:
  - 不添加 --project、--force 等额外参数
  - 不修改 session-cache.ts
  - 不引入新的外部依赖
  - 不修改 test 子命令的逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `src/cli.ts:95-121` - parseArgs() 函数，需要增加 rebuild 识别
  - `src/cli.ts:918-921` - 命令分发逻辑，需要增加 rebuild 分支
  - `src/session-cache.ts:257` - syncFromDB 函数签名
  - `src/session-cache.ts:74` - loadSessionCache 函数签名
  - `src/db-preload.ts:5` - `import { Database } from 'bun:sqlite'` 模式参考

  **Acceptance Criteria**:
  - [ ] `npx tsc --noEmit` passes
  - [ ] `npx @ulthon/ul-opencode-event rebuild` 输出同步结果
  - [ ] `npx @ulthon/ul-opencode-event` 输出包含 rebuild 的 usage
  - [ ] 使用 process.cwd() 作为 projectPath

  **QA Scenarios**:
  ```
  Scenario: CLI rebuild executes and shows results
    Tool: Bash
    Steps:
      1. Run `npx @ulthon/ul-opencode-event rebuild`
    Expected Result: Output contains "New sessions synced" or "Total cached sessions"
    Evidence: .sisyphus/evidence/task-3-cli-rebuild.txt

  Scenario: CLI help shows rebuild command
    Tool: Bash
    Steps:
      1. Run `npx @ulthon/ul-opencode-event` (no args)
    Expected Result: Usage output contains "rebuild"
    Evidence: .sisyphus/evidence/task-3-cli-usage.txt
  ```

  **Commit**: YES (groups with Tasks 1, 2)
  - Message: `feat(cli): 添加 rebuild 子命令`
  - Files: `src/cli.ts`

- [x] 4. 测试更新

  **What to do**:
  - 运行 `bun test` 确认所有现有测试通过
  - 如果有测试因 sessionCache 从 const 改为 let 而失败，修复它们
  - 新增测试验证命令文件写入逻辑（可 mock fs）

  **Must NOT do**:
  - 不修改测试断言来让测试通过
  - 不删除现有测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `tests/index.test.ts` - 可能需要更新的测试
  - `tests/session-cache.test.ts` - 缓存模块测试参考

  **Acceptance Criteria**:
  - [ ] `bun test` passes (396+ pass, 9 pre-existing fail)
  - [ ] `npx tsc --noEmit` passes

  **QA Scenarios**:
  ```
  Scenario: All tests pass after changes
    Tool: Bash
    Steps:
      1. Run `bun test`
      2. Count pass/fail
    Expected Result: 396+ pass, 9 fail (pre-existing updater.test.ts)
    Evidence: .sisyphus/evidence/task-4-test-results.txt
  ```

  **Commit**: YES
  - Message: `test(cache): 更新测试适配缓存刷新和命令注册`
  - Files: `tests/`
  - Pre-commit: `bun test`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `oracle`
- [x] F2. **Code Quality Review** -- `unspecified-high`
- [x] F3. **Real Manual QA** -- `unspecified-high`
- [x] F4. **Scope Fidelity Check** -- `deep`

---

## Commit Strategy

- **Wave 1**: `fix(cache): 修复 ul-token-rebuild 后内存缓存不刷新，添加命令注册` - src/index.ts, src/cli.ts
- **Wave 2**: `test(cache): 补充缓存刷新和命令注册测试` - tests/

---

## Success Criteria

### Verification Commands
```bash
npx tsc --noEmit    # Expected: zero errors
bun test             # Expected: 400+ pass, 9 fail (pre-existing)
```

### Final Checklist
- [x] tool execute 后 sessionCache 被刷新
- [x] 命令文件存在且格式正确
- [x] CLI rebuild 子命令可用
- [x] 所有测试通过
