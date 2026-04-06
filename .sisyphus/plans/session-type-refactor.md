# 会话类型三态重构：isSubagent → sessionType

## TL;DR

> **Quick Summary**: 将子代理识别从二值布尔（`isSubagent: boolean`）重构为三态枚举（`sessionType: 'main' | 'subagent' | 'unknown'`），解决竞态条件下子代理事件被误判为主会话的问题。同时将过滤策略从硬编码二元开关改为可配置的三态白名单。
>
> **Deliverables**:
> - `SessionType` 联合类型 + 更新后的 `EventPayload` / `NotificationConfig`
> - 三态判定逻辑（基于现有 sessionMap 缓存）
> - 白名单过滤机制（默认仅通知主会话）
> - 模板变量 `{{sessionType}}` 替代 `{{isSubagent}}`
> - 配置校验 + 旧字段废弃警告
> - 完整测试覆盖
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: types.ts → index.ts → handler.ts → locales.ts → config.ts → tests

---

## Context

### Original Request

用户发现 ul-opencode-event 插件在主会话中启动子代理后，收到了两个不同 session ID 的通知邮件。经调查确认：

1. OpenCode v1.3.16 已是最新版，不是版本问题
2. OpenCode 的 34 个 BusEvent 中仅 3 个（created/updated/deleted）携带完整 Session.Info（含 parentID）
3. 其余 31 个事件只有 sessionID 字符串，必须通过 sessionMap 缓存反查 parentID
4. 竞态条件：非 created 事件先于 created 到达时，sessionMap 未命中 → isSubagent=false → 过滤失效

### Interview Summary

**Key Discussions**:
- 用户否决了"保守策略"（默认 isSubagent=true）——会导致主会话被误杀
- 用户提出"如实标记 + 模板输出"方案 —— 不做硬判断，三态标记交给模板和配置
- 确认不需要向后兼容（未正式发布）
- 确认 sessionMap 缓存机制必须保留（OpenCode 事件结构决定的必要设计）

**Research Findings**:
- `parentID` 仅存在于 `Session.Info.parentID?: string`，不在任何事件的直接 properties 中
- `file.edited` 事件连 sessionID 都没有（properties 只有 `{ file: string }`）
- SDK 中不存在 `permission.updated`，实际是 `permission.asked` / `permission.replied`（但当前代码和测试中使用 `permission.updated` 能正常工作，说明运行时确实存在此事件名）
- OpenCode 插件系统通过 `bus.subscribeAll()` 无差别转发所有事件

### Metis Review

**Identified Gaps** (addressed):
- **file.edited 无 sessionID**: 明确归为 `'unknown'` 态
- **默认白名单**: 设为 `['main']`（与当前"默认过滤子代理"行为一致）
- **模板变量冗余**: 移除 `{{isSubagent}}`，统一用 `{{sessionType}}`
- **配置校验**: 对 `includeSessionTypes` 数组值做合法性检查，非法值 warn+忽略
- **旧字段废弃警告**: 即使未正式发布，也加一行 deprecation warning 防止遗漏
- **竞态条件 debug 日志**: sessionMap 未命中时记录 DEBUG 日志便于诊断

---

## Work Objectives

### Core Objective

将子代理识别机制从二值布尔升级为三态枚举，使系统能够正确区分、标记和过滤主会话/子代理/未识别三种状态的事件。

### Concrete Deliverables

1. `src/types.ts`: 新增 `SessionType` 类型，替换 `isSubagent` 和 `includeSubagentEvents`
2. `src/index.ts`: `eventToPayload()` 全部 10 处判定点改为返回三态值；过滤逻辑改为白名单匹配
3. `src/handler.ts`: 模板变量传递改用 `sessionType`
4. `src/locales.ts`: 18 个模板（9 事件 x 2 语言）中的 `{{isSubagent}}` 替换为 `{{sessionType}}`
5. `src/config.ts`: 配置加载/合并/校验逻辑更新
6. `tests/index.test.ts`: 重写 8 个已有测试 + 新增 unknown 态测试
7. `tests/config.test.ts`: 更新 3 个配置合并测试 + 新增校验测试

### Definition of Done

- [ ] `npm run typecheck` 通过（tsc --noEmit, exit code 0）
- [ ] `npm run test` 通过（bun test, 0 failures）
- [ ] `npm run build` 成功（dist/ 产物生成）
- [ ] `npm run lint` 通过（eslint src）

### Must Have

- 三态判定：main / subagent / unknown，基于 sessionMap 缓存命中情况
- 白名单过滤：`includeSessionTypes: ('main' | 'subagent' | 'unknown')[]`，默认 `['main']`
- 模板变量 `{{sessionType}}` 在所有默认模板中可用
- `{{parentSessionId}}` 保留（对 subagent/unknown 仍有意义）
- sessionMap 缓存机制保持不变
- 配置校验：非法白名单值 warn+忽略
- 旧字段 `includeSubagentEvents` 触发 deprecation warning

### Must NOT Have (Guardrails)

- 不修改 `email.ts`、`cli.ts`、`template.ts`（渲染引擎不变）
- 不引入 per-channel sessionType 过滤（保持全局级配置）
- 不引入事件队列/重排序机制（单独的架构变更）
- 不新增事件类型或通道类型
- 不修改 README 文档（可后续提交）
- 不保留 `{{isSubagent}}` 和 `{{sessionType}}` 并存（造成混淆）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision

- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: Tests-after（先改类型再补测试，因为这是纯重构，行为语义变化明确）
- **Framework**: bun test
- **TDD approach**: 类型定义先行，每个文件改完立即 typecheck 验证

### QA Policy

每个任务包含 Agent-Executed QA Scenarios：
- **Library/Module**: Bash (bun) - import, call functions, compare output
- **API/Backend**: Bash (curl) - N/A（无 HTTP 接口）

Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.txt`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 类型契约 + 核心逻辑):
├── Task 1: 类型定义重构 (types.ts) [quick]
└── Task 2: eventToPayload 三态判定 + 过滤逻辑 (index.ts) [unspecified-high]

Wave 2 (After Wave 1 - 展示层更新):
├── Task 3: handler 模板变量传递 (handler.ts) [quick]
├── Task 4: 默认模板更新 (locales.ts) [quick]
└── Task 5: 配置加载/校验/合并 (config.ts) [unspecified-high]

Wave 3 (After Wave 2 - 测试验证):
├── Task 6: 子代理过滤测试重写 (tests/index.test.ts) [unspecified-high]
├── Task 7: 配置测试更新 (tests/config.test.ts) [unspecified-high]
└── Task 8: 全量验证 (typecheck + test + build + lint) [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── F1: Plan Compliance Audit (oracle)
├── F2: Code Quality Review (unspecified-high)
├── F3: Real Manual QA (unspecified-high)
└── F4: Scope Fidelity Check (deep)

Critical Path: T1 → T2 → T3/T4/T5 → T6/T7 → T8 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1), 3 (Wave 2), 3 (Wave 3), 4 (FINAL)
```

### Dependency Matrix

- **1**: - - 2, 1
- **2**: 1 - 3, 4, 5, 6, 7, 8, 2
- **3**: 2 - 8, 3
- **4**: 2 - 8, 4
- **5**: 1, 2 - 6, 7, 8, 5
- **6**: 1, 2, 5 - 8, 6
- **7**: 1, 2, 5 - 8, 7
- **8**: 2, 3, 4, 5, 6, 7 - F1-F4, 8

### Agent Dispatch Summary

