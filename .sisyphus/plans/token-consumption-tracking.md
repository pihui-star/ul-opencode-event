# Token Consumption Tracking in Notifications

## TL;DR

> **Quick Summary**: 在 ul-opencode-event 插件的通知中添加 token 消耗、费用、模型信息展示。监听 `message.updated` 事件累积 AssistantMessage 中的 cost/tokens/model 数据，通过新模板变量暴露给所有事件通知。
> 
> **Deliverables**:
> - 新模块 `src/cost.ts` - 费用计算与货币格式化
> - `src/types.ts` 扩展 - TokenData 类型、EventPayload 新字段、NotificationConfig 新配置项
> - `src/index.ts` 扩展 - message.updated 事件处理、tokenDataMap 累积逻辑
> - `src/handler.ts` 扩展 - 新模板变量映射
> - `src/locales.ts` 扩展 - 默认模板展示 token/费用/模型信息
> - `src/config.ts` 扩展 - 货币/汇率/精度配置合并
> - 完整的 TDD 测试覆盖
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (types) → Task 3 (cost module) → Task 5 (index.ts accumulation) → Task 7 (output pipeline) → Task 9 (integration) → F1-F4

---

## Context

### Original Request
用户希望在插件发送通知时获取 token 消耗情况，包括 cost、tokens（input/output/reasoning/cache）、模型名称（modelID）等字段。

### Interview Summary
**Key Discussions**:
- 展示范围：所有事件都附带 token 数据
- 子会话：设计两套变量（sessionCost/totalCost），默认模板用整体数据
- 费用格式：可配置小数位、可配置货币（USD/CNY），与 language 配置挂钩
- 汇率：内置默认 + 可配置覆盖 + 可选在线获取（失败退回配置值）
- Token：显示分项 + total 合计
- 测试：TDD（Bun test）

**Research Findings**:
- `AssistantMessage` 携带 cost/tokens/modelID/providerID/mode（通过 message.updated 事件）
- 当前 `message.updated` 完全未处理（返回 null，数据丢失）
- `Session` 类型不含 cost/tokens 字段
- 项目测试覆盖非常全面，使用 Bun test + mock.module 模式
- 模板系统是简单 {{variable}} 替换，无条件逻辑

### Metis Review
**Identified Gaps** (addressed):
- message.updated 在流式响应期间多次触发：按 message.id 覆盖而非累加
- UserMessage 无 cost/tokens：必须检查 role === 'assistant'
- tokenDataMap 内存清理：session.idle/error 时清除
- 在线汇率获取推迟到 v2：v1 只做内置默认 + 可配置覆盖
- 子会话并发安全：JavaScript 单线程，按 session 隔离存储
- mid-session 事件 token 展示：简要显示 sessionCost，不展开完整明细

---

## Work Objectives

### Core Objective
在所有事件通知中展示 token 消耗（input/output/reasoning/cache/total）、费用（可配置货币和精度）、模型信息（modelID/providerID/mode），支持当前会话和含子会话的两种维度。

### Concrete Deliverables
- `src/cost.ts` - 费用计算与格式化模块
- `src/types.ts` - 新增 TokenData、CostConfig 类型，扩展 EventPayload 和 NotificationConfig
- `src/index.ts` - message.updated 事件处理、tokenDataMap 管理
- `src/handler.ts` - 18+ 新模板变量映射
- `src/locales.ts` - 中英文默认模板增加 token/费用/模型信息
- `src/config.ts` - 新配置项的加载、合并、校验
- `tests/cost.test.ts` - cost 模块 TDD 测试
- `tests/index.test.ts` 扩展 - message.updated 和 tokenDataMap 测试
- `tests/handler.test.ts` 扩展 - 新变量渲染测试
- `tests/locales.test.ts` 扩展 - 新模板变量测试
- `tests/config.test.ts` 扩展 - 新配置项测试

### Definition of Done
- [ ] `bun test` 全部通过（0 failures）
- [ ] `bun run typecheck` 通过
- [ ] `bun run lint` 通过
- [ ] 所有事件类型的模板中包含 token/费用/模型变量
- [ ] sessionCost vs totalCost 变量正确区分
- [ ] zh -> CNY, en -> USD 默认值生效
- [ ] 可配置小数位和汇率

### Must Have
- message.updated 事件监听与 token 数据累积
- sessionCost/totalCost 双维度变量
- sessionTokens*/totalTokens* 完整 token 明细
- modelID/providerID/mode 模型信息
- 货币配置（USD/CNY）+ 语言默认推断
- 可配置小数位和汇率
- 内置默认汇率（USD->CNY）
- TDD 测试覆盖

