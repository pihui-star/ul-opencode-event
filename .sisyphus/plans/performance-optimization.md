# ul-opencode-event 全面性能优化

## TL;DR

> **Quick Summary**: 解决 OpenCode 启动时 "loading plugin" 阻塞问题，并全面优化插件运行时性能，包括 I/O 缓冲化、系统信息缓存、增量聚合计算。
> 
> **Deliverables**:
> - 通用写缓冲区模块 (`write-buffer.ts`)
> - 共享文件轮转模块 (`file-rotation.ts`)
> - 启动阶段零阻塞（preload 延迟执行）
> - Logger / File channel 写缓冲化（减少 90%+ fs 调用）
> - 系统信息缓存 + 版本号缓存
> - 增量项目级 token 聚合器
> - 完整的 TDD 测试覆盖
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: T1 → T6/T7 → T9

---

## Context

### Original Request
用户报告 OpenCode 启动时在 "loading plugin" 阶段卡住很长时间。要求制定全面的性能优化计划。

### Interview Summary
**Key Discussions**:
- `preloadTokenData()` 同步打开 SQLite 是启动阻塞的主因
- 插件有两套数据源：sessionCache (JSONL) + preloadTokenData (SQLite)，存在功能重叠
- recorder.ts 保持同步写入（调试数据可靠性），logger/file channel 可缓冲化
- 系统信息（IP、版本号）应缓存，避免重复计算
- 4 处重复的文件轮转代码应提取共享模块
- 项目级聚合可改为增量更新

**Research Findings**:
- `preloadTokenData` 使用 `bun:sqlite` 同步打开 opencode.db，可能与主进程写锁冲突
- `getCurrentVersion()` 每次递归遍历最多 10 层目录查找 package.json
- `getLocalIP()` 每个事件调用 `os.networkInterfaces()`
- `aggregateProjectTokens()` 每个事件遍历全部 session Map
- logger/file channel 每次写入都做 `fs.statSync` + `fs.appendFileSync`
- 4 处完全相同的轮转模式（读全文 → 保留后半 → 写回）

### Metis Review
**Identified Gaps** (addressed):
- 进程退出时需 flush 写缓冲区（SIGTERM/SIGINT hook）
- 增量聚合器需处理 preload 完成时的基数同步
- 多实例并发访问 JSONL 文件的风险（当前单实例，但需 guardrail）
- 缓冲区 flush 间隔需可配置（默认 500ms）

---

## Work Objectives

### Core Objective
消除插件加载对 OpenCode 启动的阻塞，并优化运行时每个事件处理的 I/O 和计算开销。

### Concrete Deliverables
- `src/write-buffer.ts` - 通用写缓冲区
- `src/file-rotation.ts` - 共享轮转逻辑
- 修改后的 `src/index.ts` - 延迟 preload + 增量聚合
- 修改后的 `src/logger.ts` - 缓冲化写入
- 修改后的 `src/file.ts` - 缓冲化写入
- 修改后的 `src/handler.ts` - 系统信息缓存
- 修改后的 `src/updater.ts` - 版本号缓存
- 完整的 TDD 测试文件

### Definition of Done
- [ ] `bun test` 全部通过
- [ ] 插件加载时间 < 10ms（无 SQLite 阻塞）
- [ ] 每个事件的 fs 调用次数从 3-5 次减少到 0（缓冲化期间）
- [ ] 通知内容和格式与优化前完全一致（无行为变更）

### Must Have
- preloadTokenData 延迟到 setTimeout 执行
- Logger 写缓冲化
- File channel 写缓冲化
- 系统信息缓存
- 版本号缓存
- 进程退出时 flush 缓冲区
- TDD 测试覆盖所有新代码