- **1**: **2** - T1 -> `quick`, T2 -> `unspecified-high`
- **2**: **3** - T3 -> `quick`, T4 -> `quick`, T5 -> `unspecified-high`
- **3**: **3** - T6 -> `unspecified-high`, T7 -> `unspecified-high`, T8 -> `quick`
- **FINAL**: **4** - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. 类型定义重构 (types.ts)

  **What to do**:
  - 新增 `SessionType` 联合类型：`type SessionType = 'main' | 'subagent' | 'unknown'`
  - 在 `EventPayload` 接口中：
    - 删除 `isSubagent?: boolean`（第138行）
    - 新增 `sessionType: SessionType`（替换原字段位置）
    - 保留 `parentSessionId?: string`（第139行，不动）
  - 在 `NotificationConfig` 接口中：
    - 删除 `includeSubagentEvents?: boolean`（第18行）
    - 新增 `includeSessionTypes?: SessionType[]`（替换原字段位置）
    - 定义默认值常量：`const DEFAULT_SESSION_TYPES: SessionType[] = ['main']`
  - 导出 `SessionType` 类型供其他模块使用

  **Must NOT do**:
  - 不修改 Channel、ChannelConfig、SMTPConfig 等无关接口
  - 不修改 EventConfig、TemplateConfig 等事件/模板配置
  - 不添加 per-channel 级别的 sessionType 配置

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件类型定义变更，纯类型操作，无运行时逻辑
  - **Skills**: []
    - 无需额外技能
  - **Skills Evaluated but Omitted**:
    - `git-master`: 不涉及 git 操作
    - `refactor`: 变更范围明确，无需 LSP 辅助

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (Sequential, first task)
  - **Blocks**: Task 2, 3, 4, 5, 6, 7, 8
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `src/types.ts:14-19` - NotificationConfig 接口当前结构，在此处替换字段
  - `src/types.ts:121-140` - EventPayload 接口当前结构，在此处替换字段
  - `src/types.ts:144-145` - EventType 联合类型定义模式（参考其导出方式）

  **API/Type References** (contracts to implement against):
  - `src/types.ts:18` - 当前 `includeSubagentEvents?: boolean` → 替换为 `includeSessionTypes?: SessionType[]`
  - `src/types.ts:138-139` - 当前 `isSubagent?: boolean; parentSessionId?: string` → 替换为 `sessionType: SessionType; parentSessionId?: string`

  **Test References** (testing patterns to follow):
  - `tests/config.test.ts:432-597` - includeSubagentEvents 配置合并测试（后续 Task 7 会更新）

  **External References** (libraries and frameworks):
  - TypeScript union type 最佳实践：使用 `type` alias 而非 `enum`（与项目现有风格一致，如 `LocaleType = 'zh' | 'en'`）

  **WHY Each Reference Matters**:
  - types.ts 是整个重构的契约起点。所有下游文件（index.ts/handler.ts/locales.ts/config.ts/tests）都依赖这里定义的类型。必须先改这里，后续任务才能基于新类型编译通过。

  **Acceptance Criteria**:

  - [ ] `npm run typecheck` 报错是预期的（下游文件还在用旧类型），但 types.ts 本身无语法错误
  - [ ] `SessionType` 类型正确导出：`'main' | 'subagent' | 'unknown'`
  - [ ] `EventPayload.sessionType` 类型为 `SessionType`（非 optional）
  - [ ] `EventPayload` 中不再存在 `isSubagent` 字段
  - [ ] `EventPayload.parentSessionId` 保留且类型不变
  - [ ] `NotificationConfig.includeSessionTypes` 类型为 `SessionType[]`（optional）
  - [ ] `NotificationConfig` 中不再存在 `includeSubagentEvents` 字段
  - [ ] `DEFAULT_SESSION_TYPES` 常量值为 `['main']`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 类型定义编译检查
    Tool: Bash (bun / tsc)
    Preconditions: types.ts 已修改完成
    Steps:
      1. 运行 npx tsc --noEmit --pretty 2>&1 | head -30
      2. 检查输出中关于 types.ts 的错误
    Expected Result: types.ts 自身无语法/类型错误（下游文件的引用错误可忽略）
    Failure Indicators: types.ts 内部有 type error 或 syntax error
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: SessionType 导出验证
    Tool: Bash (node)
    Preconditions: 项目已 build 或可直接解析 ts
    Steps:
      1. 用 grep 确认 "export type SessionType" 存在于 src/types.ts
      2. 用 grep 确认 SessionType 的联合成员包含 main/subagent/unknown
      3. 用 grep 确认 isSubagent 已从 EventPayload 中移除
      4. 用 grep 确认 includeSubagentEvents 已从 NotificationConfig 中移除
    Expected Result: 所有 grep 匹配符合预期
    Failure Indicators: 旧字段名仍存在或新字段缺失
    Evidence: .sisyphus/evidence/task-1-grep-verify.txt
  ```

  **Commit**: YES
  - Message: `refactor(types): 将 isSubagent 布尔字段替换为 sessionType 三态枚举`
  - Files: `src/types.ts`
  - Pre-commit: `npx tsc --noEmit`（预期有下游报错可忽略）

- [x] 2. eventToPayload 三态判定 + 过滤逻辑 (index.ts)

  **What to do**:
  - **三态判定函数**：新增辅助函数 `resolveSessionType(sessionInfo?: Session): SessionType`
    ```typescript
    function resolveSessionType(sessionInfo?: Session): SessionType {
      if (!sessionInfo) return 'unknown';
      if (sessionInfo.parentID !== undefined && sessionInfo.parentID !== '') return 'subagent';
      return 'main';
    }
    ```
  - **更新 eventToPayload() 全部 10 处判定点**：
    - 第31行 `session.created`: `isSubagent: ...` → `sessionType: resolveSessionType(event.properties.info)` （info 始终存在）
    - 第41行 `session.idle`: `isSubagent: ...` → `sessionType: resolveSessionType(sessionInfo)`
    - 第53行 `session.error`: 同上
    - 第74行 `question.asked`: 同上
    - 第88行 `permission.updated`: 同上
    - 第101行 `session.status`: 同上
    - 第115行 `command.executed`: 同上
    - 第127行 `file.edited`: 同上（注意此事件无 sessionID，sessionInfo 必然为 undefined → 'unknown'）
    - 第142行 `todo.updated`: 同上
  - **更新过滤逻辑**（第247-254行）：
    ```typescript
    // 替换原有的 shouldFilterSubagents + isSubagent 过滤
    const allowedTypes = config.includeSessionTypes ?? DEFAULT_SESSION_TYPES;
    if (!allowedTypes.includes(payload.sessionType)) {
      if (DEBUG_ENABLED) {
        console.info(`${LOG_PREFIX} Skipping ${payload.sessionType} event ${payload.eventType} for session ${payload.sessionId}`);
      }
      return;
    }
    ```
  - **新增 debug 日志**：当 sessionMap 未命中时（即 resolveSessionType 返回 'unknown'），在 DEBUG 模式下记录日志便于诊断竞态条件
    ```typescript
    if (DEBUG_ENABLED && payload.sessionType === 'unknown' && typeof props.sessionID === 'string') {
      console.warn(`${LOG_PREFIX} sessionMap miss for sessionID=${props.sessionID}, treating as 'unknown'. Race condition?`);
    }
    ```

  **Must NOT do**:
  - 不修改 sessionMap 的填充/查询机制（第221-238行保持不变）
  - 不修改 event 回调的注册结构（return { event: async ... }）
  - 不引入异步等待或队列机制
  - 不修改 formatDuration/formatTimestamp/formatError 等工具函数

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 核心逻辑变更，涉及 10+ 处代码点，需要精确逐一替换，且有运行时行为变化
  - **Skills**: [`git-master`]
    - `git-master`: 使用 lsp_find_references 定位所有 isSubagent 引用确保无遗漏
  - **Skills Evaluated but Omitted**:
    - `refactor`: 可用但当前变更足够明确，手动编辑即可

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (after Task 1)
  - **Blocks**: Tasks 3, 4, 5, 6, 7, 8
  - **Blocked By**: Task 1 (types.ts 必须先定义 SessionType)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/index.ts:18-150` - eventToPayload() 函数完整结构，switch-case + default 分支模式
  - `src/index.ts:226-264` - event 回调函数完整结构，sessionMap 操作 + 过滤逻辑
  - `src/index.ts:247-254` - 当前的子代理过滤逻辑（要替换的目标代码）

  **API/Type References** (contracts to implement against):
  - `src/types.ts` - Task 1 新增的 `SessionType` 类型和 `DEFAULT_SESSION_TYPES` 常量
  - `@opencode-ai/sdk` 的 `Session` 类型 - `parentID?: string` 字段用于 subagent 判定

  **Test References** (testing patterns to follow):
  - `tests/index.test.ts:1270-1569` - 现有的 8 个子代理过滤测试（Task 6 会重写这些）
  - 这些测试当前的断言是基于 `isSubagent: boolean` 和 `includeSubagentEvents` 的，需要了解其结构以便 Task 6 正确重写

  **External References** (libraries and frameworks):
  - 无外部库依赖，纯 TypeScript 逻辑

  **WHY Each Reference Matters**:
  - index.ts 是插件的核心逻辑层。eventToPayload 的 10 处判定点是子代理识别的全部路径，遗漏任何一处都会导致该事件类型的 sessionType 永远为 undefined 或默认值。过滤逻辑从全局布尔开关改为白名单数组匹配，行为语义有变化（需要仔细处理边界情况）。

  **Acceptance Criteria**:

  - [ ] `resolveSessionType()` 函数正确定义并返回三态值
  - [ ] eventToPayload() 全部 10 处判定点已替换为 `resolveSessionType()` 调用
  - [ ] 过滤逻辑使用 `config.includeSessionTypes ?? DEFAULT_SESSION_TYPES` 白名单
  - [ ] 默认配置下（无 includeSessionTypes）：main 通过，subagent 和 unknown 被过滤
  - [ ] `npm run typecheck` 通过（index.ts 无类型错误）
  - [ ] DEBUG 模式下 sessionMap 未命中时输出警告日志
  - [ ] file.edited 事件（无 sessionID）产生 `sessionType: 'unknown'`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 三态判定函数单元测试
    Tool: Bash (bun test)
    Preconditions: index.ts 已修改完成
    Steps:
      1. 编写临时测试验证 resolveSessionType 行为：
         - 传入 undefined → 返回 'unknown'
         - 传入 { parentID: 'ses_abc' } → 返回 'subagent'
         - 传入 { parentID: undefined } → 返回 'main'
         - 传入 { parentID: '' } → 返回 'main'
      2. bun test --timeout=10000 2>&1 | tail -20
    Expected Result: 所有断言通过
    Failure Indicators: 任何返回值不符合预期
    Evidence: .sisyphus/evidence/task-2-resolve-session-type.txt

  Scenario: 过滤逻辑验证 - 默认配置仅放行主会话
    Tool: Bash (bun test)
    Preconditions: index.ts 过滤逻辑已更新
    Steps:
      1. 构造 mock config（不含 includeSessionTypes）
      2. 分别构造 sessionType='main'/'subagent'/'unknown' 的三个 payload
      3. 验证只有 main payload 通过过滤器
      4. bun test --match="*filter*" 2>&1 | tail -15
    Expected Result: main 放行，subagent/unknown 被过滤
    Failure Indicators: subagent 或 unknown 也被放行了
    Evidence: .sisyphus/evidence/task-2-filter-default.txt

  Scenario: 过滤逻辑验证 - 自定义白名单
    Tool: Bash (bun test)
    Preconditions: index.ts 过滤逻辑已更新
    Steps:
      1. 构造 mock config: { includeSessionTypes: ['main', 'subagent'] }
      2. 验证 main 和 subagent 放行，unknown 被过滤
      3. 构造 mock config: { includeSessionTypes: ['main', 'subagent', 'unknown'] }
      4. 验证三种状态全部放行
      5. bun test --match="*whitelist*" 2>&1 | tail -15
    Expected Result: 白名单精确控制哪些类型放行
    Failure Indicators: 白名单不生效或非法值导致崩溃
    Evidence: .sisyphus/evidence/task-2-filter-whitelist.txt

  Scenario: file.edited 事件产生 unknown 态
    Tool: Bash (bun test)
    Preconditions: index.ts eventToPayload 已更新
    Steps:
      1. 构造 file.edited 事件（properties 只有 { file: '/test.js' }，无 sessionID）
      2. 调用 eventToPayload 并检查返回值的 sessionType
      3. 断言 sessionType === 'unknown'
      4. bun test --match="*file-edited*" 2>&1 | tail -15
    Expected Result: file.edited 事件的 sessionType 为 'unknown'
    Failure Indicators: sessionType 不是 'undefined' 或抛异常
    Evidence: .sisyphus/evidence/task-2-file-edited-unknown.txt

  Scenario: 竞态条件模拟 - created 之前到达的事件
    Tool: Bash (bun test)
    Preconditions: index.ts event 回调已更新
    Steps:
      1. 创建空的 sessionMap（模拟尚未收到 session.created）
      2. 直接调用 eventToPayload 处理 session.idle 事件（sessionID 为子代理 ID）
      3. 断言返回的 sessionType === 'unknown'（而非 'main' 或 'subagent'）
      4. 再模拟 session.created 到达后填充 sessionMap
      5. 再次处理同一 sessionID 的 idle 事件
      6. 断言此时 sessionType === 'subagent'
      7. bun test --match="*race-condition*" 2>&1 | tail -20
    Expected Result: 竞态条件下先返回 'unknown'，created 到达后正确返回 'subagent'
    Failure Indicators: 未命中时返回 'main'（即旧的 bug 行为复现）
    Evidence: .sisyphus/evidence/task-2-race-condition.txt
  ```

  **Commit**: YES
  - Message: `refactor(core): eventToPayload 改为三态判定 + 白名单过滤逻辑`
  - Files: `src/index.ts`
  - Pre-commit: `npx tsc --noEmit && npx bun test tests/index.test.ts`

- [x] 3. handler 模板变量传递 (handler.ts)

  **What to do**:
  - 在 `src/handler.ts` 的模板变量构建处（约第103-104行）：
    - 删除 `isSubagent: payload.isSubagent?.toString()`
    - 新增 `sessionType: payload.sessionType`
  - 确保所有通道（当前仅 smtp）的模板变量对象都包含 `sessionType`

  **Must NOT do**:
  - 不修改事件分发逻辑（handle 方法、通道路由）
  - 不修改邮件发送逻辑
  - 不添加新的模板变量

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件 1-2 行变更，纯变量名替换
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Task 8
  - **Blocked By**: Task 2 (index.ts 必须先产出 sessionType 字段)

  **References**:

  **Pattern References**:
  - `src/handler.ts:100-110` - 模板变量对象构建代码，找到 isSubagent 赋值位置

  **API/Type References**:
  - `src/types.ts:121-140` - EventPayload 新结构（Task 1 已改，确认 sessionType 字段名）

  **WHY Each Reference Matters**:
  - handler.ts 是事件处理和模板渲染之间的桥梁。此处变量名必须与 EventPayload 的字段名一致，也必须与 locales.ts 中模板使用的变量名一致。

  **Acceptance Criteria**:

  - [ ] 模板变量对象中包含 `sessionType: payload.sessionType`
  - [ ] 模板变量对象中不再包含 `isSubagent`
  - [ ] `parentSessionId` 保持不变
  - [ ] `npm run typecheck` 通过

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: handler 模板变量包含 sessionType
    Tool: Bash (grep)
    Preconditions: handler.ts 已修改
    Steps:
      1. grep -n "sessionType" src/handler.ts
      2. grep -n "isSubagent" src/handler.ts
      3. grep -n "parentSessionId" src/handler.ts
    Expected Result: sessionType 存在，isSubagent 不存在，parentSessionId 存在
    Failure Indicators: isSubagent 仍存在或 sessionType 缺失
    Evidence: .sisyphus/evidence/task-3-handler-vars.txt
  ```

  **Commit**: YES (group with Task 4 or 5 if convenient, else standalone)
  - Message: `refactor(handler): 模板变量传递改用 sessionType`
  - Files: `src/handler.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 4. 默认模板更新 (locales.ts)

  **What to do**:
  - 在 `src/locales.ts` 的全部默认模板中：
    - 将 `{{isSubagent}}` 替换为 `{{sessionType}}`
    - 保留 `{{parentSessionId}}` 不变
  - 涉及的模板：9 种事件类型 x 2 种语言（zh/en）= 18 个模板字符串
  - 事件类型列表：created, idle, error, question, permission, status, command, fileEdited, todo

  **Must NOT do**:
  - 不改变模板的整体结构和布局
  - 不新增或删除其他模板变量
  - 不修改 i18n 选择逻辑或 getDefaultTimezone 函数

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 全文替换操作，18 处机械性替换
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 5)
  - **Blocks**: Task 8
  - **Blocked By**: Task 2 (确保 sessionType 变量名已确定)

  **References**:

  **Pattern References**:
  - `src/locales.ts` - 完整文件，查找所有 `{{isSubagent}}` 出现位置并替换为 `{{sessionType}}`
  - 当前每个模板的结构参考（如 zh 模板的 subject/body 格式）

  **WHY Each Reference Matters**:
  - locales.ts 是用户看到的最终内容。如果遗漏任何一个模板中的替换，用户在该事件类型的通知中会看到空的 `{{isSubagent}}` 或旧的布尔值。

  **Acceptance Criteria**:

  - [ ] 所有 18 个模板中的 `{{isSubagent}}` 已替换为 `{{sessionType}}`
  - [ ] 文件中不存在任何 `{{isSubagent}}` 字符串
  - [ ] 所有 `{{parentSessionId}}` 保持原样
  - [ ] `npm run typecheck` 通过

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 模板变量替换完整性验证
    Tool: Bash (grep)
    Preconditions: locales.ts 已修改
    Steps:
      1. grep -c "{{sessionType}}" src/locales.ts → 应 >= 18
      2. grep -c "{{isSubagent}}" src/locales.ts → 应 = 0
      3. grep -c "{{parentSessionId}}" src/locales.ts → 应 >= 18（保持不变）
    Expected Result: sessionType 出现 18+ 次，isSubagent 为 0 次
    Failure Indicators: isSubagent 仍有残留或 sessionType 数量不足
    Evidence: .sisyphus/evidence/task-4-template-replace.txt
  ```

  **Commit**: YES (group with Task 3 if convenient)
  - Message: `refactor(templates): 默认模板 {{isSubagent}} 替换为 {{sessionType}}`
  - Files: `src/locales.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 5. 配置加载/校验/合并 (config.ts)

  **What to do**:
  - **配置合并逻辑更新**：
    - 将 `includeSubagentEvents` 的合并逻辑（约第183、189行）替换为 `includeSessionTypes` 的合并逻辑
    - 合并规则不变：项目级覆盖全局级，不同名则追加（但 includeSessionTypes 是标量数组，应直接覆盖而非追加）
  - **配置校验新增**：
    - 新增 `validateIncludeSessionTypes(types?: unknown): SessionType[]` 函数
    - 合法值：'main', 'subagent', 'unknown'
    - 非法值：console.warn 输出警告并过滤掉
    - 空数组 / undefined / null：返回 DEFAULT_SESSION_TYPES
  - **废弃警告**：
    - 如果检测到旧字段 `includeSubagentEvents`，输出 console.warn 废弃提示
    - 提示内容建议用户迁移到 `includeSessionTypes`
  - **默认值处理**：
    - 最终合并后的 config 中，如果 `includeSessionTypes` 未定义，设为 `DEFAULT_SESSION_TYPES`（即 `['main']`）

  **Must NOT do**:
  - 不修改通道合并逻辑（channels 按 name 合并）
  - 不修改 timezone/language 合并逻辑
  - 不修改 validateChannelTypes 函数
  - 不修改 JSON 文件读取/解析逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 配置校验涉及边界条件处理（空数组、非法值、undefined），需要仔细实现
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4)
  - **Blocks**: Tasks 6, 7, 8
  - **Blocked By**: Tasks 1, 2 (需要 SessionType 类型和 DEFAULT_SESSION_TYPES 常量)

  **References**:

  **Pattern References**:
  - `src/config.ts:175-195` - 当前配置合并逻辑区域，includeSubagentEvents 的合并在此处
  - `src/config.ts:~80-120` - validateChannelTypes() 函数模式（参考其校验风格）
  - `tests/config.test.ts:432-597` - 现有 includeSubagentEvents 合并测试（Task 7 会更新）

  **API/Type References**:
  - `src/types.ts` - SessionType 类型 + DEFAULT_SESSION_TYPES 常量（Task 1 定义）

  **WHY Each Reference Matters**:
  - config.ts 是配置系统的入口。校验不严谨会导致运行时崩溃（如非法值传入 includes()），合并逻辑错误会导致用户配置不生效。

  **Acceptance Criteria**:

  - [ ] `includeSessionTypes` 正确按项目级 > 全局级优先级合并
  - [ ] 非法白名单值被 warn + 过滤（不崩溃）
  - [ ] 空 array 返回 DEFAULT_SESSION_TYPES
  - [ ] undefined/null 返回 DEFAULT_SESSION_TYPES
  - [ ] 旧字段 `includeSubagentEvents` 触发 deprecation warning
  - [ ] 最终 config 中 includeSessionTypes 始终为有效非空数组
  - [ ] `npm run typecheck` 通过
  - [ ] `npm run test tests/config.test.ts` 通过（现有测试可能因字段名变更失败，需同步修复）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 白名单校验 - 非法值过滤
    Tool: Bash (bun test)
    Preconditions: config.ts 校验函数已实现
    Steps:
      1. 测试输入 ['main', 'foobar'] → 返回 ['main']，且 console.warn 被调用
      2. 测试输入 [] → 返回 DEFAULT_SESSION_TYPES
      3. 测试输入 undefined → 返回 DEFAULT_SESSION_TYPES
      4. 测试输入 null → 返回 DEFAULT_SESSION_TYPES
      5. 测试输入 ['main', 'subagent', 'unknown'] → 原样返回
      6. bun test --match="*config*validation*" 2>&1 | tail -20
    Expected Result: 校验函数在各种边界条件下返回合法数组
    Failure Indicators: 非法值导致崩溃或未被过滤
    Evidence: .sisyphus/evidence/task-5-config-validation.txt

  Scenario: 废弃警告触发
    Tool: Bash (bun test)
    Preconditions: config.ts 废弃检测已实现
    Steps:
      1. 构造包含 includeSubagentEvents: true 但不含 includeSessionTypes 的配置对象
      2. 调用 loadConfig 或相关合并函数
      3. 断言 console.warn 被调用且消息包含 "deprecated"
      4. bun test --match="*deprecate*" 2>&1 | tail -15
    Expected Result: 旧字段触发 deprecation warning
    Failure Indicators: 无警告或使用 console.error
    Evidence: .sisyphus/evidence/task-5-deprecation-warning.txt

  Scenario: 配置合并优先级
    Tool: Bun test
    Preconditions: config.ts 合并逻辑已更新
    Steps:
      1. 全局配置设置 includeSessionTypes: ['main']
      2. 项目配置设置 includeSessionTypes: ['main', 'subagent']
      3. 合并后断言结果为 ['main', 'subagent']（项目覆盖全局）
      4. bun test --match="*config*merge*" 2>&1 | tail -15
    Expected Result: 项目级配置正确覆盖全局级
    Failure Indicators: 合并结果不符合预期优先级
    Evidence: .sisyphus/evidence/task-5-config-merge.txt
  ```

  **Commit**: YES
  - Message: `refactor(config): includeSessionTypes 白名单配置 + 校验 + 废弃警告`
  - Files: `src/config.ts`
  - Pre-commit: `npx tsc --noEmit && npx bun test tests/config.test.ts`