### Must NOT Have (Guardrails)
- 不添加在线汇率获取（v2 功能）
- 不扩展 template.ts 添加条件渲染逻辑
- 不追踪 StepFinishPart（只用 AssistantMessage）
- 不修改 ChannelFormatter 接口或格式化器签名
- 不添加按模型拆分的费用明细
- 不添加费用阈值告警
- 不添加历史费用持久化
- 不在 session.created 事件模板中展示 token 数据（此时无数据）
- 不在 index.ts 顶层导入 cost.ts（遵循延迟导入模式）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: TDD (RED -> GREEN -> REFACTOR)
- **Framework**: Bun test (`bun:test`)
- **Each task follows**: 先写失败测试 -> 最小实现通过 -> 重构

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run specific test files, assert pass/fail counts
- **Type checking**: Use Bash (bun run typecheck) - Assert zero errors
- **Linting**: Use Bash (bun run lint) - Assert zero errors

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - types + cost foundation):
+-- Task 1: 扩展 types.ts - TokenData/CostConfig 类型 + EventPayload 新字段 [quick]
+-- Task 2: 扩展 config.ts - 货币/汇率/精度配置加载与合并 [quick]
+-- Task 3: 新建 cost.ts - 费用计算与货币格式化模块 (TDD) [deep]

Wave 2 (After Wave 1 - data accumulation + output):
+-- Task 4: index.ts - message.updated 事件处理 + tokenDataMap (TDD) [deep]
+-- Task 5: handler.ts - 新模板变量映射 (TDD) [quick]
+-- Task 6: locales.ts - 中英文默认模板增加 token/费用/模型信息 (TDD) [unspecified-high]

Wave 3 (After Wave 2 - integration + CLI):
+-- Task 7: 集成测试 - 端到端 message.updated -> idle 通知含 token 数据 [deep]
+-- Task 8: CLI 测试工具更新 - 支持新配置项的测试 [quick]

Wave FINAL (After ALL tasks - 4 parallel reviews, then user okay):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 4 -> Task 5 -> Task 7 -> F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 4, 5, 6 | 1 |
| 2 | - | 4, 6 | 1 |
| 3 | 1 | 4, 5, 6 | 1 |
| 4 | 1, 2, 3 | 7 | 2 |
| 5 | 1, 3 | 7 | 2 |
| 6 | 1, 2, 3 | 7 | 2 |
| 7 | 4, 5, 6 | F1-F4 | 3 |
| 8 | 4, 5 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks - T1 `quick`, T2 `quick`, T3 `deep`
- **Wave 2**: 3 tasks - T4 `deep`, T5 `quick`, T6 `unspecified-high`
- **Wave 3**: 2 tasks - T7 `deep`, T8 `quick`
- **FINAL**: 4 tasks - F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. 扩展 types.ts - TokenData/CostConfig 类型 + EventPayload 新字段

  **What to do**:
  - 新增 `TokenData` 类型，包含 cost、tokens(input/output/reasoning/cache{read/write}/total)、modelID、providerID、mode
  - 新增 `SessionTokenData` 类型，用于 tokenDataMap 存储（按 session 维度累积、按 message.id 去重）
  - 新增 `CostConfig` 类型，包含 currency(USD/CNY)、exchangeRate(number)、decimalPlaces(number)、enableOnlineRate(boolean)
  - 扩展 `NotificationConfig` 增加 `cost?: CostConfig` 可选字段
  - 扩展 `EventPayload` 增加以下可选字段：
    - `sessionCost?: number` - 当前会话费用(USD原始值)
    - `sessionTokens?: TokenBreakdown` - 当前会话 token 明细
    - `totalCost?: number` - 含子会话总费用
    - `totalTokens?: TokenBreakdown` - 含子会话总 token
    - `modelID?: string` - 使用的模型ID
    - `providerID?: string` - 提供商ID
    - `mode?: string` - 模式(build/plan等)
    - `costFormatted?: string` - 格式化后的费用字符串(如 "$0.0423" 或 "0.31元")
    - `totalCostFormatted?: string` - 格式化后含子会话总费用
    - `currency?: string` - 当前货币符号/代码
  - 新增 `TokenBreakdown` 类型：input, output, reasoning, cacheRead, cacheWrite, total
  - 新增 `SUPPORTED_CURRENCIES` 常量数组: ['USD', 'CNY']

  **Must NOT do**:
  - 不修改已有类型定义的结构（只添加新字段，全部可选）
  - 不删除或重命名任何现有导出

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯类型定义，无逻辑实现，参照现有类型风格
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:144-168` - EventPayload 现有结构，新增字段遵循相同的可选字段模式
  - `src/types.ts:25-34` - NotificationConfig 现有结构，新字段用 `cost?:` 可选

  **API/Type References**:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:98-127` - AssistantMessage 的 cost/tokens/modelID/providerID/mode 字段结构，新 TokenData 类型应对齐此结构
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:117-125` - tokens 嵌套结构 { input, output, reasoning, cache: { read, write } }

  **WHY Each Reference Matters**:
  - EventPayload: 理解现有字段命名风格（camelCase，全部可选），保持一致
  - AssistantMessage: TokenData 的字段名应与 SDK 的 tokens 子结构对齐，方便直接映射

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 编写类型编译测试：import 所有新类型，赋值验证 TypeScript 不报错
  - [ ] `bun run typecheck` 通过

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 新类型可正确导入和使用
    Tool: Bash (bun run typecheck)
    Preconditions: types.ts 已更新
    Steps:
      1. bun run typecheck
      2. Assert exit code 0, no errors
    Expected Result: TypeScript 编译通过，新类型无类型错误
    Failure Indicators: 任何类型错误
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: 现有代码不受影响
    Tool: Bash (bun test)
    Preconditions: types.ts 已更新，无其他文件改动
    Steps:
      1. bun test
      2. Assert all tests pass (0 failures)
    Expected Result: 所有现有测试仍然通过
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-1-existing-tests.txt
  ```

  **Commit**: YES (1)
  - Message: `feat(types): add TokenData, CostConfig types and EventPayload cost fields`
  - Files: `src/types.ts`
  - Pre-commit: `bun run typecheck`

