# 项目级 Token 聚合变量

## TL;DR

> **Quick Summary**: 在现有 session/total 两级 token 聚合之上，新增 project 级别聚合变量，按 projectPath 过滤统计当前项目的所有会话 token，并更新默认模板为三段式斜杠格式 `Token(会话/总量/项目) 模型名`。
> 
> **Deliverables**:
> - types.ts 新增 SessionTokenData.projectPath 和 EventPayload 项目级字段
> - db-preload.ts 支持 projectPath 参数过滤预加载会话
> - index.ts 新增 aggregateProjectTokens() + fillProjectData() 聚合函数
> - handler.ts 新增 14 个项目级模板变量
> - locales.ts 更新 14 个模板（en/zh 各 7 个非 created 事件）追加项目总量
> - 完整 TDD 测试覆盖
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1(schema调查) → Task 3(types) → Task 4(db-preload) → Task 5(index) → Task 6(handler) → Task 7(locales)

---

## Context

### Original Request
用户需要增加"整个项目的 token 情况"变量，并将项目的总量 token 添加到默认模板中。

### Interview Summary
**Key Discussions**:
- 变量范围：按 projectPath 过滤，只统计当前项目的会话（非全部会话）
- 变量粒度：完整分项（input/output/reasoning/cacheRead/cacheWrite/total + Human 版本 + 格式化费用）
- 模板展示：三段式斜杠格式 `Token(会话/总量/项目) 模型名`，不再加 Project: 前缀
- db-preload：修改 SQL 在预加载时按项目路径过滤
- 测试策略：TDD

**Research Findings**:
- SDK Session 类型有 `directory` 字段（项目路径），可用于过滤
- tokenDataMap 当前不存储 projectPath 信息，需要新增
- db-preload SQL 只查 session.id/time_updated，不查 directory，需要扩展
- 插件实例绑定单一项目（ctx.directory），所有实时会话天然属于同一项目

### Metis Review
**Identified Gaps** (addressed):
- **opencode.db session 表 schema 未知**: 阻断性依赖。Task 1 先调查实际 schema，再决定 SQL 策略
- **路径标准化**: 比较前需 normalize，避免 Windows/Unix 差异和尾部斜杠问题
- **竞态条件**: message.updated 可能先于 session.created 到达，用 ctx.directory 作为 fallback
- **db-preload fallback**: 旧版 opencode.db 可能没有 directory 列，需 try-catch 回退到现有行为
- **双重计算风险**: project 级别按 tokenDataMap 的每个 session 独立遍历，使用 sumAllCompletedTokens()，不会与 total 级别双重计算

---

## Work Objectives

### Core Objective
在 session/total 两级 token 聚合之上，新增 project 级别聚合变量，按项目路径过滤统计所有会话的 token 和费用。

### Concrete Deliverables
- `src/types.ts`: SessionTokenData 增加 `projectPath?: string`，EventPayload 增加 `projectCost?`, `projectTokens?`, `projectCostFormatted?`
- `src/db-preload.ts`: 支持 projectPath 参数，修改 SQL 提取 session directory 并过滤
- `src/index.ts`: 新增 `aggregateProjectTokens()` 和 `fillProjectData()` 函数
- `src/handler.ts`: 新增 14 个 `project*` 模板变量
- `src/locales.ts`: 更新 en/zh 共 14 个模板的 Token 行
- `tests/`: 新增项目聚合相关的 TDD 测试

### Definition of Done
- [x] `bun test` 全部通过（包括新增和现有测试）
- [x] `bun run typecheck` 无错误
- [x] 所有 14 个模板（排除 created）包含 `projectTokensTotalHuman` 变量
- [x] handler.ts 变量对象中包含 14 个项目级变量
- [x] db-preload 支持 projectPath 过滤且有 fallback

### Must Have
- projectCost, projectTokens(input/output/reasoning/cacheRead/cacheWrite/total) 完整分项
- projectCostFormatted 格式化费用
- 14 个 Human 可读格式变量（projectTokens*Human）
- en/zh 模板都更新
- db-preload 按 projectPath 过滤，旧版 DB graceful fallback
- TDD 测试覆盖