### Must NOT Have (Guardrails)
- 不改变 Plugin 外部接口（`NotificationPlugin` 签名不变）
- 不改变通知输出内容和格式
- 不改变配置文件格式
- 不改变 recorder.ts 的同步写入行为
- 不引入新的外部依赖
- 不优化网络操作（已经异步，非瓶颈）
- 不重构 auto-update 模块
- 不改变 sessionCache JSONL 文件格式
- AI slop 防范：不为缓存/缓冲添加过度注释，不创建不必要的抽象层

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: bun test
- **Each task**: 先写失败测试 → 最小实现通过 → 重构优化

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Module/Unit**: Use Bash (`bun test`) - Import, call functions, compare output
- **Integration**: Use Bash (`bun test`) - Test buffer flush, rotation, preload timing

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation + caching):
+-- T1: 通用写缓冲区模块 [quick]
+-- T2: 共享文件轮转模块 [quick]
+-- T3: 系统信息缓存 + 版本号缓存 [quick]

Wave 2 (After Wave 1 - startup optimization):
+-- T4: preloadTokenData 延迟执行 (depends: none) [quick]
+-- T5: sessionCache 延迟加载 (depends: none) [quick]

Wave 3 (After Wave 1 - runtime I/O optimization):
+-- T6: Logger 写缓冲化 (depends: T1, T2) [unspecified-high]
+-- T7: File channel 写缓冲化 (depends: T1, T2) [unspecified-high]

Wave 4 (After Wave 2,3 - aggregation optimization):
+-- T8: 增量项目级聚合器 (depends: T4, T5) [deep]