- [x] 2. 扩展 config.ts - 货币/汇率/精度配置加载与合并

  **What to do**:
  - 在 `loadConfig()` 中解析新增的 `cost` 配置项
  - 实现默认值逻辑：
    - `currency`: 未配置时从 `language` 推断（zh->'CNY', en->'USD'，默认 'USD'）
    - `exchangeRate`: 默认 7.25（USD->CNY 的近似汇率）
    - `decimalPlaces`: 默认 4
    - `enableOnlineRate`: 默认 false
  - 项目级配置覆盖全局级配置（遵循现有合并模式，用 `??` 运算符）
  - 添加配置校验：currency 必须在 SUPPORTED_CURRENCIES 中，exchangeRate > 0，decimalPlaces 1-8
  - 校验失败时记录 logger.warn 并使用默认值（不阻塞插件加载）

  **Must NOT do**:
  - 不修改现有配置合并逻辑的核心流程
  - 不添加在线汇率获取的网络请求
  - 不在配置校验失败时抛出异常（warn + 默认值即可）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 遵循现有 config.ts 的合并模式，增量添加字段
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 6
  - **Blocked By**: None (但类型参考 Task 1，如果 Task 1 未完成，先手动定义 CostConfig)

  **References**:

  **Pattern References**:
  - `src/config.ts` 全文 - 现有的 loadConfig、mergeConfig、validateConfig 模式
  - `src/config.ts` 中的项目级/全局级合并逻辑 - 用 `??` 运算符，项目级优先

  **Test References**:
  - `tests/config.test.ts` - 现有配置测试结构，describe/test 分组模式，mock.module 用法

  **WHY Each Reference Matters**:
  - config.ts: 理解配置加载的完整流程（文件读取、JSON解析、合并、校验），新字段融入此流程
  - config.test.ts: 理解测试分组（全局/项目/合并/校验），新配置项测试应加入对应分组

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 先写测试：currency 默认推断、显式配置覆盖、exchangeRate 校验、项目覆盖全局
  - [ ] `bun test tests/config.test.ts` 通过

  **QA Scenarios:**

  ```
  Scenario: language=zh 时默认货币为 CNY
    Tool: Bash (bun test)
    Steps:
      1. 配置 language='zh'，不设 cost.currency
      2. bun test tests/config.test.ts --test-name-pattern "currency"
      3. Assert 解析后 currency === 'CNY'
    Expected Result: 货币正确推断
    Evidence: .sisyphus/evidence/task-2-currency-zh.txt

  Scenario: 显式 currency 配置覆盖 language 推断
    Tool: Bash (bun test)
    Steps:
      1. 配置 language='zh', cost.currency='USD'
      2. Assert 解析后 currency === 'USD'（显式覆盖生效）
    Expected Result: 显式配置优先
    Evidence: .sisyphus/evidence/task-2-currency-override.txt

  Scenario: 无效 currency 值时使用默认值
    Tool: Bash (bun test)
    Steps:
      1. 配置 cost.currency='EUR'（不在 SUPPORTED_CURRENCIES 中）
      2. Assert 使用默认值 'USD'，并记录 warn 日志
    Expected Result: 优雅降级
    Evidence: .sisyphus/evidence/task-2-invalid-currency.txt
  ```

  **Commit**: YES (2)
  - Message: `feat(config): add currency, exchangeRate, decimalPlaces config`
  - Files: `src/config.ts`, `tests/config.test.ts`
  - Pre-commit: `bun test tests/config.test.ts`