### Must NOT Have (Guardrails)
- 不改变现有 session/total 变量的语义和计算逻辑
- 不修改 `aggregateSubSessions()` 或 `fillTokenData()` 的现有逻辑
- 不修改 `created` 事件的默认模板（无 token 数据）
- 不修改 `recorder.ts`（自动记录所有变量）
- 不修改 CLI 工具（`cli.ts`）
- 不添加新的配置项
- 不修改 `ChannelFormatter` 接口
- 不在模板中使用表情符号

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Import, call functions, verify output
- **Template**: Use Bash (bun test) - Render template, verify variable substitution

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - investigation + types):
├── Task 1: 调查 opencode.db session 表 schema [quick]
├── Task 2: TDD - 编写项目聚合测试用例 [unspecified-high]
└── Task 3: types.ts - 新增 SessionTokenData.projectPath + EventPayload 项目字段 [quick]

Wave 2 (After Wave 1 - core implementation):
├── Task 4: db-preload.ts - projectPath 过滤 + fallback + 测试 [unspecified-high]
├── Task 5: index.ts - aggregateProjectTokens + fillProjectData + session 标记 [deep]
└── Task 6: handler.ts - 新增 14 个项目级变量 [quick]

Wave 3 (After Wave 2 - templates + integration):
├── Task 7: locales.ts - 更新 14 个模板的 Token 行 [quick]
└── Task 8: 集成验证 - bun test 全量 + typecheck [quick]

