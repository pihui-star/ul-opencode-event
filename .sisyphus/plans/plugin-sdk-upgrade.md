# Plugin SDK 升级：兼容 OpenCode 新版插件加载机制

## TL;DR

> **核心问题**: OpenCode 升级后插件加载器要求 `PluginModule` 格式 (`{ id, server: fn }`)，我们的插件导出的是裸函数，导致 `module.server` 为 undefined，静默加载失败。
> **修复方案**: 改默认导出为 PluginModule 对象，升级 SDK 依赖，保持命名导出不变供测试使用。
>
> **Deliverables**:
> - `src/index.ts` 导出格式改为 PluginModule
> - `package.json` SDK 依赖升级到 1.14.17
> - 构建和测试全部通过
>
> **Estimated Effort**: Quick
> **Parallel Execution**: NO - sequential (仅 2 个文件)
> **Critical Path**: Task 1 (依赖升级) -> Task 2 (代码修改) -> Task 3 (验证)

---

## Context

### Original Request
用户升级 OpenCode 后插件收不到消息。经排查确认根因为新版 OpenCode 的插件加载器 (`PluginLoader`) 不再支持裸函数导出，要求 `PluginModule` 格式。

### Interview Summary
**Key Discussions**:
- 插件完全停止工作：无日志、无事件、无通知
- SDK 从 1.2.27 升级到 1.14.17
- 只有作者自己使用，无需向后兼容
- `question.asked` 运行时事件不受影响（从未在 SDK 类型中定义）
- `showToast` API 不变
- Event/Session/Message 核心类型兼容

**Research Findings**:
- Plugin LOADING 机制变了，Plugin HOOK 接口没变
- `PluginModule = { id?: string, server: Plugin, tui?: never }`
- 加载器代码: `hooks.push(await (plugin as PluginModule).server(input, options))`
- package.json exports 的 `./server` 入口解析正确，无需修改
- 旧版 SDK 中也没有 `question.asked` 事件类型（一直是运行时处理）

### Metis Review
**Identified Gaps** (addressed):
- 命名导出 vs 默认导出: 保留命名导出给测试，默认导出改为 PluginModule (自行决策)
- `options?` 参数: 可选，不影响 TypeScript 编译，但为严谨性应添加
- peerDependency 风险: 新 SDK 有 optional peerDeps (`@opentui/core`), 不影响构建

---

## Work Objectives

### Core Objective
修复插件导出格式，使其兼容新版 OpenCode 的 PluginModule 加载机制。

### Concrete Deliverables
- `src/index.ts`: 默认导出改为 `{ id, server: fn }` 格式，函数签名添加 `options?`
- `package.json`: `@opencode-ai/plugin` 升级到 `1.14.17`
- 构建产物 `dist/index.js` 中 default export 为 PluginModule 对象

### Definition of Done
- [ ] `npm run typecheck` 零错误
- [ ] `npm run build` 成功，dist 文件存在
- [ ] `bun test` 全部通过
- [ ] 构建产物验证: `default` 为对象且 `default.server` 为函数

### Must Have
- 默认导出为 PluginModule 格式
- 命名导出 `NotificationPlugin` 保留（测试依赖）
- `npm run build` 和 `bun test` 通过

### Must NOT Have (Guardrails)
- 不修改任何事件处理逻辑、token 聚合逻辑、通道实现
- 不修改 CLI 入口 (`src/cli.ts`) 或 CLI 测试
- 不修改配置格式或加载逻辑
- 不添加对新事件类型的处理（如 `session.compacted`）
- 不修改 `question.asked` 运行时处理
- 不改变 package.json 的 exports/main/bin/files 字段
- 不引入 `@opentui/core` 或 `@opentui/solid` 依赖

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: Tests-after (现有测试验证不回归)
- **Framework**: bun test

### QA Policy
每个 task 包含 agent-executed QA scenarios。Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Sequential - dependency upgrade):
└── Task 1: Upgrade @opencode-ai/plugin dependency [quick]

Wave 2 (After Wave 1 - code changes):
└── Task 2: Change plugin export to PluginModule format [quick]

Wave 3 (After Wave 2 - verification):
└── Task 3: Build, test, and verify output [unspecified-high]

Wave FINAL (After ALL tasks):
└── Task F1: Scope fidelity check [quick]
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1    | -         | 2, 3   |
| 2    | 1         | 3, F1  |
| 3    | 1, 2      | F1     |
| F1   | 3         | -      |

### Agent Dispatch Summary

- **Wave 1**: 1 task - T1 -> `quick`
- **Wave 2**: 1 task - T2 -> `quick`
- **Wave 3**: 1 task - T3 -> `unspecified-high`
- **FINAL**: 1 task - F1 -> `quick`

---

## TODOs