- [x] 3. 新建 cost.ts - 费用计算与货币格式化模块 (TDD)

  **What to do**:
  - 新建 `src/cost.ts` 模块，导出以下函数：
    - `formatCost(costUSD: number, currency: string, decimalPlaces: number): string` - 将 USD 费用格式化为指定货币字符串
    - `convertCurrency(costUSD: number, targetCurrency: string, exchangeRate: number): number` - 货币转换
    - `getCurrencySymbol(currency: string): string` - 获取货币符号（USD->'$', CNY->'¥' 或 '元'）
    - `resolveCostConfig(language?: string, costConfig?: CostConfig): ResolvedCostConfig` - 根据语言和配置解析最终费用配置
  - `ResolvedCostConfig` 类型：currency, exchangeRate, decimalPlaces, currencySymbol
  - formatCost 实现：
    - USD: `$0.0423`（前缀符号）
    - CNY: `¥0.31` 或 `0.31元`（可讨论，建议 `¥0.31` 统一前缀风格）
  - 边界处理：cost=0 时返回 `$0` / `¥0`，负数原样格式化（不应出现但防御性处理）
  - 精度处理：使用 toFixed() 而非 toPrecision()

  **Must NOT do**:
  - 不添加 HTTP 请求获取在线汇率
  - 不修改 template.ts
  - 不在顶层导入任何外部依赖（只用纯数学运算）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 独立模块，需要 TDD 先写测试，包含货币转换逻辑和边界处理
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: Task 1（需要 CostConfig 类型定义）

  **References**:

  **Pattern References**:
  - `src/template.ts` - 简单工具函数模块的风格参考（导出纯函数，无副作用）

  **API/Type References**:
  - `src/types.ts`（Task 1 产出）- CostConfig 类型

  **WHY Each Reference Matters**:
  - template.ts: 理解工具函数模块的导出风格，保持一致

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 先写 tests/cost.test.ts：formatCost USD/CNY、convertCurrency、getCurrencySymbol、resolveCostConfig、边界（0/负数/大数）
  - [ ] `bun test tests/cost.test.ts` 通过

  **QA Scenarios:**

  ```
  Scenario: USD 格式化正常工作
    Tool: Bash (bun test)
    Steps:
      1. formatCost(0.0423, 'USD', 4)
      2. Assert result === '$0.0423'
    Expected Result: 正确的 USD 格式化输出
    Evidence: .sisyphus/evidence/task-3-usd-format.txt

  Scenario: CNY 格式化使用汇率转换
    Tool: Bash (bun test)
    Steps:
      1. formatCost(0.0423, 'CNY', 2) with exchangeRate=7.25
      2. Assert result 包含 '¥' 且数值约为 0.31
    Expected Result: 正确的 CNY 转换和格式化
    Evidence: .sisyphus/evidence/task-3-cny-format.txt

  Scenario: cost=0 时不报错
    Tool: Bash (bun test)
    Steps:
      1. formatCost(0, 'USD', 4)
      2. Assert result === '$0'
    Expected Result: 零费用优雅处理
    Evidence: .sisyphus/evidence/task-3-zero-cost.txt

  Scenario: resolveCostConfig 从语言推断默认值
    Tool: Bash (bun test)
    Steps:
      1. resolveCostConfig('zh', undefined)
      2. Assert currency === 'CNY', exchangeRate 有默认值
    Expected Result: zh -> CNY 默认
    Evidence: .sisyphus/evidence/task-3-resolve-zh.txt
  ```

  **Commit**: YES (3)
  - Message: `feat(cost): add cost calculation and currency formatting module`
  - Files: `src/cost.ts`, `tests/cost.test.ts`
  - Pre-commit: `bun test tests/cost.test.ts`

