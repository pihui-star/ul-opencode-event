# 新增 Token Human-Readable 格式化变量

## TL;DR

> **Quick Summary**: 新增 12 个 Human 后缀的 token 格式化变量（如 127.1K），默认模板替换为格式化版，保留原始变量供自定义模板使用。
> 
> **Deliverables**:
> - `handler.ts`: 新增 `formatTokenCount()` 函数 + 12 个格式化变量映射
> - `locales.ts`: 16 个默认模板替换为 Human 变量
> - `docs/template-configuration.md`: 文档更新
> - 测试覆盖: 格式化函数 + 变量映射 + 模板断言
> 
> **Estimated Effort**: Short
> **Parallel Execution**: NO - 3 次原子提交顺序执行
> **Critical Path**: Task 1 (函数+变量) -> Task 2 (模板) -> Task 3 (文档)

---

## Context

### Original Request
用户希望 token 相关变量支持带单位的写法（如 127.1K），并把默认模板中的替换为带单位的。

### Interview Summary
**Key Discussions**:
- 变量命名: `Human` 后缀（如 `sessionTokensTotalHuman`）
- 范围: 所有 6 个字段 (input/output/reasoning/cacheRead/cacheWrite/total) x 2 (session/total) = 12 个新变量
- 格式规则: 1 位小数 + K/M/B 后缀（127100 → 127.1K）
- 默认模板仅替换变量名，不添加新信息
- 保留原始变量供自定义模板使用

### Metis Review
**Identified Gaps** (addressed):
- 格式化函数放 handler.ts 作为模块私有函数，不新建文件
- NaN 防御: 返回 `"0"`
- 浮点数: 格式化前 `Math.floor()` 取整（token 计数实际为整数）
- 边界行为: 简单范围判断（<1000 原始, <1M → K, <1B → M, >=1B → B），999999 → `1000.0K`
- 不添加 T 后缀，不修改 cli.ts 的 `formatTokenInfo()`
- 集成测试 token 值均 <1000，格式化输出与原始一致，无需改断言值

---

## Work Objectives

### Core Objective
为 token 变量新增人类可读的格式化版本，默认模板使用格式化版，自定义模板仍可使用原始精确值。

### Concrete Deliverables
- `handler.ts`: `formatTokenCount()` + 12 个新变量映射
- `locales.ts`: 16 个默认模板更新
- `docs/template-configuration.md`: 新变量文档
- `tests/handler.test.ts`: 格式化函数测试 + Human 变量映射测试
- `tests/locales.test.ts`: 模板断言更新

### Definition of Done
- [ ] `bun test` 全部通过
- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过

### Must Have
- `formatTokenCount(n: number): string` 函数: 0 → "0", 127100 → "127.1K", 1500000 → "1.5M", 1000000000 → "1.0B"
- 12 个 Human 后缀变量: sessionTokensInputHuman, sessionTokensOutputHuman, sessionTokensReasoningHuman, sessionTokensCacheReadHuman, sessionTokensCacheWriteHuman, sessionTokensTotalHuman, totalTokensInputHuman, totalTokensOutputHuman, totalTokensReasoningHuman, totalTokensCacheReadHuman, totalTokensCacheWriteHuman, totalTokensTotalHuman
- 默认模板替换: `{{sessionTokensTotal}}` → `{{sessionTokensTotalHuman}}`, `{{totalTokensTotal}}` → `{{totalTokensTotalHuman}}`
- NaN 防御: `formatTokenCount(NaN)` → `"0"`
- 浮点数取整: `Math.floor()` 后再格式化

### Must NOT Have (Guardrails)
- 不修改 `types.ts`（TokenBreakdown 接口不变）
- 不修改 `template.ts`（模板引擎不变）
- 不修改 `formatters.ts`、`cost.ts`、`index.ts`
- 不修改 `cli.ts` 的 `formatTokenInfo()`
- 不删除/重命名任何现有 12 个原始 token 变量
- 不新建源文件
- 不在默认模板中添加新信息（不加 token 明细、费用、providerID）
- 不添加 T（万亿）后缀

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: TDD（先写测试，再实现）
- **Framework**: bun test