Wave FINAL (After ALL tasks):
+-- F1: Plan compliance audit (oracle)
+-- F2: Code quality review (unspecified-high)
+-- F3: Real manual QA (unspecified-high)
+-- F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 → T6/T7 → Integration
Max Concurrent: 3 (Wave 1), 2 (Wave 2), 2 (Wave 3), 1 (Wave 4)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| T1   | -         | T6, T7 | 1    |
| T2   | -         | T6, T7 | 1    |
| T3   | -         | -      | 1    |
| T4   | -         | T8     | 2    |
| T5   | -         | T8     | 2    |
| T6   | T1, T2    | -      | 3    |
| T7   | T1, T2    | -      | 3    |
| T8   | T4, T5    | -      | 4    |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks - T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: 2 tasks - T4 → `quick`, T5 → `quick`
- **Wave 3**: 2 tasks - T6 → `unspecified-high`, T7 → `unspecified-high`
- **Wave 4**: 1 task - T8 → `deep`
- **FINAL**: 4 tasks - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. 通用写缓冲区模块

  **What to do**:
  - 创建 `src/write-buffer.ts`，实现通用写缓冲区类 `WriteBuffer`
  - 构造参数：`filePath`, `flushInterval`(默认 500ms), `maxBatchSize`(默认 50 条), `maxSizeBytes`(用于轮转检查)
  - API：`append(line: string)` 累积到内存缓冲区，`flush()` 批量写入文件，`close()` flush + 清理定时器
  - 内部维护：缓冲区数组 `string[]`，定时器 `setInterval`，文件大小累计计数器（避免每次 statSync）
  - 进程退出 hook：注册 `process.on('exit')` 确保缓冲区 flush
  - TDD：先写测试 `tests/write-buffer.test.ts`
    - 测试 1：append 后未到 flush 间隔，文件不存在
    - 测试 2：flush 间隔到达后，内容写入文件
    - 测试 3：超过 maxBatchSize 触发立即 flush
    - 测试 4：close() 确保所有数据写入
    - 测试 5：文件大小计数器正确累计

  **Must NOT do**:
  - 不引入外部依赖
  - 不实现复杂的写入队列/重试逻辑
  - 不处理多进程并发写入

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单一新文件，逻辑清晰，< 100 行
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3)
  - **Blocks**: T6, T7
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/recorder.ts:93-110` - 当前的 appendFileSync + statSync + rotation 模式（WriteBuffer 将替代此模式的调用方）
  - `src/logger.ts:107-124` - 同样的 statSync + appendFileSync 模式

  **External References**:
  - Node.js `process.on('exit')` hook - 确保同步 flush（exit hook 中只能用同步操作）

  **WHY Each Reference Matters**:
  - recorder.ts 和 logger.ts 展示了当前 WriteBuffer 需要替代的调用模式
  - process.exit hook 要求 flush 必须是同步操作

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] Test file created: tests/write-buffer.test.ts
  - [ ] bun test tests/write-buffer.test.ts → PASS (5 tests, 0 failures)

  **QA Scenarios:**

  ```
  Scenario: Write buffer batches multiple appends into single flush
    Tool: Bash (bun test)
    Preconditions: Clean test environment
    Steps:
      1. Run `bun test tests/write-buffer.test.ts`
      2. Verify "5 pass, 0 fail" in output
    Expected Result: All 5 test cases pass
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-1-write-buffer-tests.txt

  Scenario: Buffer flushes on close even if interval not reached
    Tool: Bash (bun test)
    Preconditions: Test environment
    Steps:
      1. Run `bun test tests/write-buffer.test.ts`
      2. Verify close-flush test passes
    Expected Result: File contains buffered data after close()
    Failure Indicators: close-flush test fails
    Evidence: .sisyphus/evidence/task-1-close-flush.txt
  ```

  **Commit**: YES (groups with T2)
  - Message: `perf: add write-buffer and file-rotation shared modules`
  - Files: `src/write-buffer.ts, tests/write-buffer.test.ts`
  - Pre-commit: `bun test tests/write-buffer.test.ts`

- [x] 2. 共享文件轮转模块

  **What to do**:
  - 创建 `src/file-rotation.ts`，提取 4 处重复的轮转逻辑为共享函数
  - API：`rotateFile(filePath: string, maxSizeBytes: number, truncateMarker?: string): boolean`
  - 逻辑：读取文件 → 找到中点后的换行符 → 保留后半 → 写回
  - 优化：使用 `fs.truncateSync` + `fs.readSync` 的流式方式，避免将整个文件读入内存（当前方案对 2MB 文件可接受，但可改进）
  - TDD：先写测试 `tests/file-rotation.test.ts`
    - 测试 1：文件未超限时不触发轮转
    - 测试 2：文件超限时正确截断保留后半
    - 测试 3：空文件不报错
    - 测试 4：截断标记正确写入

  **Must NOT do**:
  - 不改变现有轮转的行为（保留后半、换行对齐）
  - 不引入流式读取（当前同步读取 2MB 文件可接受，YAGNI）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯函数提取，逻辑清晰
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3)
  - **Blocks**: T6, T7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/logger.ts:87-103` - truncate() 函数（4 处轮转实现的代表）
  - `src/recorder.ts:67-79` - 相同的 truncate() 模式
  - `src/session-cache.ts:50-63` - 相同的 truncate() 模式
  - `src/file.ts:130-147` - rotateFile() 相同模式

  **WHY Each Reference Matters**:
  - 这 4 处是直接要提取的代码，新模块应保持完全相同的行为

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/file-rotation.test.ts
  - [ ] bun test tests/file-rotation.test.ts → PASS (4 tests, 0 failures)

  **QA Scenarios:**

  ```
  Scenario: File rotation preserves newer half content
    Tool: Bash (bun test)
    Preconditions: Test file with known content
    Steps:
      1. Run `bun test tests/file-rotation.test.ts`
    Expected Result: All 4 tests pass
    Evidence: .sisyphus/evidence/task-2-rotation-tests.txt
  ```

  **Commit**: YES (groups with T1)
  - Message: `perf: add write-buffer and file-rotation shared modules`
  - Files: `src/file-rotation.ts, tests/file-rotation.test.ts`
  - Pre-commit: `bun test tests/file-rotation.test.ts`

