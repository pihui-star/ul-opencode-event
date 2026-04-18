# 事件变量录制器 (Event Variable Recorder)

## TL;DR

> **Quick Summary**: 新增系统级事件变量录制机制，将 handler.ts 中构建的全部模板变量（约42个字段）以 JSON Lines 格式写入独立文件，2MB 轮转，始终开启。
> 
> **Deliverables**:
> - `src/recorder.ts` - 事件变量录制模块（新建）
> - `src/handler.ts` - 提取 variables 构建逻辑 + 集成 recorder 调用（重构）
> - `tests/recorder.test.ts` - 录制器测试（新建）
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - 3个任务有严格依赖关系
> **Critical Path**: Task 1 (recorder.ts) -> Task 2 (handler.ts refactor) -> Task 3 (tests)

---

## Context

### Original Request
用户需要记录所有事件变量的完整值到独立文件。当前的 file channel 记录的是 EventPayload + 渲染后的 subject/body，但模板引擎能看到的 variables 对象（含 formatTokenCount 人类可读格式、String() 转换后的 token 明细等衍生字段）并未被完整记录。需要一个系统级行为（不是渠道），始终开启，独立于配置。

### Interview Summary
**Key Discussions**:
- 格式选择: JSON Lines（每行一条事件），方便后续 jq/脚本分析
- 开关控制: 始终开启，不需要配置项
- 变量范围: handler.ts 中 variables 对象的全部字段（含人类可读 token 格式）
- 轮转大小: 2MB（同 logger.ts）
- 文件独立: 不和现有日志/消息文件混合

**Research Findings**:
- handler.ts lines 133-189 构建 variables 对象，约42个字段
- variables 对象依赖仅 payload，不依赖 channel（可安全提取到循环外）
- logger.ts 使用 2MB truncate-in-place 轮转模式（需复用）
- file.ts 已记录 EventPayload + subject/body 到 messages.log（不同目的）

### Metis Review
**Identified Gaps** (addressed):
- **variables 在 channel 循环内**: 需要提取到循环外，因为仅依赖 payload 不依赖 channel
- **undefined 值在 JSON.stringify 中被省略**: 接受此行为，不同事件类型自然有不同字段集
- **空 channels 数组导致 handler 不被调用**: 可接受，插件未配置时不记录是合理的
- **并发写入轮转非原子性**: 与 logger.ts 相同的已知限制，接受
- **createRequire vs 标准导入**: 使用标准 `import * as fs`（同 logger.ts，非 file.ts）

---

## Work Objectives

### Core Objective
新增系统级事件变量录制机制，将每次事件的全部模板变量以 JSON Lines 格式写入独立文件。

### Concrete Deliverables
- `src/recorder.ts` - 新模块，约80行
- `src/handler.ts` - 重构：提取 variables 构建 + 新增 recorder 调用
- `tests/recorder.test.ts` - 新测试文件

### Definition of Done
- [ ] `bun test` 全部通过（含现有测试无回归）
- [ ] `bun run typecheck` 通过
- [ ] `bun run lint` 通过
- [ ] 事件触发后 `~/.local/share/opencode/ul-opencode-event-variables.jsonl` 存在且每行为合法 JSON

### Must Have
- JSON Lines 格式输出（每行一条 `JSON.parse` 合法的 JSON）
- 2MB 轮转（truncate-in-place，保留新半部分，行边界对齐）
- 始终开启，零配置
- 独立文件路径：`~/.local/share/opencode/ul-opencode-event-variables.jsonl`
- 支持 `OPENCODE_DATA_DIR` 环境变量
- 同步 I/O，零外部依赖
- 录制器失败不阻塞渠道通知

