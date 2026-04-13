# Plugin Resilience & Startup Experience

## TL;DR

> **Quick Summary**: 修复 ul-opencode-event 插件的配置校验死锁问题，增加启动版本 toast，确保 updater 在任何情况下都能自愈运行。
> 
> **Deliverables**:
> - config.ts: validateChannelTypes 改为 warn+filter，校验顺序调整到 filterEnabledChannels 之后
> - updater.ts: 修复 syncCachePackageJsonToIntent/invalidatePackage 执行顺序
> - index.ts: 增加启动版本 toast，确保 updater 在配置错误时也能运行
> - 对应测试文件更新
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 (config) → Task 4 (index toast) ; Task 2 (updater) 独立

---

## Context

### Original Request
用户发现飞书通道配置后没有收到通知。排查发现：本机运行 0.1.27（不支持 feishu），0.1.28 才包含 feishu.js。自动更新机制存在鸡生蛋死锁：loadConfig() 对不支持的通道类型 throw → 插件返回空对象 → 没有注册事件回调 → updater 永远不执行。用户同时要求像 oh-my-openagent 插件一样每次启动弹出版本 toast。

### Interview Summary
**Key Discussions**:
- 死锁根因：validateChannelTypes throw → loadConfig 失败 → return {} → 无事件回调 → updater 不执行
- validateChannelTypes 在 filterEnabledChannels 之前执行，disabled 通道也会被校验
- updater.ts 中 syncCachePackageJsonToIntent 写的文件被 invalidatePackage 立即删除
- oh-my-openagent 用 spinner 动画 toast 显示版本，我们简化为单次 toast 即可

**Research Findings**:
- oh-my-openagent 启动 toast：session.created 事件触发，setTimeout(0) 确保 TUI 就绪，hasChecked 防重复
- Toast API: `ctx.client.tui.showToast({ body: { title, message, variant, duration } })`
- 所有 sender factory (createEmailSender/createDingTalkSender/createFeishuSender) 不 throw，只返回 null
- 现有测试 config.test.ts:357-411 断言 validateChannelTypes 会 throw，需要更新

### Metis Review
**Identified Gaps** (addressed):
- 校验顺序问题：disabled 通道不应参与类型校验 → validateChannelTypes 移到 filterEnabledChannels 之后
- updater ordering bug：sync 写的文件被 invalidate 删掉 → 调换顺序为 invalidate→sync
- 启动 toast 未考虑配置错误场景 → 即使 loadConfig 报错也显示错误 toast（包含日志路径）
- 现有测试断言 throw 行为需更新为断言 warn+filter 行为
- 配置错误时用户完全无感知 → 增加错误 toast 弹框，告知错误摘要和日志位置
- loadConfig 必须永远不 throw → 任何配置问题都降级处理而非崩溃

---

## Work Objectives

### Core Objective
修复插件配置校验死锁，使插件在面对未来新通道类型时能优雅降级而非完全失效，同时增加启动版本反馈。

### Concrete Deliverables
- src/config.ts: validateChannelTypes 改为 warn + 过滤无效通道（不 throw）
- src/config.ts: loadConfig 中校验顺序调整为 filterEnabled → validate
- src/updater.ts: runAutoUpdate 中 invalidatePackage 和 syncCachePackageJsonToIntent 调换顺序
- src/index.ts: 启动时显示版本 toast（版本号 + 通道数）
- src/index.ts: loadConfig 失败时也尝试运行 updater 并显示错误 toast
- tests/config.test.ts: 更新断言 throw 的测试为断言 warn+filter
- tests/updater.test.ts: 新增 ordering 测试
- tests/index.test.ts: 新增 toast 测试

### Definition of Done
- [ ] `bun test` 全部通过
- [ ] `npm run typecheck` 无错误
- [ ] 配置中包含未知通道类型时插件不再崩溃，已支持通道正常工作
- [ ] 启动时显示版本 toast
- [ ] 配置错误时 updater 仍能运行

### Must Have
- validateChannelTypes 对未知类型 warn + 过滤，不 throw
- disabled 通道不参与类型校验
- updater 在配置错误时也能运行
- 启动 toast 显示版本号和通道数
- 配置加载失败时弹出错误 toast，告知用户错误摘要和日志文件路径
- 无通道时弹出警告 toast
- CLI 模式下跳过 toast（OPENCODE_CLI_RUN_MODE）
- 子会话跳过 toast（parentID 非空）
- loadConfig 永远不 throw（任何配置问题都降级处理）