- [x] 6. 子代理过滤测试重写 (tests/index.test.ts)

  **What to do**:
  - **重写现有 8 个子代理过滤测试**（第1270-1569行区域）：
    - 将所有基于 `isSubagent: boolean` 的断言改为基于 `sessionType: SessionType` 的断言
    - 将 `includeSubagentEvents: boolean` 配置改为 `includeSessionTypes: SessionType[]`
    - 更新 mock 数据构造方式
  - **新增 unknown 态测试用例**（至少 4 个新 describe/test 块）：
    1. sessionMap 未命中时 eventToPayload 返回 sessionType='unknown'
    2. 默认白名单下 unknown 事件被过滤
    3. 自定义白名单包含 'unknown' 时放行
    4. file.edited 事件产生 sessionType='unknown'
  - **竞态条件模拟测试**：
    1. 先发送 non-created 事件 → sessionType='unknown'
    2. 再发送 session.created → 后续同 sessionID 事件变为正确的 main/subagent
  - **三态矩阵测试**（参数化）：3 种 sessionType x 3 种白名单配置 = 核心场景覆盖

  **Must NOT do**:
  - 不删除其他无关测试用例
  - 不修改测试工具函数（mock-transport, sample-configs 等）
  - 不修改集成测试（full-flow.test.ts 由 Task 8 统一验证）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 大量测试用例需要精确更新，且需新增多种场景，工作量大
  - **Skills**: [`git-master`]
    - `git-master`: 用 lsp_find_references 找到所有引用 isSubagent/includeSubagentEvents 的测试位置
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: Task 8 (全量验证)
  - **Blocked By**: Tasks 1, 2, 5 (类型、核心逻辑、配置都已就绪才能写测试)

  **References**:

  **Test References** (testing patterns to follow):
  - `tests/index.test.ts:1270-1569` - 现有子代理过滤测试完整代码，了解 mock 结构和断言风格
  - `tests/utils/mock-transport.ts` - nodemailer mock transport 工具
  - `tests/utils/sample-configs.ts` - 示例配置构造工具

  **API/Type References**:
  - `src/types.ts` - 新的 SessionType 类型、EventPayload 结构
  - `src/index.ts` - 新的 resolveSessionType 函数签名和行为
  - `src/config.ts` - 新的 includeSessionTypes 配置项格式

  **WHY Each Reference Matters**:
  - 测试是重构的安全网。必须确保每一个旧行为都有对应的新测试覆盖，同时新增 unknown 态的测试覆盖。遗漏任何场景都可能让竞态条件的 bug 在未来复现。

  **Acceptance Criteria**:

  - [ ] 原 8 个子代理过滤测试全部更新为新 API 且通过
  - [ ] 新增至少 4 个 unknown 态专用测试
  - [ ] 新增竞态条件模拟测试
  - [ ] 三态矩阵核心场景全覆盖
  - [ ] `npx bun test tests/index.test.ts` 全部通过，0 failures

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 子代理测试全量通过
    Tool: Bash (bun test)
    Preconditions: 所有测试已编写完成
    Steps:
      1. npx bun test tests/index.test.ts 2>&1 | tail -30
    Expected Result: 所有测试通过，0 failures
    Failure Indicators: 任何 test fail 或 timeout
    Evidence: .sisyphus/evidence/task-6-test-results.txt
  ```

  **Commit**: YES
  - Message: `test(subagent): 重写子代理过滤测试为三态 + 新增 unknown 态用例`
  - Files: `tests/index.test.ts`
  - Pre-commit: `npx bun test tests/index.test.ts`

- [x] 7. 配置测试更新 (tests/config.test.ts)

  **What to do**:
  - **更新现有 3 个 includeSubagentEvents 配置合并测试**：
    - 将 `includeSubagentEvents` 断言改为 `includeSessionTypes` 断言
    - 更新期望值为数组格式（如 `['main']` 替代 `false`，`['main','subagent','unknown']` 替代 `true`）
  - **新增配置校验测试**（至少 3 个新 test 块）：
    1. 非法白名单值被过滤 + warn
    2. 空数组回退到默认值
    3. undefined 回退到默认值
  - **新增废弃警告测试**：
    1. 包含旧字段时触发 warn
    2. 同时包含新旧字段时新字段优先

  **Must NOT do**:
  - 不修改其他配置项的测试（channels、timezone、language 等）
  - 不修改测试辅助工具

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 配置测试需要精确反映新的校验和合并行为
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 8)
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 5 (类型定义和配置加载逻辑就绪)

  **References**:

  **Test References**:
  - `tests/config.test.ts:432-597` - 现有 includeSubagentEvents 合并测试

  **API/Type References**:
  - `src/config.ts` - Task 5 实现的新校验/合并/废弃逻辑

  **Acceptance Criteria**:

  - [ ] 原 3 个配置合并测试全部更新并通过
  - [ ] 新增至少 4 个校验/废弃相关测试
  - [ ] `npx bun test tests/config.test.ts` 全部通过，0 failures

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 配置测试全量通过
    Tool: Bash (bun test)
    Preconditions: 所有测试已编写完成
    Steps:
      1. npx bun test tests/config.test.ts 2>&1 | tail -20
    Expected Result: 所有测试通过，0 failures
    Failure Indicators: 任何 test fail
    Evidence: .sisyphus/evidence/task-7-config-test-results.txt
  ```

  **Commit**: YES (可与 Task 6 合并为一个 commit)
  - Message: `test(config): 更新配置合并测试 + 新增白名单校验测试`
  - Files: `tests/config.test.ts`
  - Pre-commit: `npx bun test tests/config.test.ts`