Wave FINAL (After ALL tasks):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 4 → Task 5 → Task 7 → Task 8 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 4 | 1 |
| 2 | - | 4, 5 | 1 |
| 3 | - | 4, 5, 6 | 1 |
| 4 | 1, 3 | 5 | 2 |
| 5 | 2, 3, 4 | 7 | 2 |
| 6 | 3 | 7 | 2 |
| 7 | 5, 6 | 8 | 3 |
| 8 | 7 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: **3** - T1 → `quick`, T2 → `unspecified-high`, T3 → `quick`
- **Wave 2**: **3** - T4 → `unspecified-high`, T5 → `deep`, T6 → `quick`
- **Wave 3**: **2** - T7 → `quick`, T8 → `quick`
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. 调查 opencode.db session 表 schema

  **What to do**:
  - 使用 `bun:sqlite` 或 `sqlite3` 命令行工具打开 `~/.local/share/opencode/opencode.db`
  - 执行 `PRAGMA table_info(session)` 查看 session 表的完整列定义
  - 执行 `SELECT * FROM session LIMIT 1` 查看实际数据样例
  - 确认是否包含 `directory` 列（直接列）或 `data` JSON 列中是否包含 `directory` 字段
  - 将发现记录到 `.sisyphus/evidence/task-1-schema-investigation.md`

  **Must NOT do**:
  - 不修改任何源代码
  - 不修改数据库

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯调查任务，只需查询数据库并记录
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (db-preload 实现依赖 schema 发现)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/db-preload.ts:19-27` - 当前 SQL 查询模式，了解 session 表已知的列（id, time_updated）
  - `src/db-preload.ts:5` - `import { Database } from 'bun:sqlite'` - 使用相同工具访问 DB

  **API/Type References**:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:465-492` - Session SDK 类型定义，包含 `directory` 字段

  **WHY Each Reference Matters**:
  - `db-preload.ts` 的 SQL 模式告诉我们已知列名，帮助推断新 SQL 如何写
  - Session SDK 类型告诉我们 `directory` 字段存在于 SDK 层，但需要确认数据库层是否有对应存储

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 查询 session 表 schema
    Tool: Bash (sqlite3 or bun script)
    Preconditions: opencode.db 存在于 ~/.local/share/opencode/
    Steps:
      1. 执行 `PRAGMA table_info(session)` 获取列定义
      2. 执行 `SELECT * FROM session ORDER BY time_updated DESC LIMIT 1` 获取数据样例
      3. 如果有 data 列，尝试 `json_extract(data, '$.directory')` 提取 directory
    Expected Result: 明确知道 session 表是否有 directory 信息，以及如何获取
    Failure Indicators: 数据库文件不存在（可接受，记录为空状态）
    Evidence: .sisyphus/evidence/task-1-schema-investigation.md

  Scenario: 数据库不存在时的 fallback
    Tool: Bash
    Preconditions: 删除或重命名 opencode.db（测试后恢复）
    Steps:
      1. 检查 OPENCODE_DATA_DIR 环境变量
      2. 尝试打开数据库
    Expected Result: 记录 "数据库不存在" 状态
    Evidence: .sisyphus/evidence/task-1-no-db.md
  ```

  **Commit**: NO

- [ ] 2. TDD - 编写项目聚合测试用例

  **What to do**:
  - 创建 `tests/project-aggregation.test.ts`
  - 编写以下测试用例（RED 阶段，预期全部 FAIL）：
    1. **单会话场景**: projectTokens == sessionTokens，只有一个会话，无预加载数据
    2. **多会话项目场景**: tokenDataMap 中有 3 个同项目的会话，验证 projectTokens 是三者之和
    3. **跨项目隔离**: tokenDataMap 中有项目 A 和项目 B 的会话，验证只计项目 A
    4. **空 token 会话**: 某会话所有 token 为 0，应正确计入（不跳过）
    5. **无 projectPath 的会话（旧数据）**: projectPath 为 undefined 的会话不计入项目总量
    6. **projectCostFormatted 格式化**: 3 个会话 cost 之和正确格式化
    7. **locales.ts 模板包含 projectTokensTotalHuman**: 所有 14 个非 created 模板包含该变量
    8. **handler.ts 变量包含 14 个项目级变量**: 验证 variables 对象中有所有 project* 字段
  - 每个测试用具体的 token 数据（如 `input: 1000, output: 500`）
  - 使用动态 import 和 mock 模式（参照现有测试结构）

  **Must NOT do**:
  - 不实现任何源代码逻辑（只写测试）
  - 不修改现有测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: TDD 测试编写需要深入理解现有 mock 模式和测试结构
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5 (实现依赖测试用例定义)
  - **Blocked By**: None

  **References**:

  **Test References**:
  - `tests/index.test.ts` - 主入口测试，了解 mock 模式和测试结构
  - `tests/utils/mock-transport.ts` - Mock 工具
  - `tests/utils/sample-configs.ts` - 测试配置样例
  - `tests/integration/full-flow.test.ts` - 集成测试模式

  **Pattern References**:
  - `src/index.ts:288-338` - fillTokenData() 函数，了解现有聚合逻辑
  - `src/index.ts:408-458` - aggregateSubSessions() 函数，了解子会话聚合模式
  - `src/index.ts:340-402` - 辅助函数（sumAllCompletedTokens 等），了解 token 汇总方式
  - `src/handler.ts:119-175` - 变量构建模式
  - `src/locales.ts:29-125` - 所有模板定义

  **WHY Each Reference Matters**:
  - 现有测试文件展示 mock.module() 和 mock() 的使用模式，新测试必须遵循
  - fillTokenData 和 aggregateSubSessions 是新函数 aggregateProjectTokens 的参照模板
  - handler.ts 的变量构建模式决定新变量的命名和格式
  - locales.ts 的模板结构决定测试中如何验证模板包含新变量

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 测试文件创建: tests/project-aggregation.test.ts
  - [ ] bun test tests/project-aggregation.test.ts → FAIL (8 tests, RED phase expected)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 测试文件创建且全部 FAIL（RED phase）
    Tool: Bash
    Preconditions: types.ts 已更新（Task 3）
    Steps:
      1. 运行 `bun test tests/project-aggregation.test.ts`
      2. 确认所有测试用例存在且 FAIL
    Expected Result: 8 test cases, 8 failures (or type errors if types not ready)
    Failure Indicators: 0 test cases found, or tests PASS (意味测试没有断言)
    Evidence: .sisyphus/evidence/task-2-red-phase.txt

  Scenario: 测试覆盖所有关键场景
    Tool: Bash (grep)
    Preconditions: 测试文件已创建
    Steps:
      1. 搜索测试文件中的 describe/test 块
      2. 确认覆盖：单会话、多会话、跨项目、空token、无projectPath、cost格式化、模板变量、handler变量
    Expected Result: 8+ 个独立 test 块
    Failure Indicators: 缺少关键场景（如跨项目隔离）
    Evidence: .sisyphus/evidence/task-2-test-coverage.txt
  ```

  **Commit**: NO