- [x] 4. index.ts - message.updated 事件处理 + tokenDataMap 累积 (TDD)

  **What to do**:
  - 在 `NotificationPlugin` 闭包中新增 `tokenDataMap: Map<string, SessionTokenData>`
  - `SessionTokenData` 结构：
    ```typescript
    {
      messages: Map<string, { cost, tokens, modelID, providerID, mode }>,  // key=message.id, 去重
      lastModelID: string,
      lastProviderID: string,
      lastMode: string,
    }
    ```
  - 处理 `message.updated` 事件：
    - 检查 `info.role === 'assistant'`（跳过 UserMessage）
    - 按 `info.sessionID` 查找/创建 SessionTokenData
    - 按 `info.id`（message ID）存储/覆盖（不累加，因为流式响应会多次更新同一条消息）
    - 更新 lastModelID/lastProviderID/lastMode
  - 计算 `totalCost`/`totalTokens`（含子会话）：
    - 当构建 payload 时，查找 tokenDataMap 中所有 `parentID === currentSessionID` 的子会话
    - 累加当前会话 + 所有子会话的 cost 和 tokens
  - 在 `eventToPayload()` 中从 tokenDataMap 读取数据填充 payload 新字段
  - 使用 `resolveCostConfig()` 获取格式化配置，调用 `formatCost()` 填充 costFormatted/totalCostFormatted
  - session.idle/error 后从 tokenDataMap 中删除对应条目（内存清理）
  - 延迟导入 cost.ts（遵循项目的延迟导入模式）

  **Must NOT do**:
  - 不在顶层 import cost.ts（用动态 import 或在函数内 import）
  - 不修改现有的 sessionMap 逻辑
  - 不处理 StepFinishPart（只用 AssistantMessage）
  - 不在 eventToPayload 中为 session.created 填充 token 数据

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心数据累积逻辑，需要处理流式更新去重、子会话聚合、内存清理等复杂逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/index.ts:278-336` - sessionMap 的使用模式（created 时 set, updated 时 set, idle 时通过 sessionID 查找）
  - `src/index.ts:40-173` - eventToPayload 的结构（switch + default 分支处理非标准事件）
  - `src/index.ts:235-383` - NotificationPlugin 闭包结构，新 map 应在此闭包内

  **API/Type References**:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:98-127` - AssistantMessage 完整类型
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:129-134` - EventMessageUpdated 类型
  - `src/types.ts`（Task 1 产出）- TokenData, TokenBreakdown, EventPayload 新字段

  **Test References**:
  - `tests/index.test.ts` - 现有测试的 createMockEvent 模式、describe/test 结构
  - `tests/index.test.ts` 中的 sessionMap 测试 - 理解如何模拟 session.created + session.idle 流程

  **WHY Each Reference Matters**:
  - sessionMap 模式: tokenDataMap 应遵循完全相同的管理模式（生命周期与 session 对齐）
  - AssistantMessage: 需要精确知道哪些字段可用（cost, tokens.*, modelID 等）
  - createMockEvent: 新测试需要模拟 message.updated 事件，复用此 helper

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 先写测试：message.updated 处理、同消息去重、不同消息累加、UserMessage 跳过、子会话聚合、session.idle 清理
  - [ ] `bun test tests/index.test.ts` 通过

  **QA Scenarios:**

  ```
  Scenario: 单条 AssistantMessage 的 token 数据被正确累积
    Tool: Bash (bun test)
    Steps:
      1. 模拟 session.created -> message.updated(AssistantMessage, cost=0.05) -> session.idle
      2. Assert idle payload 中 sessionCost === 0.05
      3. Assert sessionTokens 有正确的分项数据
    Expected Result: token 数据正确传递到 payload
    Evidence: .sisyphus/evidence/task-4-single-message.txt

  Scenario: 同一 message.id 的多次更新不重复累加
    Tool: Bash (bun test)
    Steps:
      1. 模拟 session.created -> message.updated(msg-1, cost=0.03) -> message.updated(msg-1, cost=0.05)
      2. Assert sessionCost === 0.05（最后一次值，不是 0.08）
    Expected Result: 按消息 ID 去重
    Evidence: .sisyphus/evidence/task-4-dedup.txt

  Scenario: 不同 message.id 在同一 session 中累加
    Tool: Bash (bun test)
    Steps:
      1. 模拟 session.created -> message.updated(msg-1, cost=0.03) -> message.updated(msg-2, cost=0.04)
      2. Assert sessionCost === 0.07
    Expected Result: 跨消息正确累加
    Evidence: .sisyphus/evidence/task-4-accumulate.txt

  Scenario: UserMessage 被静默跳过
    Tool: Bash (bun test)
    Steps:
      1. 模拟 session.created -> message.updated(UserMessage) -> message.updated(AssistantMessage, cost=0.05)
      2. Assert sessionCost === 0.05（UserMessage 不影响）
    Expected Result: UserMessage 不干扰累积
    Evidence: .sisyphus/evidence/task-4-user-message.txt

  Scenario: 子会话 token 合并到 totalCost/totalTokens
    Tool: Bash (bun test)
    Steps:
      1. 模拟 main session.created -> sub session.created(parentID=main) -> sub message.updated(cost=0.03)
      2. 模拟 main message.updated(cost=0.05) -> main session.idle
      3. Assert sessionCost === 0.05, totalCost === 0.08
    Expected Result: totalCost 包含子会话
    Evidence: .sisyphus/evidence/task-4-subsession.txt

  Scenario: session.idle 后 tokenDataMap 条目被清理
    Tool: Bash (bun test)
    Steps:
      1. 模拟完整流程到 session.idle
      2. Assert tokenDataMap 中对应 session 的条目已删除
    Expected Result: 内存清理正确
    Evidence: .sisyphus/evidence/task-4-cleanup.txt

  Scenario: 无 token 数据时 payload 字段为 undefined
    Tool: Bash (bun test)
    Steps:
      1. 模拟 session.created -> session.idle（无 message.updated）
      2. Assert sessionCost === undefined, totalCost === undefined
    Expected Result: 无数据时不报错，字段为空
    Evidence: .sisyphus/evidence/task-4-no-data.txt
  ```

  **Commit**: YES (4)
  - Message: `feat(index): handle message.updated event for token accumulation`
  - Files: `src/index.ts`, `tests/index.test.ts`
  - Pre-commit: `bun test tests/index.test.ts`

- [x] 5. handler.ts - 新模板变量映射 (TDD)

  **What to do**:
  - 在 handler.ts 的 `variables` 对象（约 109-131 行）中添加以下新变量：
    ```
    // 当前会话维度
    sessionCost, sessionCostFormatted,
    sessionTokensInput, sessionTokensOutput, sessionTokensReasoning,
    sessionTokensCacheRead, sessionTokensCacheWrite, sessionTokensTotal,
    // 含子会话维度
    totalCost, totalCostFormatted,
    totalTokensInput, totalTokensOutput, totalTokensReasoning,
    totalTokensCacheRead, totalTokensCacheWrite, totalTokensTotal,
    // 模型信息
    modelID, providerID, mode,
    // 货币信息
    currency
    ```
  - 所有新变量从 payload 对应字段取值，值为 undefined 时渲染为空字符串（template.ts 已有此行为）
  - 确保变量名与 EventPayload 新增字段名完全一致

  **Must NOT do**:
  - 不修改 renderTemplate 函数
  - 不添加条件逻辑（template.ts 保持纯替换）
  - 不修改 ChannelFormatter 接口

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的变量映射，只需在现有 variables 对象中添加字段
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 3

  **References**:

  **Pattern References**:
  - `src/handler.ts:109-131` - 现有 variables 对象结构，新变量直接追加到此对象

  **Test References**:
  - `tests/handler.test.ts` - 现有 handler 测试，理解如何验证渲染结果中的变量

  **WHY Each Reference Matters**:
  - handler.ts variables: 这是模板变量的唯一定义点，需要精确对齐 EventPayload 字段名

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 先写测试：带 token 数据的 payload 渲染后包含正确的费用/token 值
  - [ ] `bun test tests/handler.test.ts` 通过

  **QA Scenarios:**

  ```
  Scenario: 带 token 数据的 payload 正确渲染所有新变量
    Tool: Bash (bun test)
    Steps:
      1. 构造含 sessionCost=0.05, modelID='claude-sonnet-4' 的 payload
      2. 调用 handler 处理 idle 事件
      3. Assert 渲染后的 subject/body 包含 '0.05' 和 'claude-sonnet-4'
    Expected Result: 新变量正确出现在渲染输出中
    Evidence: .sisyphus/evidence/task-5-render.txt

  Scenario: 无 token 数据时模板不报错
    Tool: Bash (bun test)
    Steps:
      1. 构造不含 token 数据的 payload（现有格式）
      2. 调用 handler 处理 idle 事件
      3. Assert 无错误，{{sessionCost}} 渲染为空字符串
    Expected Result: 向后兼容，空值不报错
    Evidence: .sisyphus/evidence/task-5-empty.txt
  ```

  **Commit**: YES (5)
  - Message: `feat(handler): add token/cost/model template variables`
  - Files: `src/handler.ts`, `tests/handler.test.ts`
  - Pre-commit: `bun test tests/handler.test.ts`

- [x] 6. locales.ts - 中英文默认模板增加 token/费用/模型信息 (TDD)

  **What to do**:
  - 更新 `idle` 事件的中英文模板 body，在现有内容后追加 token/费用/模型信息节：
    - 中文模板增加：
      ```
      费用: {{totalCostFormatted}}
      Token: 输入 {{totalTokensInput}} / 输出 {{totalTokensOutput}} / 推理 {{totalTokensReasoning}}
      缓存: 读取 {{totalTokensCacheRead}} / 写入 {{totalTokensCacheWrite}}
      合计: {{totalTokensTotal}}
      模型: {{modelID}} ({{providerID}})
      ```
    - 英文模板增加：
      ```
      Cost: {{totalCostFormatted}}
      Tokens: Input {{totalTokensInput}} / Output {{totalTokensOutput}} / Reasoning {{totalTokensReasoning}}
      Cache: Read {{totalTokensCacheRead}} / Write {{totalTokensCacheWrite}}
      Total: {{totalTokensTotal}}
      Model: {{modelID}} ({{providerID}})
      ```
  - 更新 `error` 事件的中英文模板 body，在错误信息后追加简要的 token/费用信息（如果有的话）
  - 更新 `created` 事件模板：不追加（此时无 token 数据）
  - 其他事件模板：仅追加一行简略费用 `{{sessionCostFormatted}}`（如果有的话）
  - 确保模板中的变量名与 handler.ts 中的 variables 对象字段名完全一致

  **Must NOT do**:
  - 不添加条件模板语法（如 {{#if cost}}）
  - 不修改 template.ts 的渲染逻辑
  - 不在 session.created 模板中添加 token 信息

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要同时更新中英文多套模板，确保一致性和正确的变量引用
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/locales.ts` 全文 - 现有中英文模板结构，按事件类型组织的模板对象
  - `src/locales.ts` 中的 getDefaultTemplates(language) - 模板的语言分发逻辑

  **Test References**:
  - `tests/locales.test.ts` - 现有 locales 测试，验证模板变量解析

  **WHY Each Reference Matters**:
  - locales.ts: 理解模板的文本格式（换行符、缩进风格），新模板段落应与现有风格一致

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 先写测试：idle/error 模板包含 {{totalCostFormatted}}、{{totalTokensTotal}}、{{modelID}} 变量
  - [ ] `bun test tests/locales.test.ts` 通过

  **QA Scenarios:**

  ```
  Scenario: 中文 idle 模板包含费用和 token 变量
    Tool: Bash (bun test)
    Steps:
      1. 获取 zh 的 idle 模板 body
      2. Assert body 包含 '{{totalCostFormatted}}'
      3. Assert body 包含 '{{totalTokensTotal}}'
      4. Assert body 包含 '{{modelID}}'
    Expected Result: 中文模板包含所有新变量
    Evidence: .sisyphus/evidence/task-6-zh-idle.txt

  Scenario: 英文 idle 模板包含费用和 token 变量
    Tool: Bash (bun test)
    Steps:
      1. 获取 en 的 idle 模板 body
      2. Assert body 包含 '{{totalCostFormatted}}'
      3. Assert body 包含 '{{totalTokensTotal}}'
      4. Assert body 包含 '{{modelID}}'
    Expected Result: 英文模板包含所有新变量
    Evidence: .sisyphus/evidence/task-6-en-idle.txt

  Scenario: session.created 模板不包含 token 变量
    Tool: Bash (bun test)
    Steps:
      1. 获取 zh 和 en 的 created 模板 body
      2. Assert 不包含 '{{totalCostFormatted}}' 或 '{{sessionCostFormatted}}'
    Expected Result: created 事件模板保持简洁
    Evidence: .sisyphus/evidence/task-6-created.txt
  ```

  **Commit**: YES (6)
  - Message: `feat(locales): update default templates with token/cost/model info`
  - Files: `src/locales.ts`, `tests/locales.test.ts`
  - Pre-commit: `bun test tests/locales.test.ts`