---

## Execution Strategy

### Sequential Commits (3 waves)

```
Wave 1 (TDD - function + variables):
└── Task 1: Add formatTokenCount + 12 Human variables + tests [unspecified-high]

Wave 2 (after Wave 1):
└── Task 2: Update default templates to use Human variables + tests [quick]

Wave 3 (after Wave 2):
└── Task 3: Update documentation [quick]
```

### Agent Dispatch Summary
- **1**: **1** - T1 -> `unspecified-high`
- **2**: **1** - T2 -> `quick`
- **3**: **1** - T3 -> `quick`

---

## TODOs

- [x] 1. Add formatTokenCount utility + 12 Human variables + tests

  **What to do**:

  **Step 1: 在 `src/handler.ts` 顶部添加 `formatTokenCount` 函数**

  ```typescript
  /**
   * Format a token count as a human-readable string with K/M/B suffix.
   * Examples: 0 → "0", 127100 → "127.1K", 1500000 → "1.5M", 1000000000 → "1.0B"
   */
  function formatTokenCount(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const abs = Math.floor(Math.abs(n));
    if (abs < 1000) return String(abs);
    if (abs < 1_000_000) return (abs / 1000).toFixed(1) + 'K';
    if (abs < 1_000_000_000) return (abs / 1_000_000).toFixed(1) + 'M';
    return (abs / 1_000_000_000).toFixed(1) + 'B';
  }
  ```

  **Step 2: 在 `handler.ts` variables 对象中添加 12 个新变量**

  在现有每个原始 token 变量之后，添加对应的 Human 变量。位置约 lines 134-147，紧跟原始变量行：

  ```typescript
  sessionTokensInputHuman: payload.sessionTokens?.input != null ? formatTokenCount(payload.sessionTokens.input) : undefined,
  sessionTokensOutputHuman: payload.sessionTokens?.output != null ? formatTokenCount(payload.sessionTokens.output) : undefined,
  sessionTokensReasoningHuman: payload.sessionTokens?.reasoning != null ? formatTokenCount(payload.sessionTokens.reasoning) : undefined,
  sessionTokensCacheReadHuman: payload.sessionTokens?.cacheRead != null ? formatTokenCount(payload.sessionTokens.cacheRead) : undefined,
  sessionTokensCacheWriteHuman: payload.sessionTokens?.cacheWrite != null ? formatTokenCount(payload.sessionTokens.cacheWrite) : undefined,
  sessionTokensTotalHuman: payload.sessionTokens?.total != null ? formatTokenCount(payload.sessionTokens.total) : undefined,
  totalTokensInputHuman: payload.totalTokens?.input != null ? formatTokenCount(payload.totalTokens.input) : undefined,
  totalTokensOutputHuman: payload.totalTokens?.output != null ? formatTokenCount(payload.totalTokens.output) : undefined,
  totalTokensReasoningHuman: payload.totalTokens?.reasoning != null ? formatTokenCount(payload.totalTokens.reasoning) : undefined,
  totalTokensCacheReadHuman: payload.totalTokens?.cacheRead != null ? formatTokenCount(payload.totalTokens.cacheRead) : undefined,
  totalTokensCacheWriteHuman: payload.totalTokens?.cacheWrite != null ? formatTokenCount(payload.totalTokens.cacheWrite) : undefined,
  totalTokensTotalHuman: payload.totalTokens?.total != null ? formatTokenCount(payload.totalTokens.total) : undefined,
  ```

  **Step 3: 在 `tests/handler.test.ts` 添加测试**

  新增 describe 块 "formatTokenCount" 测试:
  - `0` → `"0"`
  - `1` → `"1"`
  - `999` → `"999"`
  - `1000` → `"1.0K"`
  - `127100` → `"127.1K"`
  - `999999` → `"1000.0K"`
  - `1500000` → `"1.5M"`
  - `1000000000` → `"1.0B"`
  - `1500000000` → `"1.5B"`
  - `NaN` → `"0"`
  - `Infinity` → `"0"`

  新增 describe 块 "Human token variables" 测试:
  - 验证 payload 含 token 数据时，渲染后的消息包含格式化值（如 `127.1K`）
  - 验证 payload 无 token 数据时，Human 变量渲染为空字符串
  - 使用自定义模板 `Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}})` 测试

  注意: `formatTokenCount` 是模块私有函数，不能直接导出测试。通过 handler 渲染结果间接测试，或者将函数导出用于测试。

  **推荐方案**: 在 handler.ts 中 `export function formatTokenCount(...)` 使其可测试。虽然它是 handler 的辅助函数，但独立的格式化函数导出是合理的。

  **Step 4: 运行验证**
  ```bash
  bun test
  npm run typecheck
  ```

  **Must NOT do**:
  - 不修改 locales.ts（Task 2 处理）
  - 不修改任何现有测试的断言值
  - 不修改 types.ts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要在 handler.ts 精确添加函数和 12 个变量映射，并编写配套测试
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/handler.ts:109-152` - 变量映射区，新变量紧跟现有变量行
  - `src/types.ts:232-239` - TokenBreakdown 接口（6 个 number 字段）
  - `tests/handler.test.ts:702-890` - 现有 token 测试，参考测试结构

  **WHY Each Reference Matters**:
  - handler.ts: 唯一需要添加代码的源文件
  - types.ts: 确认字段名（input/output/reasoning/cacheRead/cacheWrite/total）
  - handler.test.ts: 参考现有 token 测试的 mock 模式和断言风格

  **Acceptance Criteria**:

  - [ ] `formatTokenCount` 函数已添加到 handler.ts
  - [ ] 12 个 Human 变量已添加到 variables 对象
  - [ ] 格式化函数测试覆盖所有边界情况
  - [ ] Human 变量映射测试验证正确渲染
  - [ ] `bun test` 通过
  - [ ] `npm run typecheck` 通过

  **QA Scenarios:**

  ```
  Scenario: formatTokenCount produces correct output
    Tool: Bash
    Steps:
      1. Run `bun test tests/handler.test.ts`
      2. Assert all formatTokenCount tests pass
    Expected Result: formatTokenCount(127100) === "127.1K", formatTokenCount(0) === "0"
    Evidence: .sisyphus/evidence/task-1-format-tests.txt

  Scenario: Human variables render correctly in templates
    Tool: Bash
    Steps:
      1. Run `bun test tests/handler.test.ts`
      2. Assert Human variable tests pass
    Expected Result: Custom template with {{sessionTokensTotalHuman}} renders "127.1K"
    Evidence: .sisyphus/evidence/task-1-human-var-tests.txt
  ```

  **Commit**: YES
  - Message: `feat: 添加formatTokenCount工具函数和12个Human后缀token格式化变量`
  - Files: `src/handler.ts`, `tests/handler.test.ts`
  - Pre-commit: `bun test`

- [x] 2. Update default templates to use Human variables + tests

  **What to do**:

  **Step 1: 更新 `src/locales.ts` 16 个模板字符串**

  所有非 created 事件模板中的:
  - `{{sessionTokensTotal}}` → `{{sessionTokensTotalHuman}}`
  - `{{totalTokensTotal}}` → `{{totalTokensTotalHuman}}`

  格式变为: `Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}) {{modelID}}`

  created 模板不变。

  **Step 2: 更新 `tests/locales.test.ts` 断言**

  - idle 模板测试: `toContain('{{sessionTokensTotalHuman}}')`, `toContain('{{totalTokensTotalHuman}}')`
  - idle 模板测试: `not.toContain('{{sessionTokensTotal}}')`, `not.toContain('{{totalTokensTotal}}')`（确保已替换）
  - error 模板测试: 同上
  - other events 测试: `toContain('{{sessionTokensTotalHuman}}')`, `toContain('{{totalTokensTotalHuman}}')`
  - created 测试: `not.toContain('{{sessionTokensTotalHuman}}')`, `not.toContain('{{totalTokensTotalHuman}}')`

  **Step 3: 检查集成测试**

  集成测试 `tests/integration/full-flow.test.ts` 中的 token 值（420、940、990）均 < 1000，格式化后与原始一致（"420" → "420"）。断言值无需修改。但应验证确实通过。

  **Step 4: 运行验证**
  ```bash
  bun test
  npm run typecheck
  ```

  **Must NOT do**:
  - 不添加新信息到模板（不加明细、费用、providerID）
  - 不修改 created 模板

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 简单的字符串替换 + 断言更新
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 1

  **References**:
  - `src/locales.ts:29-125` - 16 个模板字符串
  - `tests/locales.test.ts:141-238` - Token 变量断言
  - `tests/integration/full-flow.test.ts:615-785` - 集成测试（验证兼容性）

  **Acceptance Criteria**:
  - [ ] 16 个模板替换为 Human 变量
  - [ ] locales.test.ts 断言更新
  - [ ] `bun test` 通过（含集成测试）
  - [ ] created 模板不变

  **Commit**: YES
  - Message: `feat: 默认模板使用Human格式化的token变量`
  - Files: `src/locales.ts`, `tests/locales.test.ts`
  - Pre-commit: `bun test`

- [x] 3. Update documentation

  **What to do**:

  **Step 1: 更新 `docs/template-configuration.md` 第 5.3 节**

  在现有 token 变量表格之后，新增"格式化变量"子章节:

  #### 会话级别格式化（人类可读）

  | 变量 | 说明 | 示例值 |
  |------|------|--------|
  | `{{sessionTokensTotalHuman}}` | 会话合计 Token（格式化） | `127.1K` |
  | `{{sessionTokensInputHuman}}` | 会话输入 Token（格式化） | `30.2K` |
  | ... | ... | ... |

  #### 全部级别格式化（人类可读）

  同上 6 个 total 级别变量。

  添加说明: 格式化规则为 K/M/B 后缀 + 1 位小数。保留原始变量供需要精确数值的自定义模板使用。

  **Step 2: 更新第 7 节内置默认模板**

  16 个模板中的 `{{sessionTokensTotal}}` → `{{sessionTokensTotalHuman}}`，`{{totalTokensTotal}}` → `{{totalTokensTotalHuman}}`。

  **Must NOT do**:
  - 不修改代码文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocked By**: Task 2

  **Commit**: YES
  - Message: `docs: 文档补充Human格式化token变量，更新默认模板`
  - Files: `docs/template-configuration.md`

---

## Commit Strategy

- **1**: `feat: 添加formatTokenCount工具函数和12个Human后缀token格式化变量` - `src/handler.ts`, `tests/handler.test.ts`
- **2**: `feat: 默认模板使用Human格式化的token变量` - `src/locales.ts`, `tests/locales.test.ts`
- **3**: `docs: 文档补充Human格式化token变量，更新默认模板` - `docs/template-configuration.md`

---

## Success Criteria

### Verification Commands
```bash
bun test            # Expected: all pass, 0 failures
npm run typecheck   # Expected: exit 0
npm run lint        # Expected: exit 0
```

### Final Checklist
- [ ] formatTokenCount 函数正确格式化所有边界值
- [ ] 12 个 Human 变量正确映射
- [ ] 16 个默认模板使用 Human 变量
- [ ] 原始 12 个变量仍然可用
- [ ] created 模板不变
- [ ] 文档更新