- [x] 3. types.ts - 新增 SessionTokenData.projectPath + EventPayload 项目字段

  **What to do**:
  - 在 `SessionTokenData` 接口（types.ts:270-279）中新增 `projectPath?: string` 字段
  - 在 `EventPayload` 接口（types.ts:156-200）中新增 3 个字段：
    - `projectCost?: number`
    - `projectTokens?: TokenBreakdown`
    - `projectCostFormatted?: string`
  - 确保所有新字段为 optional（`?`），不影响现有类型兼容性

  **Must NOT do**:
  - 不修改现有字段的类型或语义
  - 不删除或重命名任何现有字段

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯类型定义修改，3 行新增
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:270-279` - SessionTokenData 现有结构，新增字段参照 lastModelID/lastProviderID 的 optional 模式
  - `src/types.ts:156-200` - EventPayload 现有结构，新增字段参照 sessionCost/sessionTokens/costFormatted 的模式

  **API/Type References**:
  - `src/types.ts:242-249` - TokenBreakdown 接口，projectTokens 使用相同类型

  **WHY Each Reference Matters**:
  - 参照现有字段的 optional 模式确保类型一致性
  - TokenBreakdown 是 projectTokens 的类型，必须复用

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] `bun run typecheck` 通过（类型变更不引入新错误）
  - [ ] SessionTokenData 有 `projectPath?: string` 字段
  - [ ] EventPayload 有 `projectCost?`, `projectTokens?`, `projectCostFormatted?` 字段

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 类型检查通过
    Tool: Bash
    Preconditions: types.ts 已修改
    Steps:
      1. 运行 `bun run typecheck`
    Expected Result: 0 errors
    Failure Indicators: TypeScript 编译错误
    Evidence: .sisyphus/evidence/task-3-typecheck.txt

  Scenario: 新字段存在且 optional
    Tool: Bash (grep)
    Preconditions: types.ts 已修改
    Steps:
      1. grep "projectPath" src/types.ts → 确认在 SessionTokenData 中
      2. grep "projectCost" src/types.ts → 确认在 EventPayload 中
      3. grep "projectTokens" src/types.ts → 确认在 EventPayload 中
      4. grep "projectCostFormatted" src/types.ts → 确认在 EventPayload 中
    Expected Result: 每个字段都带 `?` optional 标记
    Failure Indicators: 字段缺失或不是 optional
    Evidence: .sisyphus/evidence/task-3-fields.txt
  ```

  **Commit**: NO (groups with all implementation tasks)