- [x] 3. 系统信息缓存 + 版本号缓存

  **What to do**:
  - `src/handler.ts`: 缓存 `getLocalIP()` 返回值到模块级变量，首次调用后不再重复调用 `os.networkInterfaces()`
  - `src/handler.ts`: 缓存 `formatSystemUptime(os.uptime())` 结果，设置 60s TTL
  - `src/updater.ts`: 缓存 `getCurrentVersion()` 结果到模块级变量，避免每次 createEventHandler 都做文件系统遍历
  - TDD：为每个缓存函数添加测试
    - 测试 getLocalIP 缓存：第一次调用后 mock os.networkInterfaces 抛异常，验证第二次仍返回缓存值
    - 测试 getCurrentVersion 缓存：第一次调用后再次调用，验证只执行一次文件遍历
    - 测试 uptime TTL：60s 内返回缓存值，超时后刷新

  **Must NOT do**:
  - 不改变 getLocalIP 的过滤逻辑
  - 不改变 getCurrentVersion 的遍历逻辑
  - 不引入 LRU 或复杂缓存淘汰策略（简单的变量缓存即可）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 3 个小改动，每个 < 10 行
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/handler.ts:72-88` - getLocalIP() 当前实现，每次调用 os.networkInterfaces()
  - `src/handler.ts:52-66` - formatSystemUptime() 当前实现
  - `src/handler.ts:131-139` - staticSystemInfo 收集点（getCurrentVersion 在此处调用）
  - `src/updater.ts:52-74` - getCurrentVersion() 当前实现，递归遍历文件系统

  **WHY Each Reference Matters**:
  - handler.ts 的 staticSystemInfo 是系统信息缓存的注入点
  - updater.ts 的 getCurrentVersion 是版本号缓存的改造点

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests added to: tests/handler.test.ts, tests/updater.test.ts
  - [ ] bun test → PASS

  **QA Scenarios:**

  ```
  Scenario: getLocalIP returns cached value on second call
    Tool: Bash (bun test)
    Preconditions: Test environment with mocked os module
    Steps:
      1. Run relevant tests in tests/handler.test.ts
    Expected Result: os.networkInterfaces called only once
    Evidence: .sisyphus/evidence/task-3-ip-cache.txt

  Scenario: getCurrentVersion returns cached result without filesystem walk
    Tool: Bash (bun test)
    Steps:
      1. Run relevant tests in tests/updater.test.ts
    Expected Result: fs.readFileSync called only once
    Evidence: .sisyphus/evidence/task-3-version-cache.txt
  ```

  **Commit**: YES
  - Message: `perf: cache system info and version to avoid repeated computation`
  - Files: `src/handler.ts, src/updater.ts, tests/handler.test.ts, tests/updater.test.ts`
  - Pre-commit: `bun test`

- [x] 4. preloadTokenData 延迟执行

  **What to do**:
  - 修改 `src/index.ts` 中 `preloadTokenData` 的调用方式：从同步执行改为 `setTimeout(() => { ... }, 0)`
  - 在 preload 完成后设置一个标志位 `isPreloaded = true`，用于 T8 增量聚合器的基数同步
  - 确保 tokenDataMap 在 preload 完成前为空 Map 是安全的（fillTokenData 已处理空 Map 情况）
  - 移除 `db-preload.ts` 顶层 `import { Database } from 'bun:sqlite'`，改为函数内部动态导入（避免模块加载时即引入 bun:sqlite）
  - TDD：测试 `tests/index-preload.test.ts`
    - 测试 1：preload 未完成时，事件处理正常（token 为 0）
    - 测试 2：preload 完成后，事件处理使用预加载数据
    - 测试 3：preload 失败不影响插件功能

  **Must NOT do**:
  - 不删除 preloadTokenData 功能
  - 不改变 preloadTokenData 的数据加载逻辑
  - 不改变 tokenDataMap 的数据结构

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 改动集中在 index.ts 的 5 行代码 + db-preload.ts 的 import 位置
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T5)
  - **Blocks**: T8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/index.ts:647-651` - 当前同步调用 preloadTokenData 的位置
  - `src/db-preload.ts:1-8` - 顶层 `import { Database } from 'bun:sqlite'`，需移到函数内

  **API/Type References**:
  - `src/types.ts:SessionTokenData` - tokenDataMap 的值类型，确认空 Map 安全

  **WHY Each Reference Matters**:
  - index.ts 647-651 是核心改动点：同步 → setTimeout
  - db-preload.ts 的顶层 import 会在模块被动态导入时评估，即使 preload 在 setTimeout 中，import 仍然可能触发 bun:sqlite 加载

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/index-preload.test.ts
  - [ ] bun test tests/index-preload.test.ts → PASS

  **QA Scenarios:**

  ```
  Scenario: Plugin returns immediately without waiting for preload
    Tool: Bash (bun test)
    Preconditions: Mock db-preload to take 500ms
    Steps:
      1. Run test that verifies NotificationPlugin resolves in < 50ms
    Expected Result: Plugin init < 50ms, preload runs in background
    Evidence: .sisyphus/evidence/task-4-deferred-preload.txt

  Scenario: Preload failure does not crash plugin
    Tool: Bash (bun test)
    Preconditions: Mock db-preload to throw error
    Steps:
      1. Verify plugin still returns valid event handler
      2. Verify events can be handled with empty tokenDataMap
    Expected Result: No crash, events processed with zero tokens
    Evidence: .sisyphus/evidence/task-4-preload-error.txt
  ```

  **Commit**: YES (groups with T5)
  - Message: `perf: defer preloadTokenData and sessionCache loading off startup critical path`
  - Files: `src/index.ts, src/db-preload.ts, tests/index-preload.test.ts`
  - Pre-commit: `bun test`

