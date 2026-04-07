# File-Based Logging System for ul-opencode-event

## TL;DR

> **Quick Summary**: 插件运行在 OpenCode TUI 内，console 输出被吞掉。新建 `src/logger.ts` 模块实现分级文件日志（DEBUG/INFO/WARN/ERROR），单文件 + 大小上限自动截断，零依赖。集成到全部 6 个源文件中替换现有的粗糙 debugLog()。
>
> **Deliverables**:
> - `src/logger.ts` — Logger 模块（~100 行）
> - `src/index.ts` — 集成 logger，移除粗糙 debugLog()
> - `src/handler.ts` — 添加 info/error 日志
> - `src/email.ts` — 添加 debug/error 日志
> - `src/dingtalk.ts` — 添加 debug/error 日志
> - `src/config.ts` — 添加 warn/error 日志
> - `tests/logger.test.ts` — Logger 单元测试
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (logger module) → Tasks 2-6 (集成) → Task 7 (测试) → Task 8 (验证提交)

---

## Context

### Original Request
插件日志被 OpenCode TUI 吞掉，无法在终端中看到调试信息。需要将日志输出到文件，且要设计完善、防止日志无限增长。

### Interview Summary
**Key Discussions**:
- **日志范围**: 全量分级日志（DEBUG/INFO/WARN/ERROR），不仅是 DEBUG
- **轮转策略**: 单文件 + 大小上限（默认 2MB），超出时截断覆盖旧内容
- **实现方式**: 零依赖手写（node:fs + node:path）
- **新模块**: `src/logger.ts`，供所有源文件共享

**Research Findings**:
- 当前粗糙的 `debugLog()` 在 index.ts:20-44，使用 CJS 风格 `require('node:fs')` + appendFileSync，无大小限制
- `DEBUG_ENABLED` 在 4 个文件中重复定义（index.ts, email.ts, dingtalk.ts, config.ts）
- handler.ts 有 2 处空 catch 块（line 62-64, 74-76）完全静默错误
- 测试基础设施：Bun test + mock.module() 动态 mock node:fs 后再 import

### Metis Review
**Identified Gaps** (addressed):
- **截断时 UTF-8 安全** → 必须按行边界截断，不能从字符中间切断
- **并发写入安全** → Node.js 单线程，appendFileSync 原子性足够；但需考虑截断+写入的竞态 → 用同一把"锁"（单线程中函数调用顺序保证）
- **权限问题** → 目录不存在时需创建或降级为 console 输出
- **DEBUG_ENABLED 重复** → 统一到 logger 模块导出，各文件引用同一个来源
- **空 catch 块** → handler.ts 的 catch 应至少记录 error 级别日志

**Guardrails from Metis**:
- 不做结构化 JSON 格式（保持纯文本可读性）
- 不做远程日志/日志 shipping
- 不移除现有 console.* 调用（非 TUI 场景仍有用）
- 不做日志查看器 UI
- 不引入第三方日志库

---

## Work Objectives

### Core Objective
建立一个生产级的文件日志系统，让插件在任何运行环境下都能留下可追溯的诊断信息。

### Concrete Deliverables
- `src/logger.ts`: Logger 类/工厂，4 个级别方法，文件写入 + 大小上限截断
- 6 个源文件的日志集成点
- `tests/logger.test.ts`: 核心逻辑单元测试

### Definition of Done
- [ ] `bun test` 全部通过（0 failures）
- [ ] `npm run typecheck` 通过（0 errors）
- [ ] 设置 `UL_OPENCODE_EVENT_DEBUG=1` 后运行 OpenCode，能在 `<data-dir>/ul-opencode-event.log` 看到完整事件流
- [ ] 日志文件不会无限增长（超过上限后自动截断）

### Must Have
- 4 个日志级别：debug / info / warn / error
- 文件输出路径：`<opencode-data-dir>/ul-opencode-event.log`
- 大小上限可配置（env var），默认 2MB
- 截断策略：超限时保留最新的日志（覆盖旧内容）
- DEBUG 级别受 `UL_OPENCODE_EVENT_DEBUG` 控制；INFO/WARN/ERROR 始终写入
- 零依赖（仅 node:fs + node:path + node:os）
- ESM 模块（import 语法）