- [x] 7. 集成测试 - 端到端 message.updated -> idle 通知含 token 数据 (TDD)

  **What to do**:
  - 在 `tests/integration/full-flow.test.ts` 中新增测试用例：
    - 完整流程：session.created -> message.updated(AssistantMessage) -> session.idle -> 验证通知内容
    - 多消息累积：session.created -> message.updated(msg-1) -> message.updated(msg-2) -> session.idle -> 验证累加
    - 子会话合并：main session.created -> sub session.created -> sub message.updated -> main message.updated -> main session.idle -> 验证 totalCost 包含子会话
    - 货币格式化：验证 zh 配置下通知中出现 ¥ 符号，en 配置下出现 $ 符号
    - 零费用场景：无 message.updated 时 session.idle 的通知中不出现 NaN 或 undefined
  - 复用现有的 mock-transport.ts 和 sample-configs.ts 工具

  **Must NOT do**:
  - 不修改现有集成测试的断言
  - 不引入真实的 SMTP/Webhook 调用

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 集成测试需要模拟完整的多步骤事件流，验证跨模块数据传递
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 8)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 4, 5, 6

  **References**:

  **Pattern References**:
  - `tests/integration/full-flow.test.ts` - 现有集成测试结构，模拟完整事件流

  **Test References**:
  - `tests/utils/mock-transport.ts` - nodemailer mock transport
  - `tests/utils/sample-configs.ts` - 共享测试配置

  **WHY Each Reference Matters**:
  - full-flow.test.ts: 理解集成测试的 setup/teardown 模式和事件注入方式

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] 先写集成测试用例
  - [ ] `bun test tests/integration/full-flow.test.ts` 通过

  **QA Scenarios:**

  ```
  Scenario: 端到端 token 追踪完整流程
    Tool: Bash (bun test)
    Steps:
      1. bun test tests/integration/full-flow.test.ts
      2. Assert all tests pass
    Expected Result: 所有集成测试通过
    Evidence: .sisyphus/evidence/task-7-e2e.txt

  Scenario: 完整测试套件通过
    Tool: Bash (bun test)
    Steps:
      1. bun test
      2. Assert 0 failures
    Expected Result: 所有测试通过
    Evidence: .sisyphus/evidence/task-7-full-suite.txt
  ```

  **Commit**: YES (7)
  - Message: `test(integration): end-to-end token tracking flow`
  - Files: `tests/integration/full-flow.test.ts`
  - Pre-commit: `bun test tests/integration/full-flow.test.ts`