- [x] 8. 全量验证 (typecheck + test + build + lint)

  **What to do**:
  - 依次执行以下命令，全部通过才标记完成：
    1. `npx tsc --noEmit` - TypeScript 类型检查
    2. `npx bun test` - 全量测试（包括 index.test.ts, config.test.ts, handler.test.ts, integration/）
    3. `npm run build` - 构建 dist/ 产物
    4. `npx eslint src` - 代码规范检查
  - 如果任何一步失败，记录失败信息到 evidence 文件，不标记任务完成

  **Must NOT do**:
  - 不修改任何源码（纯验证任务）
  - 不跳过任何验证步骤

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯命令执行和结果检查
  - **Skills**: []
  - **Skills Evaluated but Omitted**: 无

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (last task before FINAL)
  - **Blocks**: F1, F2, F3, F4
  - **Blocked By**: Tasks 2, 3, 4, 5, 6, 7 (所有代码任务完成)

  **Acceptance Criteria**:

  - [ ] `tsc --noEmit` exit code 0
  - [ ] `bun test` 0 failures
  - [ ] `npm run build` 成功生成 dist/
  - [ ] `eslint src` exit code 0

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 全量验证 - typecheck
    Tool: Bash
    Steps:
      1. npx tsc --noEmit 2>&1 | tee .sisyphus/evidence/task-8-typecheck.txt
    Expected Result: exit code 0, no errors
    Failure Indicators: any type error
    Evidence: .sisyphus/evidence/task-8-typecheck.txt

  Scenario: 全量验证 - test
    Tool: Bash
    Steps:
      1. npx bun test 2>&1 | tee .sisyphus/evidence/task-8-test.txt
    Expected Result: all tests pass, 0 failures
    Failure Indicators: any test failure
    Evidence: .sisyphus/evidence/task-8-test.txt

  Scenario: 全量验证 - build
    Tool: Bash
    Steps:
      1. npm run build 2>&1 | tee .sisyphus/evidence/task-8-build.txt
    Expected Result: dist/ 目录生成成功
    Failure Indicators: build error
    Evidence: .sisyphus/evidence/task-8-build.txt

  Scenario: 全量验证 - lint
    Tool: Bash
    Steps:
      1. npx eslint src 2>&1 | tee .sisyphus/evidence/task-8-lint.txt
    Expected Result: exit code 0
    Failure Indicators: any lint error/warning
    Evidence: .sisyphus/evidence/task-8-lint.txt
  ```

  **Commit**: NO (verification-only task)

---

## Final Verification Wave

>

- [x] F1. **Plan Compliance Audit** -- `oracle`
   Read the plan end-to-end. For each "Must Have": verify implementation exists (read file). For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
   Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
   Run `tsc --noEmit` + eslint + `bun test`. Review all changed files for: `as any`, empty catches, console.log in prod, commented-out code, unused imports.
   Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
   Run full test suite. Verify: (1) main sessions pass filter by default, (2) subagent sessions filtered by default, (3) unknown sessions filtered by default, (4) custom whitelist works correctly, (5) invalid whitelist values handled gracefully, (6) file.edited produces unknown, (7) race condition produces unknown, (8) template renders sessionType correctly.
   Output: `Scenarios [N/N pass] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
   For each task: read "What to do", read actual diff (git diff). Verify 1:1. Check "Must NOT do" compliance. Detect cross-task contamination.
   Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `refactor(types): 将 isSubagent 布尔字段替换为 sessionType 三态枚举` - src/types.ts, npm run typecheck