### Must NOT Have (Guardrails)
- **不得引入 pino/winston 等第三方日志库**
- **不得使用 require()**（项目是 ESM only）
- **不得修改 template.ts 或 locales.ts**（无日志需求）
- **不得移除现有的 console.* 调用**
- **不得做结构化 JSON 日志格式**
- **不得做日志轮转多文件**（仅单文件 + 截断）
- **不得在库代码顶层 import node:fs**（遵循延迟导入模式——但 logger.ts 本身是工具模块，可以静态导入 fs）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: Tests-after（先写 logger 模块，再补充测试验证）
- **Framework**: bun test
- **Logger 测试策略**: mock.module('node:fs') 截取文件操作，验证写入内容和截断逻辑

### QA Policy
- **Library/Module**: Bash (bun test) — 运行测试套件
- **Integration**: 手动验证日志文件产生（通过测试中的文件系统断言模拟）

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (立即开始 - 核心模块):
├── Task 1: 创建 src/logger.ts Logger 模块 [deep]

Wave 2 (Wave 1 完成后 - 集成到各模块, MAX PARALLEL):
├── Task 2: index.ts 集成 logger [quick]
├── Task 3: handler.ts 集成 logger [quick]
├── Task 4: email.ts 集成 logger [quick]
├── Task 5: dingtalk.ts 集成 logger [quick]
└── Task 6: config.ts 集成 logger [quick]

Wave 3 (Wave 2 完成后 - 测试 + 验证):
├── Task 7: 编写 logger 单元测试 [quick]
└── Task 8: 全量测试 + 类型检查 + 提交 [quick]

Wave FINAL (全部完成后 - 4 并行 review):
├── F1: Plan Compliance Audit [oracle]
├── F2: Code Quality Review [unspecified-high]
├── F3: Real Manual QA [unspecified-high]
└── F4: Scope Fidelity Check [deep]

Critical Path: Task 1 → Tasks 2-6 → Task 7 → Task 8 → F1-F4
Parallel Speedup: ~60% (Wave 2 有 5 个并行任务)
Max Concurrent: 5 (Wave 2)
```

### Dependency Matrix

- **1**: - - 2,3,4,5,6, 0
- **2**: 1 - 7,8, 0
- **3**: 1 - 7,8, 0
- **4**: 1 - 7,8, 0
- **5**: 1 - 7,8, 0
- **6**: 1 - 7,8, 0
- **7**: 1 - 8, 0
- **8**: 2,3,4,5,6,7 - -, 0

### Agent Dispatch Summary

- **1**: **1** - T1 → `deep`
- **2**: **5** - T2-T6 → `quick`
- **3**: **2** - T7,T8 → `quick`

---

## TODOs

- [x] 1. 创建 src/logger.ts Logger 核心模块
- [x] 2. index.ts 集成 logger
- [x] 3. handler.ts 集成 logger
- [x] 4. email.ts 集成 logger
- [x] 5. dingtalk.ts 集成 logger
- [x] 6. config.ts 集成 logger
- [x] 7. 编写 Logger 单元测试 + 修复 2 个失败测试
- [x] 8. 全量验证 + 类型检查 + 原子提交

---

---

## Final Verification Wave (MANDATORY)

> 4 个 reviewer 并行运行。全部 APPROVE 后呈现给用户确认。

- [ ] F1. **Plan Compliance Audit** -- `oracle`
  逐项检查 Must Have / Must NOT Have。验证 logger 模块存在且功能完整。搜索确认无 forbidden patterns。
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** -- `unspecified-high`
  运行 `tsc --noEmit` + `bun test`。检查变更文件质量。
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** -- `unspecified-high`
  执行每个任务的 QA 场景。测试日志写入、截断、各级别行为。
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** -- `deep`
  对每个 task：读 "What to do"，读实际 diff。验证 1:1 一致。
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `feat(logger): add file-based logging system with size cap and log levels` - src/logger.ts, src/index.ts, src/handler.ts, src/email.ts, src/dingtalk.ts, src/config.ts, tests/logger.test.ts

Pre-commit: `bun test && npm run typecheck`

Commit message:
```
feat(logger): add file-based logging system with size cap and log levels

Plugin runs inside OpenCode TUI which swallows all console output.
Add a zero-dependency file-based logger (src/logger.ts) with 4 levels
(DEBUG/INFO/WARN/ERROR), single-file output with configurable size
cap (default 2MB), and automatic truncation. Integrated into all
source modules to replace the rough debugLog() implementation.
```

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: 0 failures
npm run typecheck           # Expected: 0 errors
git diff HEAD~1 --stat      # Expected: 7 files changed (1 new + 6 modified)
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (existing + new)
- [ ] Type check passes
- [ ] Log file path correct (<opencode-data-dir>/ul-opencode-event.log)
- [ ] Size cap works (file doesn't grow beyond limit)