- [x] 5. sessionCache 延迟加载

  **What to do**:
  - 修改 `src/index.ts` 中 `loadSessionCache(baseDir)` 的调用方式：从同步执行改为 setTimeout 延迟
  - sessionCache 在加载完成前为空 Map，`fillProjectData` 中 `aggregateProjectFromCache` 会返回全零，功能安全
  - 加载完成后设置标志位，用于后续判断
  - TDD：测试 `tests/session-cache-lazy.test.ts`
    - 测试 1：sessionCache 未加载时，fillProjectData 返回全零
    - 测试 2：sessionCache 加载后，fillProjectData 使用缓存数据

  **Must NOT do**:
  - 不改变 loadSessionCache 的逻辑
  - 不改变 sessionCache 的文件格式

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 3-5 行代码改动
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4)
  - **Blocks**: T8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/index.ts:655` - 当前同步调用 `let sessionCache = loadSessionCache(baseDir);`
  - `src/session-cache.ts:74-111` - loadSessionCache 实现

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests added to: tests/session-cache-lazy.test.ts
  - [ ] bun test → PASS

  **QA Scenarios:**

  ```
  Scenario: Plugin init completes before sessionCache loads
    Tool: Bash (bun test)
    Steps:
      1. Verify loadSessionCache is called via setTimeout
      2. Verify plugin returns immediately
    Expected Result: sessionCache starts as empty Map
    Evidence: .sisyphus/evidence/task-5-lazy-cache.txt
  ```

  **Commit**: YES (groups with T4)
  - Message: `perf: defer preloadTokenData and sessionCache loading off startup critical path`
  - Files: `src/index.ts, tests/session-cache-lazy.test.ts`
  - Pre-commit: `bun test`

- [x] 6. Logger 写缓冲化

  **What to do**:
  - 修改 `src/logger.ts`，将 `fs.appendFileSync` 替换为 T1 的 WriteBuffer
  - `createLogger` 返回的 logger 内部使用 WriteBuffer 实例
  - 移除每次 write 时的 `fs.statSync` 大小检查，改为 WriteBuffer 内部的累计计数
  - 轮转逻辑使用 T2 的 `rotateFile`
  - 保持 `logger.debug/info/warn/error` 接口完全不变
  - `process.on('exit')` hook 注册在 WriteBuffer 中，确保日志不丢失
  - TDD：修改 `tests/logger.test.ts`（如已有）或新增
    - 测试 1：快速连续调用 10 次 logger.info，验证只有 1-2 次 flush
    - 测试 2：close() 后所有日志已写入文件
    - 测试 3：日志格式与优化前完全一致

  **Must NOT do**:
  - 不改变 logger 的公开 API
  - 不改变日志格式
  - 不引入异步日志（保持接口为同步，内部缓冲）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要仔细保持接口兼容，是全局使用的模块
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T7)
  - **Blocks**: None
  - **Blocked By**: T1, T2

  **References**:

  **Pattern References**:
  - `src/logger.ts:77-149` - createLogger 工厂函数和 write 内部函数
  - `src/logger.ts:107-124` - 当前的 statSync + appendFileSync + truncate 逻辑（需替换）
  - `src/write-buffer.ts` - T1 创建的 WriteBuffer 类（依赖）

  **WHY Each Reference Matters**:
  - logger.ts 是改造目标
  - write-buffer.ts 是替代方案

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests exist for buffered logger behavior
  - [ ] bun test → PASS

  **QA Scenarios:**

  ```
  Scenario: Logger batches multiple rapid writes
    Tool: Bash (bun test)
    Steps:
      1. Call logger.info() 10 times rapidly
      2. Verify fewer than 10 actual fs writes (buffered)
      3. Call logger close/flush
      4. Verify all 10 lines in file
    Expected Result: All 10 lines present, fewer fs calls
    Evidence: .sisyphus/evidence/task-6-logger-buffer.txt

  Scenario: Logger format unchanged after optimization
    Tool: Bash (bun test)
    Steps:
      1. Write a known log line
      2. Read output file
      3. Verify format matches: YYYY-MM-DDTHH:mm:ss.sssZ [ul-opencode-event] [LEVEL] message
    Expected Result: Exact format match
    Evidence: .sisyphus/evidence/task-6-logger-format.txt
  ```

  **Commit**: YES (groups with T7)
  - Message: `perf: buffer logger and file channel writes to reduce fs calls`
  - Files: `src/logger.ts, tests/logger.test.ts`
  - Pre-commit: `bun test`

- [x] 7. File channel 写缓冲化

  **What to do**:
  - 修改 `src/file.ts`，将 `fs.appendFileSync` 替换为 T1 的 WriteBuffer
  - 每个 FileSender 实例内部使用独立的 WriteBuffer
  - 移除每次 send 时的 `fs.statSync` 大小检查
  - 轮转逻辑使用 T2 的 `rotateFile`
  - 保持 `ChannelSender.send/close` 接口不变
  - close() 时确保 flush 缓冲区
  - TDD：修改 `tests/file.test.ts`
    - 测试 1：连续 send 10 条消息，验证缓冲后批量写入
    - 测试 2：close() 后所有消息已写入文件
    - 测试 3：JSON Lines 格式与优化前一致（每行一个 JSON 对象）

  **Must NOT do**:
  - 不改变 ChannelSender 接口
  - 不改变 JSONL 输出格式
  - 不引入异步 send（保持 Promise<void> 返回但内部同步缓冲）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要确保 JSONL 格式兼容
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T6)
  - **Blocks**: None
  - **Blocked By**: T1, T2

  **References**:

  **Pattern References**:
  - `src/file.ts:82-108` - 当前 send() 方法中的 statSync + appendFileSync 逻辑
  - `src/file.ts:130-147` - 当前 rotateFile() 函数
  - `src/write-buffer.ts` - T1 创建的 WriteBuffer 类

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests exist for buffered file channel
  - [ ] bun test → PASS

  **QA Scenarios:**

  ```
  Scenario: File channel batches writes and preserves JSONL format
    Tool: Bash (bun test)
    Steps:
      1. Send 10 messages via file channel
      2. Verify all 10 JSON lines present after flush
      3. Verify each line is valid JSON
    Expected Result: 10 valid JSON lines
    Evidence: .sisyphus/evidence/task-7-file-buffer.txt
  ```

  **Commit**: YES (groups with T6)
  - Message: `perf: buffer logger and file channel writes to reduce fs calls`
  - Files: `src/file.ts, tests/file.test.ts`
  - Pre-commit: `bun test`

- [x] 8. 增量项目级聚合器

  **What to do**:
  - 在 `src/index.ts` 中新增 `projectAgg` 计数器对象：`{ cost: number, tokens: TokenBreakdown }`
  - `message.updated` 事件处理中：当 assistant 消息的 token 数据更新时，增量更新 projectAgg（+delta）
  - `preloadTokenData` 完成时：遍历预加载的数据初始化 projectAgg 基数
  - `sessionCache` 加载完成时：将 cache 中的聚合数据加入 projectAgg 基数
  - `fillProjectData` 改为直接使用 projectAgg，不再遍历 tokenDataMap 和 sessionCache
  - 注意去重：预加载数据和 sessionCache 可能重叠（同一 sessionId），需要排除已在 sessionCache 中的会话
  - TDD：测试 `tests/incremental-agg.test.ts`
    - 测试 1：初始状态 projectAgg 为零
    - 测试 2：单条 message.updated 正确增量更新
    - 测试 3：preload 完成后基数正确
    - 测试 4：sessionCache 加载后基数正确
    - 测试 5：去重逻辑正确（sessionCache + preload 不重复计数）
    - 测试 6：fillProjectData 使用 projectAgg 而非遍历

  **Must NOT do**:
  - 不改变通知输出的 token 数值（必须与优化前完全一致）
  - 不改变 tokenDataMap 或 sessionCache 的数据结构
  - 不引入浮点精度问题（cost 累加需注意精度）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解整个 token 聚合链路，确保增量更新与全量扫描结果一致
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential)
  - **Blocks**: None
  - **Blocked By**: T4, T5

  **References**:

  **Pattern References**:
  - `src/index.ts:466-492` - aggregateProjectTokens() 当前全量扫描实现
  - `src/index.ts:498-542` - fillProjectData() 当前实现（dual-source: cache + live）
  - `src/index.ts:745-798` - message.updated 事件处理，token 数据注入 tokenDataMap 的位置
  - `src/index.ts:855-880` - cache write 逻辑

  **API/Type References**:
  - `src/types.ts:TokenBreakdown` - token 聚合的数据结构
  - `src/types.ts:SessionCacheEntry` - sessionCache 条目类型
  - `src/session-cache.ts:144-178` - aggregateProjectFromCache() 当前实现

  **WHY Each Reference Matters**:
  - aggregateProjectTokens 是被替代的函数，需确保增量结果一致
  - fillProjectData 是消费者，需改为使用 projectAgg
  - message.updated 是增量更新的触发点
  - 去重是关键难点：sessionCache 已包含的会话不应被 preload 重复计数

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/incremental-agg.test.ts
  - [ ] bun test tests/incremental-agg.test.ts → PASS (6 tests, 0 failures)

  **QA Scenarios:**

  ```
  Scenario: Incremental aggregation matches full scan result
    Tool: Bash (bun test)
    Steps:
      1. Simulate 5 sessions with known token data
      2. Compare projectAgg with aggregateProjectTokens() full scan
      3. Verify exact numerical match
    Expected Result: projectAgg === full scan result for all fields
    Failure Indicators: Any numerical difference
    Evidence: .sisyphus/evidence/task-8-agg-match.txt

  Scenario: Deduplication between preload and sessionCache
    Tool: Bash (bun test)
    Steps:
      1. Load sessionCache with sessions A, B, C
      2. Preload with sessions B, C, D (overlap on B, C)
      3. Verify projectAgg counts A + B + C + D (not double B, C)
    Expected Result: No double-counting of overlapping sessions
    Evidence: .sisyphus/evidence/task-8-dedup.txt
  ```

  **Commit**: YES
  - Message: `perf: incremental project-level token aggregation`
  - Files: `src/index.ts, tests/incremental-agg.test.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `tsc --noEmit` + `bun test` + `bun run lint`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, unused imports, AI slop patterns.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  Build the plugin, run `npx @ulthon/ul-opencode-event test` to verify CLI still works. Start OpenCode with the plugin and verify: startup not blocked, notifications still sent, token counts accurate.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **T1+T2**: `perf: add write-buffer and file-rotation shared modules` - src/write-buffer.ts, src/file-rotation.ts, tests/
- **T3**: `perf: cache system info and version to avoid repeated computation` - src/handler.ts, src/updater.ts, tests/
- **T4+T5**: `perf: defer preloadTokenData and sessionCache loading off startup critical path` - src/index.ts, tests/
- **T6+T7**: `perf: buffer logger and file channel writes to reduce fs calls` - src/logger.ts, src/file.ts, tests/
- **T8**: `perf: incremental project-level token aggregation` - src/index.ts, tests/

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all tests pass
bun run typecheck           # Expected: no errors
bun run lint                # Expected: no errors
npm run build               # Expected: clean build
npx @ulthon/ul-opencode-event test  # Expected: CLI works
```

### Performance Benchmarks
```bash
# Startup time: plugin init should complete in < 10ms (no SQLite blocking)
# I/O reduction: fs calls per event should drop from ~5 to ~0 (buffered)
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Plugin loads without blocking OpenCode startup
- [ ] Notification content unchanged
- [ ] Token aggregation accuracy maintained