- [x] 4. db-preload.ts - projectPath 过滤 + fallback + 测试

  **What to do**:
  - 修改 `preloadTokenData()` 函数签名，增加可选参数 `projectPath?: string`
  - **根据 Task 1 的 schema 调查结果**：
    - **方案 A**（session 表有 `directory` 列）：修改 SQL WHERE 条件添加 `AND directory = ?`
    - **方案 B**（session 表有 `data` JSON 列含 directory）：修改 SQL 添加 `AND json_extract(data, '$.directory') = ?`
    - **方案 C**（无法确定 directory）：保持现有 SQL 不变，在结果遍历中通过其他方式标记
  - 使用 try-catch 包裹新 SQL：失败时 fallback 到现有 SQL（不过滤项目）
  - 遍历结果时，为每个 SessionTokenData 设置 `projectPath` 字段
  - 路径比较前使用 `path.normalize()` 标准化
  - 创建 `tests/db-preload-project.test.ts` 测试：
    - 测试项目过滤功能
    - 测试 SQL fallback 行为
    - 测试无 projectPath 参数时的向后兼容性

  **Must NOT do**:
  - 不删除现有 SQL（作为 fallback 保留）
  - 不在 preload 函数中做任何写操作
  - 不引入新的外部依赖

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要 schema 调查结果来决定 SQL 策略，且需要处理 fallback 逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 6 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (schema 调查), Task 3 (类型定义)

  **References**:

  **Pattern References**:
  - `src/db-preload.ts:10-90` - 完整的 preloadTokenData 函数，是本次修改的基础
  - `src/db-preload.ts:19-27` - 当前 SQL 查询，需要扩展 WHERE 条件

  **API/Type References**:
  - `src/types.ts:270-279` - SessionTokenData，新增的 projectPath 字段需要在此设置

  **Test References**:
  - `tests/db-preload.test.ts` - 现有 db-preload 测试（如果存在），了解 mock 模式

  **External References**:
  - Bun SQLite API: `bun:sqlite` Database 类用法

  **WHY Each Reference Matters**:
  - 完整阅读 db-preload.ts 是为了理解所有边界情况（DB 不存在、JSON 解析失败等）
  - SQL 查询是需要修改的核心，必须保持对 message 表的 JOIN 和 json_extract 模式
  - SessionTokenData 类型确保正确设置 projectPath 字段

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 测试文件创建: tests/db-preload-project.test.ts
  - [ ] bun test tests/db-preload-project.test.ts → PASS
  - [ ] preloadTokenData 接受可选的 projectPath 参数
  - [ ] projectPath 参数为空时行为与修改前完全一致

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 项目过滤功能正常工作
    Tool: Bash (bun test)
    Preconditions: Task 1 schema 调查完成，知道如何获取 directory
    Steps:
      1. 创建临时 SQLite DB，插入多个 session（不同 directory）和对应 message
      2. 调用 preloadTokenData(tokenDataMap, tempDir, 10, '/project/A')
      3. 验证 tokenDataMap 只包含 directory 匹配 '/project/A' 的 session
    Expected Result: 只有匹配项目的会话被加载，且 projectPath 字段已设置
    Failure Indicators: 加载了其他项目的会话，或 projectPath 未设置
    Evidence: .sisyphus/evidence/task-4-filter.txt

  Scenario: SQL fallback - 旧版 opencode.db 无 directory 列
    Tool: Bash (bun test)
    Preconditions: 创建只有基本列（id, time_updated）的 session 表
    Steps:
      1. 创建临时 SQLite DB，session 表无 directory 列
      2. 调用 preloadTokenData(tokenDataMap, tempDir, 10, '/project/A')
      3. 验证加载了所有会话（fallback 到现有行为）
    Expected Result: 无报错，所有会话被加载，projectPath 为 undefined
    Failure Indicators: 抛出异常或加载 0 个会话
    Evidence: .sisyphus/evidence/task-4-fallback.txt

  Scenario: 向后兼容 - 不传 projectPath 参数
    Tool: Bash (bun test)
    Steps:
      1. 调用 preloadTokenData(tokenDataMap, tempDir) - 不传 projectPath
      2. 验证行为与修改前完全一致（加载最后 N 个会话）
    Expected Result: 与修改前行为一致
    Failure Indicators: 行为变化或报错
    Evidence: .sisyphus/evidence/task-4-compat.txt
  ```

  **Commit**: NO (groups with all implementation tasks)

- [x] 5. index.ts - aggregateProjectTokens + fillProjectData + session 标记

  **What to do**:
  - 新增 `aggregateProjectTokens(tokenDataMap, projectPath)` 函数：
    - 遍历 tokenDataMap 中所有 session
    - 对每个 session，检查 `sessionData.projectPath === projectPath`（使用 `path.normalize()` 比较）
    - 如果 sessionData.projectPath 为 undefined（旧数据），**不计入**项目总量
    - 对匹配的 session，使用 `sumAllCompletedTokens()` 汇总 token
    - 返回 `{ cost, tokens }` 结构
  - 新增 `fillProjectData()` 函数：
    - 调用 `aggregateProjectTokens()` 获取项目聚合数据
    - 设置 `payload.projectCost`, `payload.projectTokens`, `payload.projectCostFormatted`
    - cost 格式化使用 `resolveCostConfig + formatCost`（与 totalCost 一致）
  - 修改 `message.updated` 处理器（index.ts:622-668）：
    - 创建新 SessionTokenData 时，从 `sessionMap.get(sessionId)?.directory` 获取 projectPath
    - 若 sessionMap 无此条目，使用 `ctx.directory` 作为 fallback
    - 设置 `sessionData.projectPath`
  - 修改 `session.created` 处理器（index.ts:581-619）：
    - session.created 之后，回填 tokenDataMap 中已存在但无 projectPath 的 sessionData
    - 从 session info 的 `directory` 字段获取
  - 修改 `preloadTokenData` 调用（index.ts:558-564）：
    - 传入 `ctx.directory` 作为 projectPath 参数
  - 修改事件处理管道（index.ts:688-695）：
    - 在 `aggregateSubSessions()` 之后调用 `fillProjectData()`
  - 创建/补充测试到 `tests/project-aggregation.test.ts`，使测试通过（GREEN phase）

  **Must NOT do**:
  - 不修改 `fillTokenData()` 的现有逻辑
  - 不修改 `aggregateSubSessions()` 的现有逻辑
  - 不修改 `eventToPayload()` 的现有映射逻辑
  - 不改变现有 session/total 变量的计算方式

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心业务逻辑修改，涉及多个函数和数据流，需要深入理解
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 6 in Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 2 (测试用例), 3 (类型), 4 (db-preload)

  **References**:

  **Pattern References**:
  - `src/index.ts:288-338` - fillTokenData() 函数，fillProjectData() 应遵循相同模式（null check, cost formatting）
  - `src/index.ts:408-458` - aggregateSubSessions() 函数，aggregateProjectTokens() 应遵循相同的 token 汇总模式
  - `src/index.ts:340-402` - sumAllCompletedTokens() 等辅助函数，项目聚合必须复用
  - `src/index.ts:622-668` - message.updated 处理器，新增 projectPath 标记的位置
  - `src/index.ts:581-619` - session.created 处理器，新增 projectPath 回填的位置
  - `src/index.ts:688-695` - 事件处理管道，fillProjectData() 的调用位置

  **API/Type References**:
  - `src/types.ts:156-200` - EventPayload，新增字段的目标
  - `src/types.ts:270-279` - SessionTokenData，projectPath 字段
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:465-492` - Session SDK 类型（directory 字段）
  - `src/cost.ts` - resolveCostConfig + formatCost 函数

  **Test References**:
  - `tests/project-aggregation.test.ts` - Task 2 编写的测试用例（RED phase），本 task 应使其变 GREEN

  **WHY Each Reference Matters**:
  - fillTokenData 是 fillProjectData 的直接参照模板
  - aggregateSubSessions 展示了如何遍历 tokenDataMap 并汇总 token/cost
  - sumAllCompletedTokens 是每个会话级别的 token 汇总函数，必须复用以保持一致性
  - message.updated 和 session.created 处理器是标记 projectPath 的确切位置
  - 事件处理管道确定了 fillProjectData() 的调用时机

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] bun test tests/project-aggregation.test.ts → PASS (GREEN phase)
  - [ ] aggregateProjectTokens 函数存在且返回正确的聚合数据
  - [ ] fillProjectData 函数填充 payload 的 projectCost/projectTokens/projectCostFormatted
  - [ ] message.updated 处理器为新 SessionTokenData 设置 projectPath
  - [ ] session.created 处理器回填已有 sessionData 的 projectPath

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 单会话 - projectTokens == sessionTokens
    Tool: Bash (bun test)
    Preconditions: tokenDataMap 中只有一个会话，projectPath 匹配
    Steps:
      1. 构造单个会话的 tokenDataMap（projectPath = '/project/A'）
      2. 调用 aggregateProjectTokens(tokenDataMap, '/project/A')
      3. 验证结果等于该会话的 sumAllCompletedTokens()
    Expected Result: project tokens == session tokens
    Failure Indicators: 数值不匹配
    Evidence: .sisyphus/evidence/task-5-single-session.txt

  Scenario: 多会话项目聚合
    Tool: Bash (bun test)
    Steps:
      1. 构造 3 个同项目会话（input: 1000, 2000, 3000; output: 500, 1500, 2500）
      2. 调用 aggregateProjectTokens(tokenDataMap, '/project/A')
      3. 验证 projectTokens.input == 6000, projectTokens.output == 4500
    Expected Result: 正确汇总 3 个会话
    Failure Indicators: 只计了部分会话或数值错误
    Evidence: .sisyphus/evidence/task-5-multi-session.txt

  Scenario: 跨项目隔离
    Tool: Bash (bun test)
    Steps:
      1. 构造 tokenDataMap：2 个项目 A 会话 + 2 个项目 B 会话 + 1 个无 projectPath 会话
      2. 调用 aggregateProjectTokens(tokenDataMap, '/project/A')
      3. 验证只包含项目 A 的 2 个会话
    Expected Result: project tokens 只计项目 A
    Failure Indicators: 包含了项目 B 的会话或无 projectPath 的会话
    Evidence: .sisyphus/evidence/task-5-cross-project.txt

  Scenario: 无 projectPath 的会话不计入
    Tool: Bash (bun test)
    Steps:
      1. 构造 tokenDataMap：1 个有 projectPath 的会话 + 1 个无 projectPath 的会话
      2. 调用 aggregateProjectTokens(tokenDataMap, '/project/A')
      3. 验证只包含有 projectPath 的会话
    Expected Result: 无 projectPath 的会话被跳过
    Evidence: .sisyphus/evidence/task-5-no-projectpath.txt

  Scenario: 路径标准化比较
    Tool: Bash (bun test)
    Steps:
      1. sessionData.projectPath = '/project/A/'（带尾部斜杠）
      2. 传入 projectPath = '/project/A'（无尾部斜杠）
      3. 验证 path.normalize() 后正确匹配
    Expected Result: 匹配成功
    Failure Indicators: 路径不匹配
    Evidence: .sisyphus/evidence/task-5-path-normalize.txt
  ```

  **Commit**: NO (groups with all implementation tasks)

- [x] 6. handler.ts - 新增 14 个项目级变量

  **What to do**:
  - 在 `handler.ts` 的 `variables` 对象中（lines 119-175），追加 14 个项目级变量：
    - `projectCost`: `String(payload.projectCost)`
    - `projectCostFormatted`: `payload.projectCostFormatted`
    - `projectTokensInput`: `String(payload.projectTokens?.input)`
    - `projectTokensOutput`: `String(payload.projectTokens?.output)`
    - `projectTokensReasoning`: `String(payload.projectTokens?.reasoning)`
    - `projectTokensCacheRead`: `String(payload.projectTokens?.cacheRead)`
    - `projectTokensCacheWrite`: `String(payload.projectTokens?.cacheWrite)`
    - `projectTokensTotal`: `String(payload.projectTokens?.total)`
    - `projectTokensInputHuman`: `formatTokenCount(payload.projectTokens?.input)`
    - `projectTokensOutputHuman`: `formatTokenCount(payload.projectTokens?.output)`
    - `projectTokensReasoningHuman`: `formatTokenCount(payload.projectTokens?.reasoning)`
    - `projectTokensCacheReadHuman`: `formatTokenCount(payload.projectTokens?.cacheRead)`
    - `projectTokensCacheWriteHuman`: `formatTokenCount(payload.projectTokens?.cacheWrite)`
    - `projectTokensTotalHuman`: `formatTokenCount(payload.projectTokens?.total)`
  - 遵循现有 `totalTokens*` 和 `sessionTokens*` 的命名和格式模式

  **Must NOT do**:
  - 不修改现有变量的命名或格式
  - 不修改 formatTokenCount 函数
  - 不添加非 project* 前缀的变量

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯变量添加，模式明确，14 行重复性代码
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: Task 3 (类型定义)

  **References**:

  **Pattern References**:
  - `src/handler.ts:142-174` - 现有 session/total 变量的完整模式，新变量必须遵循相同的 null check + String()/formatTokenCount() 模式

  **WHY Each Reference Matters**:
  - 现有变量模式是新增变量的直接模板，只需复制 totalTokens* 的模式并替换为 projectTokens*

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] bun test → PASS（现有 handler 测试不受影响）
  - [ ] variables 对象包含 14 个 project* 变量

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 14 个项目级变量存在
    Tool: Bash (grep)
    Steps:
      1. grep "projectCost:" src/handler.ts → 确认存在
      2. grep "projectCostFormatted:" src/handler.ts → 确认存在
      3. grep "projectTokensInput:" src/handler.ts → 确认存在
      4. grep "projectTokensTotalHuman:" src/handler.ts → 确认存在
    Expected Result: 14 个 project* 变量都存在于 variables 对象中
    Failure Indicators: 缺少任何变量
    Evidence: .sisyphus/evidence/task-6-variables.txt

  Scenario: 变量值正确 - payload 有 project 数据
    Tool: Bash (bun test)
    Preconditions: payload.projectTokens = { input: 5000, output: 2000, ... }
    Steps:
      1. 使用 mock payload 调用 handle()
      2. 验证 variables.projectTokensInputHuman == "5.0K"
      3. 验证 variables.projectTokensOutputHuman == "2.0K"
    Expected Result: 人类可读格式正确
    Failure Indicators: 数值或格式错误
    Evidence: .sisyphus/evidence/task-6-format.txt

  Scenario: 变量值正确 - payload 无 project 数据
    Tool: Bash (bun test)
    Steps:
      1. 使用无 projectTokens 的 payload 调用 handle()
      2. 验证 variables.projectTokensTotalHuman === undefined
    Expected Result: undefined（与其他 optional 变量行为一致）
    Failure Indicators: 抛出异常或返回错误值
    Evidence: .sisyphus/evidence/task-6-undefined.txt
  ```

  **Commit**: NO (groups with all implementation tasks)