- [x] 8. CLI 测试工具更新 - 支持新配置项的测试

  **What to do**:
  - 更新 `src/cli.ts` 中的测试消息构建逻辑，在模拟事件中包含 token 数据
  - 确保 `npx @ulthon/ul-opencode-event test` 命令能正确处理新增的 cost 配置项
  - 测试通知消息中应包含示例的 token/费用/模型信息（模拟数据）
  - 验证新配置项在 CLI 模式下不报错

  **Must NOT do**:
  - 不修改 CLI 的核心命令解析逻辑
  - 不添加新的 CLI 子命令

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 在现有 CLI 测试消息中追加 token 模拟数据，改动量小
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 4, 5

  **References**:

  **Pattern References**:
  - `src/cli.ts` 全文 - CLI 工具的测试消息构建和发送逻辑

  **WHY Each Reference Matters**:
  - cli.ts: 理解 CLI 如何构建模拟事件和发送测试通知

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: CLI 测试命令正常工作
    Tool: Bash (npm run build + node dist/cli.js)
    Steps:
      1. npm run build
      2. node dist/cli.js test --no-send
      3. Assert exit code 0, no errors
    Expected Result: CLI 测试不报错
    Evidence: .sisyphus/evidence/task-8-cli.txt

  Scenario: 构建产物完整
    Tool: Bash (npm run build)
    Steps:
      1. npm run build
      2. Assert dist/ 目录包含所有预期文件
    Expected Result: 干净构建
    Evidence: .sisyphus/evidence/task-8-build.txt
  ```

  **Commit**: YES (8)
  - Message: `feat(cli): update test CLI tool for new config`
  - Files: `src/cli.ts`
  - Pre-commit: `npm run build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run typecheck` + `bun run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Run `npm run build && node dist/cli.js test` to verify CLI tool. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Test edge cases: zero cost, no token data, CNY/USD switching. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit 1**: `feat(types): add TokenData, CostConfig types and EventPayload cost fields` - src/types.ts
  - Pre-commit: `bun run typecheck`