### Must NOT Have (Guardrails)
- 不新增 ChannelType 或修改 types.ts
- 不修改 index.ts（包入口）
- 不修改 file.ts（现有 file channel）
- 不修改 logger.ts
- 不为 recorder 添加配置选项
- 不在 variables 对象中改 null/undefined 处理（保持原样，JSON.stringify 自然省略 undefined）
- 不使用 createRequire（使用标准 import，同 logger.ts）
- 不将 recorder 从包入口导出
- 不将轮转标记改为 JSON 格式（保持文本标记 `[TRUNCATED]`，消费者应跳过非 JSON 行）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (tests-after)
- **Framework**: bun test (bun:test)
- **Test file**: `tests/recorder.test.ts`

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test, node REPL) - Import, call functions, verify output
- **File I/O**: Use Bash - Check file exists, contents, rotation behavior

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Sequential - dependency chain):
├── Task 1: Create recorder.ts module [quick]
├── Task 2: Refactor handler.ts + integrate recorder [quick]
└── Task 3: Add recorder tests [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 2 -> Task 3 -> F1-F4 -> user okay
Parallel Speedup: N/A (sequential dependency chain)
Max Concurrent: 1
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | - | 2 |
| 2 | 1 | 3 |
| 3 | 2 | F1-F4 |
| F1-F4 | 1,2,3 | user okay |

### Agent Dispatch Summary

- **Wave 1**: Task 1 -> `quick`, Task 2 -> `quick`, Task 3 -> `quick`
- **FINAL**: F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. 创建 `src/recorder.ts` 模块

  **What to do**:
  - 新建 `src/recorder.ts`，实现事件变量录制器
  - 导出 `recordEventVariables(variables: Record<string, string | undefined>): void` 函数
  - 文件路径解析：复用 logger.ts 的 `resolveLogPath` 模式，默认 `~/.local/share/opencode/ul-opencode-event-variables.jsonl`，支持 `OPENCODE_DATA_DIR` 环境变量
  - 轮转：2MB (`2 * 1024 * 1024`)，truncate-in-place 保留新半部分（行边界对齐），与 logger.ts 完全一致的轮转模式
  - 写入：`JSON.stringify(variables) + '\n'`，`fs.appendFileSync`
  - 目录自动创建：`fs.mkdirSync(dir, { recursive: true })`
  - 错误处理：所有 I/O 操作 try/catch 包裹，失败时静默（使用 logger.error 记录），不抛出异常
  - 使用标准 `import * as fs from 'node:fs'`（不使用 createRequire）
  - 轮转标记：`[TRUNCATED] ... old records dropped\n`（非 JSON 格式，消费者应跳过非 JSON 行）

  **Must NOT do**:
  - 不使用 createRequire
  - 不依赖 NotificationConfig
  - 不添加配置选项
  - 不从包入口导出

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件创建，模式清晰（复用 logger.ts），约80行代码
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - 无需特殊技能，纯 Node.js fs 操作

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential)
  - **Blocks**: Task 2
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/logger.ts:53-61` - 文件路径解析模式（`resolveLogPath` 函数，支持 OPENCODE_DATA_DIR）
  - `src/logger.ts:87-104` - 轮转逻辑（truncate-in-place，保留新半部分，行边界对齐）
  - `src/logger.ts:107-141` - 核心写入逻辑（stat 检查大小 -> truncate -> appendFileSync，try/catch 包裹）
  - `src/logger.ts:44-46` - 常量定义模式（DEFAULT_MAX_SIZE_BYTES, TRUNCATE_MARKER）

  **API/Type References**:
  - `src/handler.ts:133-189` - variables 对象结构（recorder 将接收此对象的引用）

  **WHY Each Reference Matters**:
  - logger.ts:53-61: recorder 的文件路径解析必须与此完全一致，确保日志文件和变量文件在同一目录
  - logger.ts:87-104: 轮转模式必须精确复制，保证行为一致性
  - logger.ts:107-141: 写入模式（stat-check -> rotate -> append）是生产验证过的安全模式
  - handler.ts:133-189: recorder 的输入类型定义依据，确保接收正确的数据结构

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 首次写入创建文件
    Tool: Bash (node -e / bun test)
    Preconditions: 文件不存在（使用 os.tmpdir() 隔离测试）
    Steps:
      1. 调用 recordEventVariables({eventType: 'idle', timestamp: '2024-01-01T00:00:00Z', projectName: 'test'})
      2. 检查文件是否存在：fs.existsSync(filePath)
      3. 读取文件内容，验证每行可 JSON.parse
      4. 验证 JSON 对象包含 eventType: 'idle', projectName: 'test'
    Expected Result: 文件存在，包含1行合法 JSON
    Failure Indicators: 文件不存在，JSON.parse 抛出，字段缺失
    Evidence: .sisyphus/evidence/task-1-create-file.txt

  Scenario: 轮转在文件超过 2MB 时触发
    Tool: Bash (bun test)
    Preconditions: 文件接近 2MB 大小（使用小 maxSizeBytes 参数测试，如 1024 字节）
    Steps:
      1. 使用自定义小 maxSizeBytes 创建 recorder（需支持构造参数注入或通过环境变量）
      2. 写入足够数据触发轮转
      3. 检查文件首行包含 [TRUNCATED]
      4. 检查后续每行可 JSON.parse
    Expected Result: 轮转触发，文件以 [TRUNCATED] 开头，后续行合法
    Failure Indicators: 文件超过 maxSizeBytes，或轮转后首行不是 [TRUNCATED]
    Evidence: .sisyphus/evidence/task-1-rotation.txt

  Scenario: I/O 错误不抛出异常
    Tool: Bash (bun test)
    Preconditions: 目标目录为只读或不存在
    Steps:
      1. 设置 filePath 为不可写路径（如 '/nonexistent/dir/file.jsonl'）
      2. 调用 recordEventVariables(...)
      3. 验证函数正常返回（不抛出异常）
    Expected Result: 函数返回，不抛出异常（错误被内部 catch）
    Failure Indicators: 函数抛出异常
    Evidence: .sisyphus/evidence/task-1-error-handling.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-create-file.txt - 首次写入测试输出
  - [ ] task-1-rotation.txt - 轮转测试输出
  - [ ] task-1-error-handling.txt - 错误容忍测试输出

  **Commit**: YES (groups with 2, 3)
  - Message: `feat(recorder): 添加系统级事件变量录制器`
  - Files: `src/recorder.ts, src/handler.ts, tests/recorder.test.ts`
  - Pre-commit: `bun run typecheck && bun test`

- [x] 2. 重构 handler.ts 提取 variables 构建 + 集成 recorder

  **What to do**:
  - 将 `handler.ts` 中 `variables` 对象构建逻辑（lines 133-189）从 channel 循环内提取到循环外
  - 提取后的 `variables` 构建仅依赖 `payload` 参数，不依赖 `channel`，因此提取是安全的
  - 在 variables 构建之后、channel 循环之前，调用 `recordEventVariables(variables)`
  - 导入 recorder：`import { recordEventVariables } from './recorder.js'`
  - 调用位置：`handle()` 函数内，在 channel 循环（line 118）之前
  - 验证：提取后模板渲染逻辑不变，所有 channel 仍使用相同的 variables 对象

  **Must NOT do**:
  - 不改变 variables 对象的字段名、值、undefined 处理方式
  - 不修改模板渲染逻辑
  - 不修改 EVENT_DEFAULTS
  - 不修改 formatTokenCount 函数

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 代码移动 + 1行导入 + 1行调用，纯重构
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - 无需特殊技能

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/handler.ts:118-214` - 当前 handle() 函数完整结构（需要理解循环边界）
  - `src/handler.ts:133-189` - variables 构建逻辑（需要提取到 line 118 之前）
  - `src/handler.ts:191-193` - 模板渲染（renderTemplate 调用，提取后不变）
  - `src/handler.ts:8-12` - 导入区域（需要新增 recorder 导入）

  **API/Type References**:
  - `src/recorder.ts` - recorder 模块导出的 `recordEventVariables` 函数签名

  **Test References**:
  - `tests/handler.test.ts` - 现有 handler 测试，提取后必须全部通过

  **WHY Each Reference Matters**:
  - handler.ts:118-214: 需要精确理解循环结构，确定提取边界
  - handler.ts:133-189: 这是要移动的代码块，必须保持原样
  - handler.ts:191-193: 渲染逻辑必须在 variables 构建之后，确保顺序正确
  - tests/handler.test.ts: 提取后运行此测试确认无回归

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 现有 handler 测试全部通过
    Tool: Bash
    Preconditions: Task 1 已完成，recorder.ts 存在
    Steps:
      1. 运行 bun test tests/handler.test.ts
      2. 检查全部测试通过
    Expected Result: 所有测试 PASS，0 failures
    Failure Indicators: 任何测试 FAIL
    Evidence: .sisyphus/evidence/task-2-handler-tests.txt

  Scenario: variables 对象结构未变
    Tool: Bash (bun test)
    Preconditions: 重构完成
    Steps:
      1. 运行 bun test tests/handler.test.ts
      2. 检查模板渲染相关测试（验证 renderTemplate 收到正确的 variables）
      3. 检查格式化器相关测试（验证 formatter.format 收到正确的 payload）
    Expected Result: 所有断言通过，variables 字段名和值不变
    Failure Indicators: 任何关于模板变量的断言失败
    Evidence: .sisyphus/evidence/task-2-variables-unchanged.txt

  Scenario: recorder 被调用
    Tool: Bash (bun test 或 node -e)
    Preconditions: 重构完成
    Steps:
      1. 使用 mock 或 spy 验证 recordEventVariables 在每次 handle() 调用时被调用
      2. 验证传入的参数是完整的 variables 对象
    Expected Result: recordEventVariables 被调用，参数包含全部约42个字段
    Failure Indicators: recorder 未被调用，或参数不完整
    Evidence: .sisyphus/evidence/task-2-recorder-called.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-handler-tests.txt - handler 测试结果
  - [ ] task-2-variables-unchanged.txt - 变量结构验证
  - [ ] task-2-recorder-called.txt - recorder 调用验证

  **Commit**: YES (groups with 1, 3)
  - Message: `feat(recorder): 添加系统级事件变量录制器`
  - Files: `src/recorder.ts, src/handler.ts, tests/recorder.test.ts`
  - Pre-commit: `bun run typecheck && bun test`