- [x] 7. locales.ts - 更新 14 个模板的 Token 行

  **What to do**:
  - 更新 **en 模板**（7 个非 created 事件）：idle, error, question, permission, status, command, fileEdited, todo
  - 更新 **zh 模板**（7 个非 created 事件）：同上
  - 将 Token 行格式从：
    ```
    Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}
    ```
    改为（三段式斜杠）：
    ```
    Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}}) {{modelID}}
    ```
  - en 和 zh 模板统一使用此格式（不区分中英文前缀）

  **Must NOT do**:
  - 不修改 `created` 事件的模板
  - 不修改 subject（标题行）
  - 不修改 Token 行以外的内容
  - 不使用表情符号

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯模板文本替换，模式完全一致
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 5 (fillProjectData), 6 (handler variables)

  **References**:

  **Pattern References**:
  - `src/locales.ts:39` - en idle 模板 Token 行：`Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}`
  - `src/locales.ts:87` - zh idle 模板 Token 行：同上格式

  **WHY Each Reference Matters**:
  - 每个模板的 Token 行格式是修改目标，需要精确复制并追加项目变量

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] bun test → PASS（模板测试不受影响或已更新）
  - [ ] 14 个模板（en 7 + zh 7）都包含 `{{projectTokensTotalHuman}}`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: en 模板包含 projectTokensTotalHuman
    Tool: Bash (grep)
    Steps:
      1. grep "projectTokensTotalHuman" src/locales.ts
      2. 计数出现次数
    Expected Result: 14 次出现（en 7 + zh 7，每个非 created 事件模板各一次）
    Failure Indicators: 少于 14 次
    Evidence: .sisyphus/evidence/task-7-en-templates.txt

  Scenario: created 模板不包含 projectTokensTotalHuman
    Tool: Bash (grep)
    Steps:
      1. 查看 locales.ts 中 created 模板的 body 内容
    Expected Result: created 模板无 Token 行
    Failure Indicators: created 模板被修改添加了 Token 行
    Evidence: .sisyphus/evidence/task-7-created-unchanged.txt

  Scenario: 模板渲染 - 所有变量正确替换
    Tool: Bash (bun test)
    Steps:
      1. 使用 mock variables（projectTokensTotalHuman: "50.0K"）渲染 idle 模板
      2. 验证输出包含 "Token(2.3K/5.1K/50.0K)" 格式
    Expected Result: 三段式斜杠格式正确渲染
    Failure Indicators: 变量未被替换（仍显示 {{projectTokensTotalHuman}}）
    Evidence: .sisyphus/evidence/task-7-render.txt
  ```

  **Commit**: NO (groups with all implementation tasks)

- [x] 8. 集成验证 - bun test 全量 + typecheck

  **What to do**:
  - 运行 `bun test` 全量测试，确认所有测试通过（包括新增和现有）
  - 运行 `bun run typecheck`，确认无类型错误
  - 运行 `bun run build`，确认构建成功
  - 运行 `bun run lint`，确认无 lint 错误
  - 如果有任何失败，修复后重新运行

  **Must NOT do**:
  - 不跳过任何失败的测试
  - 不添加 `@ts-ignore` 或 `as any` 来绕过类型错误
  - 不禁用 lint 规则

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯验证任务，运行命令并修复已知问题
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential after Task 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 7

  **References**:
  - `package.json` - scripts 字段中的 test/typecheck/build/lint 命令

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全量测试通过
    Tool: Bash
    Steps:
      1. 运行 `bun test`
    Expected Result: 0 failures, all tests pass
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-8-test.txt

  Scenario: 类型检查通过
    Tool: Bash
    Steps:
      1. 运行 `bun run typecheck`
    Expected Result: 0 errors
    Failure Indicators: TypeScript compilation errors
    Evidence: .sisyphus/evidence/task-8-typecheck.txt

  Scenario: 构建成功
    Tool: Bash
    Steps:
      1. 运行 `bun run build`
    Expected Result: Clean build, dist/ files updated
    Failure Indicators: Build errors
    Evidence: .sisyphus/evidence/task-8-build.txt
  ```

  **Commit**: YES
  - Message: `feat(tokens): 新增项目级 token 聚合变量和默认模板`
  - Pre-commit: `bun test && bun run typecheck`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, grep variable names). For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` + `bun run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Single commit**: `feat(tokens): 新增项目级 token 聚合变量和默认模板`

---

## Success Criteria

### Verification Commands
```bash
bun test                              # Expected: all tests pass, 0 failures
bun run typecheck                     # Expected: no errors
bun run build                         # Expected: clean build
```

### Final Checklist
- [x] All "Must Have" present (types, preload, aggregation, variables, templates, tests)
- [x] All "Must NOT Have" absent (no session/total changes, no created template changes, no config changes)
- [x] All tests pass
- [x] 14 个模板（en/zh 非 created 事件）包含 projectTokensTotalHuman
- [x] handler.ts 变量对象包含 14 个 project 级变量
- [x] db-preload 支持 projectPath 过滤且有 fallback