- **Commit 2**: `feat(config): add currency, exchangeRate, decimalPlaces config` - src/config.ts, tests/config.test.ts
  - Pre-commit: `bun test tests/config.test.ts`
- **Commit 3**: `feat(cost): add cost calculation and currency formatting module` - src/cost.ts, tests/cost.test.ts
  - Pre-commit: `bun test tests/cost.test.ts`
- **Commit 4**: `feat(index): handle message.updated event for token accumulation` - src/index.ts, tests/index.test.ts
  - Pre-commit: `bun test tests/index.test.ts`
- **Commit 5**: `feat(handler): add token/cost/model template variables` - src/handler.ts, tests/handler.test.ts
  - Pre-commit: `bun test tests/handler.test.ts`
- **Commit 6**: `feat(locales): update default templates with token/cost/model info` - src/locales.ts, tests/locales.test.ts
  - Pre-commit: `bun test tests/locales.test.ts`
- **Commit 7**: `test(integration): end-to-end token tracking flow` - tests/integration/full-flow.test.ts
  - Pre-commit: `bun test tests/integration/full-flow.test.ts`
- **Commit 8**: `feat(cli): update test CLI tool for new config` - src/cli.ts
  - Pre-commit: `npm run build`

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck   # Expected: 0 errors
bun run lint        # Expected: 0 errors
bun test            # Expected: all pass, 0 failures
npm run build       # Expected: clean build to dist/
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (bun test)
- [ ] typecheck 通过
- [ ] lint 通过
- [ ] 中英文模板都包含 token/费用/模型信息
- [ ] sessionCost vs totalCost 正确区分
- [ ] zh -> CNY, en -> USD 默认生效
- [ ] 可配置小数位和汇率