- **2**: `refactor(core): eventToPayload 改为三态判定 + 白名单过滤` - src/index.ts, npm run typecheck && npm run test
- **3**: `refactor(handler): 模板变量传递改用 sessionType` - src/handler.ts, npm run typecheck
- **4**: `refactor(templates): 默认模板 {{isSubagent}} 替换为 {{sessionType}}` - src/locales.ts, npm run typecheck
- **5**: `refactor(config): includeSessionTypes 白名单配置 + 校验 + 废弃警告` - src/config.ts, npm run typecheck && npm run test
- **6**: `test(subagent): 重写子代理过滤测试为三态 + 新增 unknown 态用例` - tests/index.test.ts, npm run test
- **7**: `test(config): 更新配置合并测试 + 新增白名单校验测试` - tests/config.test.ts, npm run test
- **8**: `chore: 全量验证 typecheck + test + build + lint`, npm run typecheck && npm run test && npm run build && npm run lint

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck   # Expected: exit code 0, no errors
npm run test        # Expected: all tests pass, 0 failures
npm run build       # Expected: dist/ populated successfully
npm run lint        # Expected: no errors or warnings
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] `SessionType` 联合类型在 types.ts 中正确定义
- [ ] 所有 10 处 isSubagent 判定点已替换为 sessionType 三态
- [ ] 过滤逻辑使用 includeSessionTypes 白名单匹配
- [ ] 默认白名单为 ['main']
- [ ] 18 个默认模板均使用 {{sessionType}}
- [ ] {{isSubagent}} 已从所有模板中移除
- [ ] {{parentSessionId}} 保留在模板中
- [ ] sessionMap 缓存机制未被改动
- [ ] file.edited 事件产生 sessionType='unknown'
- [ ] sessionMap 未命中产生 sessionType='unknown'
- [ ] 非法 includeSessionTypes 值被 warn+忽略
- [ ] 旧字段 includeSubagentEvents 触发 deprecation warning