- [x] 1. 升级 @opencode-ai/plugin 依赖到 1.14.17

  **What to do**:
  - 修改 `package.json` 中 `devDependencies["@opencode-ai/plugin"]` 从 `"latest"` 改为 `"^1.14.17"`
  - 运行 `npm install` 安装新版依赖
  - 运行 `npx tsc --noEmit` 检查是否有类型错误（仅诊断，不修改代码）

  **Must NOT do**:
  - 不要添加 `@opentui/core` 或 `@opentui/solid` 依赖
  - 不要修改 `dependencies`（nodemailer 不受影响）
  - 不要修改 `package.json` 的 exports/main/bin/files 字段

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件 package.json 版本号修改 + npm install
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sequential)
  - **Blocks**: Task 2, Task 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `package.json:52-58` - 当前 devDependencies 结构，@opencode-ai/plugin 当前值为 "latest"

  **API/Type References**:
  - `node_modules/@opencode-ai/plugin/dist/index.d.ts` - 升级后查看新 PluginModule 类型是否正确暴露

  **Acceptance Criteria**:
  - [ ] `package.json` 中 `devDependencies["@opencode-ai/plugin"]` 值为 `"^1.14.17"`
  - [ ] `npm install` 成功（exit code 0）
  - [ ] `npx tsc --noEmit` 报告预期的类型错误（因为导出格式还没改）-- 仅记录错误列表，不修改

  **QA Scenarios**:

  ```
  Scenario: 依赖安装成功
    Tool: Bash
    Preconditions: package.json 已修改
    Steps:
      1. 运行 `npm install`
      2. 检查 exit code 为 0
      3. 运行 `node -e "const p = require('./package.json'); console.log(p.devDependencies['@opencode-ai/plugin'])"`
    Expected Result: 输出 "^1.14.17"
    Evidence: .sisyphus/evidence/task-1-deps-installed.txt

  Scenario: TypeScript 诊断记录
    Tool: Bash
    Steps:
      1. 运行 `npx tsc --noEmit 2>&1`
      2. 记录输出（预期有类型错误，因为导出格式还没改）
    Expected Result: 命令执行成功，输出被记录（错误是预期的）
    Evidence: .sisyphus/evidence/task-1-tsc-diagnostic.txt
  ```

  **Commit**: NO (groups with Task 2)

- [x] 2. 改插件导出格式为 PluginModule

  **What to do**:
  - 修改 `src/index.ts`:
    1. 更新 `NotificationPlugin` 函数签名，添加可选 `options` 参数: `async (input: Parameters<Plugin>[0], options?: Parameters<Plugin>[1]) => Promise<ReturnType<Plugin>>`
    2. 将默认导出从 `export default NotificationPlugin` 改为 PluginModule 对象格式
    3. 保留命名导出 `export const NotificationPlugin` 不变（测试依赖）
    4. 添加 PluginModule 的 `id` 字段为 `"@ulthon/ul-opencode-event"`
  - 新的默认导出格式:
    ```typescript
    export default {
      id: "@ulthon/ul-opencode-event",
      server: NotificationPlugin,
    };
    ```
  - 删除旧的默认导出行: `export default NotificationPlugin;`
  - 删除旧的关于 `readV1Plugin` / `getLegacyPlugins` 的注释（已不适用）
  - 确保全局变量 `hasCheckedUpdate` 和 `hasShownStartupToast` 仍在模块顶层声明（不受导出格式变化影响）

  **Must NOT do**:
  - 不要修改 `NotificationPluginImpl` 函数内部逻辑
  - 不要修改事件处理、token 聚合、通道格式化等业务代码
  - 不要修改 `src/types.ts`、`src/config.ts`、`src/handler.ts` 等其他文件
  - 不要修改 `globalThis.__ul_opencode_event_test` 的导出方式
  - 不要删除 `__test_payloads` 和 `__test_resetFlags` 测试辅助功能

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: src/index.ts 的 2-3 行精准修改
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (after Task 1)
  - **Blocks**: Task 3, F1
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/index.ts:553-560` - 当前 NotificationPlugin 导出（函数形式 + try-catch 包装）
  - `src/index.ts:806` - 当前默认导出 `export default NotificationPlugin;`
  - `src/index.ts:798-806` - 当前默认导出注释（关于 readV1Plugin/getLegacyPlugins 的说明）
  - `src/index.ts:565` - NotificationPluginImpl 函数签名

  **API/Type References**:
  - 新 SDK `PluginModule` 类型: `{ id?: string; server: Plugin; tui?: never }`
  - 新 SDK `Plugin` 类型: `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`

  **Test References**:
  - `tests/index.test.ts` - 使用 `import { NotificationPlugin }` 命名导入，不受默认导出变化影响

  **WHY Each Reference Matters**:
  - `index.ts:553-560`: 需要理解当前的 try-catch 包装结构，确保 PluginModule.server 仍使用它
  - `index.ts:806`: 这是需要替换的行（从函数导出改为对象导出）
  - `index.ts:798-806`: 旧注释需要删除或更新
  - 新 SDK PluginModule: 这是目标格式

  **Acceptance Criteria**:
  - [ ] `src/index.ts` 默认导出为 `{ id: "...", server: ... }` 格式
  - [ ] 命名导出 `NotificationPlugin` 仍为函数
  - [ ] `globalThis.__ul_opencode_event_test` 仍在模块加载时设置
  - [ ] `hasCheckedUpdate` / `hasShownStartupToast` 模块级变量仍正常工作

  **QA Scenarios**:

  ```
  Scenario: 导出格式验证
    Tool: Bash (node)
    Preconditions: npm run build 已成功
    Steps:
      1. 运行 `npm run build`
      2. 运行 `node -e "import('./dist/index.js').then(m => { console.log('typeof default:', typeof m.default); console.log('typeof default.server:', typeof m.default?.server); console.log('default.id:', m.default?.id); console.log('typeof NotificationPlugin:', typeof m.NotificationPlugin); })"`
    Expected Result:
      - typeof default: object
      - typeof default.server: function
      - default.id: @ulthon/ul-opencode-event
      - typeof NotificationPlugin: function
    Failure Indicators: typeof default 为 "function" (未改为对象), default.server 为 undefined
    Evidence: .sisyphus/evidence/task-2-export-check.txt

  Scenario: TypeScript 编译通过
    Tool: Bash
    Steps:
      1. 运行 `npx tsc --noEmit`
    Expected Result: exit code 0, 零错误
    Failure Indicators: 任何类型错误
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES
  - Message: `fix(export): upgrade to PluginModule format for OpenCode 1.14+ compatibility`
  - Files: `src/index.ts`, `package.json`, `package-lock.json`
  - Pre-commit: `npm run build && bun test`