### Must NOT Have (Guardrails)
- 不修改 handler.ts 的 sender 分发逻辑
- 不修改 dingtalk.ts、feishu.ts、email.ts、template.ts、locales.ts、logger.ts
- 不改变配置文件合并逻辑和文件发现逻辑
- 不添加新的 npm 依赖
- 不添加并行通道发送或每通道超时
- 不重构 ctx: any 类型
- loadConfig 保持同步函数

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (Tests-after — 先改实现再补充/更新测试，因为核心是 bug fix)
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 2 independent fixes):
+-- Task 1: config.ts validateChannelTypes warn+filter + 校验顺序 [unspecified-high]
+-- Task 2: updater.ts sync/invalidate ordering fix [quick]

Wave 2 (After Wave 1 - depends on Task 1):
+-- Task 3: index.ts startup toast + updater on partial config [unspecified-high]

Wave FINAL (After ALL tasks):
+-- Task F1: Full test suite + typecheck [quick]
+-- Task F2: Integration verification [unspecified-high]
```

Critical Path: Task 1 → Task 3 → F1/F2
Parallel Speedup: Task 1 & Task 2 独立并行

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | - | 3 |
| 2 | - | - |
| 3 | 1 | F1, F2 |
| F1 | 3 | - |
| F2 | 3 | - |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks - T1 `unspecified-high`, T2 `quick`
- **Wave 2**: 1 task - T3 `unspecified-high`
- **FINAL**: 2 tasks - F1 `quick`, F2 `unspecified-high`

---

## TODOs

- [x] 1. config.ts: validateChannelTypes 改为 warn+filter + 校验顺序调整

  **What to do**:
  - 修改 `validateChannelTypes()` (config.ts:43-51)：不 throw，改为对未知类型 `logger.warn()` 并从 channels 数组中过滤掉
    - 返回 `Channel[]`（有效通道列表）而非 `void`
    - 签名变为：`function validateAndFilterChannels(channels: Channel[]): Channel[]`
    - 对每个未知类型记录：`logger.warn('Unknown channel type: "${channel.type}" in channel "${channel.name}". Supported types: smtp, dingtalk, feishu. Skipping.')`
    - 返回仅包含已知类型通道的数组
  - 修改 `loadConfig()` (config.ts:189-240) 中的调用顺序：
    - 原顺序：mergeChannels → validateChannelTypes → filterEnabledChannels
    - 新顺序：mergeChannels → filterEnabledChannels → validateAndFilterChannels（先过滤 disabled，再校验+过滤未知类型）
    - validateAndFilterChannels 返回的有效通道赋值给 enabledChannels
  - 确认 `loadConfig()` 中其他代码路径不会 throw：
    - `loadConfigFile()`: 已有 try/catch，JSON 解析错误返回 null — 安全
    - `validateIncludeSessionTypes()`: 只 warn 不 throw — 安全
    - `mergeChannels()`: 纯数据操作 — 安全
  - 更新 tests/config.test.ts:357-411 中断言 throw 的测试，改为断言 warn+filter 行为：
    - 测试用例：混合有效+无效通道 → 返回仅有效通道
    - 测试用例：全部无效通道 → 返回空数组（不 throw）
    - 测试用例：disabled+未知类型通道 → 不产生 warn（已过滤）
    - 测试用例：enabled+未知类型 → warn 日志 + 从结果中移除
    - 测试用例：每个无效通道都有 warn 日志

  **Must NOT do**:
  - 不改变 loadConfig 的同步性质
  - 不改变配置文件合并逻辑
  - 不改变 SUPPORTED_CHANNEL_TYPES 常量
  - 不修改 handler.ts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 涉及核心校验逻辑重构，需要理解现有测试模式并更新
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/config.ts:43-51` - validateChannelTypes 当前 throw 实现
  - `src/config.ts:137-139` - filterEnabledChannels 实现（过滤 enabled !== false）
  - `src/config.ts:189-240` - loadConfig 完整流程，注意 211 行 validate 在 214 行 filter 之前
  - `src/config.ts:8` - SUPPORTED_CHANNEL_TYPES 常量定义

  **Test References**:
  - `tests/config.test.ts` - 现有配置测试，需找到断言 throw 的用例并更新
  - `tests/utils/sample-configs.ts` - 测试用配置样例

  **WHY Each Reference Matters**:
  - config.ts:43-51 是要修改的核心函数，需理解当前 throw 行为
  - config.ts:211 vs 214 是校验顺序 bug 的位置
  - config.test.ts 中断言 throw 的测试必须同步更新

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: [混合有效+无效通道 — 仅返回有效通道]
    Tool: Bash (bun test)
    Preconditions: 测试代码已写入 tests/config.test.ts
    Steps:
      1. 构造配置: channels = [{ type: 'smtp', name: 'email', enabled: true }, { type: 'telegram', name: 'tg', enabled: true }]
      2. 调用 loadConfig()
      3. 断言返回 channels 长度为 1，且 type === 'smtp'
      4. 断言 logger.warn 被调用，消息包含 "telegram"
    Expected Result: 返回 1 个有效通道，warn 日志包含 "telegram"
    Failure Indicators: loadConfig 抛异常，或返回 0/2 个通道
    Evidence: .sisyphus/evidence/task-1-mixed-channels.txt

  Scenario: [全部无效通道 — 返回空数组不 throw]
    Tool: Bash (bun test)
    Preconditions: 测试代码已写入 tests/config.test.ts
    Steps:
      1. 构造配置: channels = [{ type: 'telegram', name: 'tg', enabled: true }]
      2. 调用 loadConfig()
      3. 断言不抛异常
      4. 断言返回 channels 长度为 0
    Expected Result: 无异常，空 channels 数组
    Failure Indicators: loadConfig 抛异常
    Evidence: .sisyphus/evidence/task-1-all-invalid.txt

  Scenario: [disabled 通道含未知类型 — 不产生 warn]
    Tool: Bash (bun test)
    Preconditions: 测试代码已写入 tests/config.test.ts
    Steps:
      1. 构造配置: channels = [{ type: 'telegram', name: 'tg', enabled: false }]
      2. 调用 loadConfig()
      3. 断言返回 channels 长度为 0
      4. 断言 logger.warn 未被调用（或仅被调用 0 次含 "telegram"）
    Expected Result: 空 channels，无 warn
    Failure Indicators: warn 日志包含 "telegram"
    Evidence: .sisyphus/evidence/task-1-disabled-unknown.txt
  ```

  **Commit**: YES
  - Message: `fix(config): validateChannelTypes warn+filter instead of throw, fix validation order`
  - Files: `src/config.ts, tests/config.test.ts`
  - Pre-commit: `bun test tests/config.test.ts`

- [x] 2. updater.ts: 修复 sync/invalidate 执行顺序

  **What to do**:
  - 修改 `runAutoUpdate()` (updater.ts:549-576) 中的调用顺序：
    - 原顺序 (第 560-569 行)：syncCachePackageJsonToIntent → invalidatePackage
    - 新顺序：invalidatePackage → syncCachePackageJsonToIntent
    - 原因：sync 写入 `scopedDir/package.json`，invalidate 删除整个 `scopedDir`，导致 sync 写的文件被删
  - 更新第 549 行注释：`// 7. Auto-update: invalidate -> sync -> resolve workspace -> bun install`
  - 新增测试验证 ordering：
    - Mock invalidatePackage 和 syncCachePackageJsonToIntent
    - 断言 invalidatePackage 在 syncCachePackageJsonToIntent 之前被调用

  **Must NOT do**:
  - 不修改 invalidatePackage 或 syncCachePackageJsonToIntent 的内部逻辑
  - 不修改 resolveWorkspaceDir
  - 不改变 bun install 的调用方式

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 两行代码调换顺序 + 一个注释更新 + 一个测试
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/updater.ts:549-576` - runAutoUpdate 中 sync 和 invalidate 的调用位置
  - `src/updater.ts:205-256` - invalidatePackage 实现（删除 scopedDir 目录）
  - `src/updater.ts:274-304` - syncCachePackageJsonToIntent 实现（写入 scopedDir/package.json）

  **Test References**:
  - `tests/updater.test.ts` - 现有 updater 测试，需找到 runAutoUpdate 相关用例

  **WHY Each Reference Matters**:
  - updater.ts:560 vs 569 是 ordering bug 的精确位置
  - invalidatePackage 删除 syncCachePackageJsonToIntent 写入的目录，理解这两个函数的副作用是关键

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: [invalidate 在 sync 之前执行]
    Tool: Bash (bun test)
    Preconditions: 测试代码已写入 tests/updater.test.ts
    Steps:
      1. Mock invalidatePackage 和 syncCachePackageJsonToIntent
      2. 调用 runAutoUpdate (配置 autoUpdate=true, mock 版本不一致触发更新)
      3. 记录两个函数的调用顺序
      4. 断言 invalidatePackage 在 syncCachePackageJsonToIntent 之前被调用
    Expected Result: invalidatePackage.callIndex < syncCachePackageJsonToIntent.callIndex
    Failure Indicators: 顺序相反或缺少调用
    Evidence: .sisyphus/evidence/task-2-ordering.txt

  Scenario: [sync 写入的文件在 invalidate 后仍存在]
    Tool: Bash (bun test)
    Preconditions: 使用临时目录
    Steps:
      1. 创建 scopedDir 目录并放入旧 package.json
      2. 调用 invalidatePackage (删除旧内容)
      3. 调用 syncCachePackageJsonToIntent (写入新 package.json)
      4. 断言 scopedDir/package.json 存在且内容正确
    Expected Result: package.json 存在且包含正确的 dependencies
    Failure Indicators: 文件不存在或内容为旧版本
    Evidence: .sisyphus/evidence/task-2-sync-survives.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `fix(updater): correct sync/invalidate ordering in runAutoUpdate`
  - Files: `src/updater.ts, tests/updater.test.ts`
  - Pre-commit: `bun test tests/updater.test.ts`

- [x] 3. index.ts: 启动版本 toast + updater 在配置错误时运行

  **What to do**:
  - 在 index.ts 顶部导入 `getCurrentVersion` from `./updater.js`
  - 添加模块级变量：`let hasShownStartupToast = false`
  - 在 `session.created` 事件处理中（第 265-281 行附近），增加启动 toast 逻辑：
    - 条件：`!hasShownStartupToast && !isCliMode && !isSubSession`
    - 调用 `ctx.client.tui.showToast({ body: { title, message, variant, duration } }).catch(() => {})`
    - title: `ul-opencode-event v${version}`
    - message: 包含通道数信息，例如 `3 channels loaded (smtp, dingtalk, feishu)`
    - 如果有被过滤的通道，message 追加警告，例如 `(1 unknown channel type skipped)`
    - variant: `"success"`（正常）或 `"warning"`（有被过滤的通道）
    - duration: 3000
    - 用 `setTimeout(0)` 确保 TUI 就绪
    - 设置 `hasShownStartupToast = true`
  - 修改 loadConfig catch 块（第 238-241 行）— 配置错误时的弹框提示：
    - 保留 `return {}` 行为
    - 在 return 前，用 `setTimeout(0)` 做两件事：
      1. 弹出错误 toast，告知用户配置加载失败，详细错误在日志文件中
         - title: `ul-opencode-event Config Error`
         - message: `配置加载失败: ${error.message}\n详见日志: ~/.local/share/opencode/ul-opencode-event.log`
         - variant: `"error"`
         - duration: 8000
      2. 触发 `runAutoUpdate(ctx, true)` — 即使配置错误也尝试自愈更新
  - 需要将 `ctx` 参数保存到闭包变量中供 catch 块使用
  - 在 `channels.length === 0` 的 warn 分支（第 243-246 行）：也通过 toast 提示用户没有可用通道
    - title: `ul-opencode-event v${version}`
    - message: `插件已加载但没有启用的通知通道\n请检查配置文件`
    - variant: `"warning"`
  - 新增测试：
    - 测试 toast 在首次 session.created 时显示
    - 测试 toast 不会被显示两次
    - 测试 toast 包含版本号
    - 测试 loadConfig 失败时弹出错误 toast 且 updater 仍被调用
    - 测试无通道时弹出警告 toast
    - 测试 CLI 模式和子会话跳过 toast

  **Must NOT do**:
  - 不改变 handler.ts
  - 不改变 loadConfig 的返回类型
  - 不使用 spinner 动画 toast（太复杂且不必要）
  - 不在 catch 块中直接 await updater（用 setTimeout 异步触发）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 涉及插件入口逻辑修改，需要谨慎处理异步流程和测试 mock
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after Task 1)
  - **Blocks**: F1, F2
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/index.ts:234-241` - loadConfig catch 块，需要在此处确保 updater 运行
  - `src/index.ts:243-246` - 无通道时的 return {} 分支
  - `src/index.ts:265-281` - session.created 事件处理，updater 和 toast 的触发位置
  - `src/index.ts:228` - hasCheckedUpdate 标志位模式（参考）
  - `src/updater.ts:52-73` - getCurrentVersion() 实现
  - `src/updater.ts:446-460` - showToast helper 模式（参考）

  **API References**:
  - Toast API: `ctx.client.tui.showToast({ body: { title: string, message: string, variant: "info"|"success"|"warning"|"error", duration: number } })`
  - 需要 `.catch(() => {})` 防止 toast 失败导致崩溃
  - 需要 `setTimeout(fn, 0)` 确保 TUI 初始化完成

  **Test References**:
  - `tests/index.test.ts` - 现有插件初始化测试
  - `tests/updater.test.ts` - updater mock 模式参考

  **WHY Each Reference Matters**:
  - index.ts:238-241 是死锁的关键位置，需要在此处打破死锁
  - index.ts:265-281 是 toast 的插入位置
  - updater.ts 的 showToast helper 展示了安全的 toast 调用模式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: [启动 toast 正常显示]
    Tool: Bash (bun test)
    Preconditions: Mock ctx.client.tui.showToast，Mock loadConfig 返回有效配置
    Steps:
      1. 调用 NotificationPlugin(ctx) 获取插件对象
      2. 触发 event({ event: { type: 'session.created', properties: { info: { id: 'test', parentID: '' } } } })
      3. 等待 setTimeout(0) 执行
      4. 断言 showToast 被调用
      5. 断言 toast body.title 包含版本号 (例如 "v0.1.28")
      6. 断言 toast body.message 包含通道信息
      7. 断言 toast body.variant === "success"
    Expected Result: showToast 被调用一次，包含版本号和通道信息
    Failure Indicators: showToast 未被调用，或 title 不包含版本号
    Evidence: .sisyphus/evidence/task-3-startup-toast.txt

  Scenario: [toast 不重复显示]
    Tool: Bash (bun test)
    Preconditions: 同上
    Steps:
      1. 触发第一次 session.created
      2. 触发第二次 session.created
      3. 断言 showToast 仅被调用一次
    Expected Result: showToast 调用次数为 1
    Failure Indicators: showToast 被调用 2 次
    Evidence: .sisyphus/evidence/task-3-no-duplicate.txt

  Scenario: [loadConfig 失败时弹出错误 toast 且 updater 仍运行]
    Tool: Bash (bun test)
    Preconditions: Mock loadConfig 抛异常，Mock runAutoUpdate，Mock showToast
    Steps:
      1. 调用 NotificationPlugin(ctx)
      2. 触发 session.created 事件
      3. 等待 setTimeout
      4. 断言 showToast 被调用，body.variant === "error"，title 包含 "Config Error"
      5. 断言 toast body.message 包含 "详见日志" 和日志文件路径
      6. 断言 runAutoUpdate 被调用
    Expected Result: 错误 toast 显示错误摘要和日志路径，updater 不受影响
    Failure Indicators: runAutoUpdate 未被调用，或 toast 未显示
    Evidence: .sisyphus/evidence/task-3-updater-on-error.txt

  Scenario: [无通道时弹出警告 toast]
    Tool: Bash (bun test)
    Preconditions: Mock loadConfig 返回 { channels: [] }
    Steps:
      1. 调用 NotificationPlugin(ctx)
      2. 触发 session.created 事件
      3. 断言 showToast 被调用，body.variant === "warning"
      4. 断言 toast body.message 包含 "没有启用的通知通道"
    Expected Result: 警告 toast 提示用户检查配置
    Failure Indicators: 无 toast 或 toast variant 不是 warning
    Evidence: .sisyphus/evidence/task-3-no-channels.txt

  Scenario: [子会话和 CLI 模式跳过 toast]
    Tool: Bash (bun test)
    Preconditions: Mock process.env.OPENCODE_CLI_RUN_MODE = 'true'，或 parentID 非空
    Steps:
      1. 设置 CLI 模式环境变量
      2. 触发 session.created
      3. 断言 showToast 未被调用
    Expected Result: showToast 未被调用
    Failure Indicators: showToast 被调用
    Evidence: .sisyphus/evidence/task-3-skip-cli.txt
  ```

  **Commit**: YES
  - Message: `feat(index): add startup version toast and updater resilience`
  - Files: `src/index.ts, tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Full Test Suite + TypeCheck** — `quick`
  Run `bun test` and `npm run typecheck`. Verify zero failures and zero type errors.
  Output: `bun test [N pass / 0 fail] | tsc --noEmit [0 errors] | VERDICT`

- [x] F2. **Integration Verification** — `unspecified-high`
  Build with `npm run build`, then run `npx @ulthon/ul-opencode-event test` (dry-run). Verify:
  1. Config with unknown channel type doesn't crash
  2. Valid channels still work
  3. Version is displayed in output
  Output: `Build [PASS/FAIL] | CLI test [PASS/FAIL] | VERDICT`

---

## Commit Strategy

- **T1+T2**: `fix(config): validateChannelTypes warn+filter instead of throw, fix updater ordering`
- **T3**: `feat(index): add startup version toast and updater resilience`
- **Final**: `chore: bump version to 0.1.29`

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all tests pass
npm run typecheck           # Expected: no errors
npm run build               # Expected: clean build
npm run lint                # Expected: no errors
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] 启动 toast 在 session.created 时显示
- [ ] 未知通道类型不再导致插件崩溃
- [ ] updater 在配置错误时也能运行