- [x] 3. 添加 recorder 测试文件

  **What to do**:
  - 新建 `tests/recorder.test.ts`
  - 使用 `bun:test` 框架（`describe`, `test`, `expect`, `beforeEach`, `afterEach`）
  - 测试用例：
    1. **首次写入创建文件**: 调用 recordEventVariables，验证文件创建，每行可 JSON.parse，字段正确
    2. **多次写入追加**: 连续调用多次，验证文件包含多条 JSON Lines
    3. **undefined 字段被省略**: 传入含 undefined 值的 variables，验证 JSON 输出中不包含该字段
    4. **轮转行为**: 使用小 maxSizeBytes（如 1024），写入足够数据触发轮转，验证文件以 [TRUNCATED] 开头，后续行合法
    5. **错误容忍**: mock fs.appendFileSync 抛出异常，验证函数不抛出异常
    6. **目录自动创建**: 设置 filePath 为不存在的子目录，验证目录被创建
    7. **完整变量记录**: 构建一个包含全部字段的 variables 对象（模拟 idle 事件），验证 JSON 输出包含所有字段
  - 使用 `os.tmpdir()` 创建临时测试目录，测试结束后清理
  - 使用 `import { recordEventVariables } from '../src/recorder.js'` 动态导入

  **Must NOT do**:
  - 不修改 recorder.ts 的接口来适应测试
  - 不使用 mock.module('fs') 全局 mock（会影响 logger.ts）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 标准测试文件，模式清晰，约150行
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - 无需特殊技能

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `tests/handler.test.ts` - 现有测试文件结构（describe/test 组织，mock 模式）
  - `tests/utils/mock-transport.ts` - 测试工具模式
  - `tests/utils/sample-configs.ts` - 测试数据构造模式

  **API/Type References**:
  - `src/recorder.ts` - recorder 导出的 `recordEventVariables` 函数
  - `src/handler.ts:133-189` - variables 对象完整结构（用于构造测试数据）

  **Test References**:
  - `tests/integration/full-flow.test.ts` - 集成测试模式参考

  **WHY Each Reference Matters**:
  - tests/handler.test.ts: 了解项目测试风格和 mock 模式
  - handler.ts:133-189: 需要构造完整的测试 variables 数据，确保覆盖所有字段
  - tests/utils/: 了解测试辅助工具模式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全部 recorder 测试通过
    Tool: Bash
    Preconditions: Task 1, 2 已完成
    Steps:
      1. 运行 bun test tests/recorder.test.ts
      2. 检查全部测试通过
    Expected Result: 7个测试用例全部 PASS
    Failure Indicators: 任何测试 FAIL
    Evidence: .sisyphus/evidence/task-3-recorder-tests.txt

  Scenario: 全量测试套件无回归
    Tool: Bash
    Preconditions: 所有代码变更完成
    Steps:
      1. 运行 bun test（全量）
      2. 检查全部测试通过（含现有13个测试文件 + 新增 recorder 测试）
    Expected Result: 全部 PASS，0 failures
    Failure Indicators: 任何测试 FAIL（回归）
    Evidence: .sisyphus/evidence/task-3-full-test-suite.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-recorder-tests.txt - recorder 测试结果
  - [ ] task-3-full-test-suite.txt - 全量测试结果

  **Commit**: YES (groups with 1, 2)
  - Message: `feat(recorder): 添加系统级事件变量录制器`
  - Files: `src/recorder.ts, src/handler.ts, tests/recorder.test.ts`
  - Pre-commit: `bun run typecheck && bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Single Commit**: `feat(recorder): 添加系统级事件变量录制器` - recorder.ts, handler.ts, recorder.test.ts
  Pre-commit: `bun run typecheck && bun test`

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck                    # Expected: 无错误
bun test                             # Expected: 全部测试通过（含新增 recorder 测试）
bun run lint                         # Expected: 无错误
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] `recorder.ts` 存在且约80行
- [ ] `handler.ts` variables 构建已提取到循环外
- [ ] `recorder.test.ts` 覆盖：写入、JSON 合法性、轮转、错误容忍