- [x] 3. 构建验证 + 测试 + 产物检查

  **What to do**:
  - 运行完整构建: `npm run build`
  - 运行全部测试: `bun test`
  - 验证构建产物:
    1. `dist/index.js` 存在
    2. `dist/index.d.ts` 存在
    3. 默认导出验证 (PluginModule 格式)
  - 检查 TypeScript 严格模式: `npx tsc --noEmit`
  - 运行 lint: `npm run lint`

  **Must NOT do**:
  - 不要为了通过测试而修改测试代码
  - 不要跳过失败的测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要运行多个验证命令并分析结果
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 1, 2)
  - **Blocks**: F1
  - **Blocked By**: Task 1, Task 2

  **References**:

  **Pattern References**:
  - `package.json:45-50` - npm scripts 定义 (build, test, lint, typecheck)

  **Acceptance Criteria**:
  - [ ] `npm run build` exit code 0
  - [ ] `bun test` 全部通过（exit code 0）
  - [ ] `npx tsc --noEmit` exit code 0
  - [ ] `dist/index.js` 和 `dist/index.d.ts` 文件存在
  - [ ] 构建产物默认导出为 PluginModule 对象

  **QA Scenarios**:

  ```
  Scenario: 完整构建流水线
    Tool: Bash
    Steps:
      1. 运行 `npm run build` 记录输出
      2. 运行 `npx tsc --noEmit` 记录输出
      3. 运行 `npm run lint` 记录输出
      4. 运行 `bun test` 记录输出
      5. 检查 dist/index.js 和 dist/index.d.ts 存在
    Expected Result: 所有命令 exit code 0，测试全部通过
    Failure Indicators: 任何命令非零 exit，或测试失败
    Evidence: .sisyphus/evidence/task-3-build-output.txt

  Scenario: 构建产物 PluginModule 验证
    Tool: Bash (node)
    Steps:
      1. 运行 node 验证:
         `node -e "import('./dist/index.js').then(m => { const d = m.default; if (typeof d !== 'object') throw new Error('default is not object'); if (typeof d.server !== 'function') throw new Error('default.server is not function'); if (d.id !== '@ulthon/ul-opencode-event') throw new Error('id mismatch'); if (typeof m.NotificationPlugin !== 'function') throw new Error('NotificationPlugin missing'); console.log('ALL CHECKS PASSED'); })"`
    Expected Result: 输出 "ALL CHECKS PASSED"
    Failure Indicators: 任何 Error 抛出
    Evidence: .sisyphus/evidence/task-3-module-verify.txt
  ```

  **Commit**: NO (already committed with Task 2)

---

## Final Verification Wave (MANDATORY)

- [x] F1. **Scope Fidelity Check** -- `quick`
  For each task: read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1-2**: `fix(export): upgrade to PluginModule format for OpenCode 1.14+ compatibility` - src/index.ts, package.json, package-lock.json

---

## Success Criteria

### Verification Commands
```bash
npx tsc --noEmit          # Expected: exit 0, zero errors
npm run build             # Expected: exit 0, dist/index.js exists
bun test                  # Expected: all tests pass
```

### Final Checklist
- [ ] 默认导出为 `{ id: "@ulthon/ul-opencode-event", server: [Function] }` 格式
- [ ] 命名导出 `NotificationPlugin` 仍为函数
- [ ] devDependency `@opencode-ai/plugin` 版本为 `1.14.17`
- [ ] 所有现有测试通过（无回归）
- [ ] 无任何业务逻辑代码被修改
