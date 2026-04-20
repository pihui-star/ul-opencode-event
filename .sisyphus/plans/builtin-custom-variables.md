# 内置变量扩展 + 自定义变量功能

## TL;DR

> **Quick Summary**: 扩展 OpenCode 通知插件的模板变量系统：新增约 11 个内置系统变量（hostname、IP、版本号、OS 信息等），并新增自定义变量功能（顶层配置、项目级+全局级、支持嵌套引用内置变量）。
>
> **Deliverables**:
> - 新增 11 个内置系统变量（hostname, osType, osPlatform, osRelease, osArch, username, nodeVersion, pluginVersion, localIP, processPid, systemUptime）
> - 新增 opencodeVersion 变量（从 SDK Session.version 获取）
> - 新增 `customVariables` 配置字段（全局+项目级合并，支持嵌套引用，允许覆盖内置变量）
> - 完整的 TDD 测试覆盖
> - CLI 测试工具同步更新
> - README 文档更新
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves + Final
> **Critical Path**: Task 1 -> Task 2 -> Task 4 -> Task 7 -> Task 8

---

## Context

### Original Request
用户希望扩展插件的变量系统：(1) 增加更多内置变量（主机名、IP、插件版本、OpenCode版本、系统版本等）；(2) 增加自定义变量功能（项目级+全局级配置，可在模板中使用，recorder 自动记录）。

### Interview Summary
**Key Discussions**:
- 内置变量清单：已确认约 11 个系统变量 + opencodeVersion
- 自定义变量：仅静态值（不支持环境变量/shell），支持嵌套引用内置变量
- 配置层级：顶层 NotificationConfig.customVariables（所有通道共享）
- 合并策略：项目级覆盖同名，不同名追加（与 channels 一致）
- 命名冲突：允许自定义变量覆盖内置变量
- 测试策略：TDD 模式

**Research Findings**:
- 当前系统：56 个模板变量，简单 `{{var}}` 正则替换
- SDK Session 有 `version: string` 字段 → opencodeVersion 可用
- `updater.ts` 已有 `getCurrentVersion()` → pluginVersion 可复用
- `handler.ts:119-190` 构建变量映射 → 新变量直接在此扩展
- `recorder.ts` 被动消费 → 新变量自动记录，无需修改

### Metis Review
**Identified Gaps** (addressed):
- localIP 选取策略：取第一个非内部 IPv4，跳过虚拟网卡前缀（docker/wsl/vEthernet/tun）
- systemUptime 格式：人类可读格式（如 `3d 5h 20m`）
- 自定义变量嵌套：仅单层解析，只能引用内置变量，不能引用其他自定义变量
- 变量名校验：key 必须匹配 `\w+`，值必须为 string，不合法时 warn 并过滤
- 解析顺序：先构建内置变量 → 用内置变量解析自定义变量值 → 自定义变量覆盖内置变量
- 不修改 EventPayload 类型，系统变量直接在 handler.ts 的 variables map 中构建
- 不修改默认模板（locales.ts），新变量仅在用户自定义模板和 recorder 中可用

---

## Work Objectives

### Core Objective
扩展模板变量系统，使通知消息能包含系统环境信息，并允许用户通过配置文件自定义额外变量。

### Concrete Deliverables
- `src/types.ts`: `NotificationConfig` 新增 `customVariables` 字段
- `src/config.ts`: customVariables 合并逻辑 + key/value 校验
- `src/handler.ts`: 12 个新增内置变量构建 + 自定义变量解析/合并
- `src/index.ts`: opencodeVersion 从 SDK 传递到 handler
- `tests/`: 完整的 TDD 测试覆盖
- `src/cli.ts`: CLI 测试工具同步
- `README.md`: 变量文档更新

### Definition of Done
- [ ] `bun test` 全量通过（含新增测试）
- [ ] `npm run typecheck` 无错误
- [ ] `npm run lint` 无新增错误
- [ ] 所有新增变量在 recorder JSONL 中可见
- [ ] 自定义变量嵌套引用正确解析
- [ ] 项目级配置正确覆盖全局级配置

### Must Have
- 12 个内置系统变量（hostname, osType, osPlatform, osRelease, osArch, username, nodeVersion, pluginVersion, localIP, processPid, systemUptime, opencodeVersion）
- 自定义变量配置字段（顶层 NotificationConfig）
- 自定义变量合并逻辑（项目覆盖全局）
- 嵌套引用解析（自定义变量引用内置变量）
- 允许覆盖内置变量值
- key 校验（`\w+`）+ value 类型校验（string）
- TDD 测试覆盖
- recorder 自动记录所有新变量

### Must NOT Have (Guardrails)
- 不支持环境变量展开（`${ENV_VAR}`）或 shell 执行
- 不支持自定义变量之间的互相引用（仅引用内置变量，单层解析）
- 不修改 locales.ts 中的默认模板
- 不修改 EventPayload 类型来承载系统环境变量
- 不在库代码顶层导入 os 模块（在函数内部调用）
- 不实现多层递归嵌套解析
- localIP 不实现复杂的网络接口优先级排序
- 不重构现有变量构建模式

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Bun test)
- **Automated tests**: TDD (RED-GREEN-REFACTOR)
- **Framework**: Bun test (`bun:test`)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (`bun test`) - Run specific test files, check pass/fail
- **Config**: Use Bash (`bun test`) - Test config loading, merging, validation
- **Integration**: Use Bash (`bun test`) - Full flow from event to rendered variables

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - types + config foundation):
+-- Task 1: types.ts - NotificationConfig 添加 customVariables + 校验类型 [quick]
+-- Task 2: config.ts - customVariables 合并 + 校验逻辑 [unspecified-high]
+-- Task 3: handler.ts - 静态系统变量收集 + 注册 [unspecified-high]

Wave 2 (After Wave 1 - core variables + custom vars, MAX PARALLEL):
+-- Task 4: handler.ts - 动态系统变量 (localIP, systemUptime, processPid) (depends: 3) [unspecified-high]
+-- Task 5: index.ts - opencodeVersion 从 SDK 传递 (depends: 3) [quick]
+-- Task 6: handler.ts - 自定义变量解析 + 嵌套 + 覆盖逻辑 (depends: 1, 2, 3) [deep]

Wave 3 (After Wave 2 - integration + docs):
+-- Task 7: CLI 测试工具同步更新 (depends: 4, 5, 6) [quick]
+-- Task 8: README 文档更新 (depends: 6) [writing]

Wave FINAL (After ALL tasks - 4 parallel reviews, then user okay):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 2 -> Task 6 -> Task 7 -> F1-F4 -> user okay
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Waves 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 6 | 1 |
| 2 | 1 | 6 | 1 |
| 3 | - | 4, 5, 6 | 1 |
| 4 | 3 | 7 | 2 |
| 5 | 3 | 7 | 2 |
| 6 | 1, 2, 3 | 7, 8 | 2 |
| 7 | 4, 5, 6 | F1-F4 | 3 |
| 8 | 6 | F1-F4 | 3 |
| F1-F4 | 7, 8 | user okay | FINAL |

### Agent Dispatch Summary

- **Wave 1**: **3** - T1 -> `quick`, T2 -> `unspecified-high`, T3 -> `unspecified-high`
- **Wave 2**: **3** - T4 -> `unspecified-high`, T5 -> `quick`, T6 -> `deep`
- **Wave 3**: **2** - T7 -> `quick`, T8 -> `writing`
- **FINAL**: **4** - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. types.ts - 添加 customVariables 类型定义 + 变量名校验常量

  **What to do**:
  - 在 `NotificationConfig` 接口中添加 `customVariables?: Record<string, string>` 字段
  - 添加 `VARIABLE_NAME_REGEX` 常量（值为 `/^\w+$/`），用于校验自定义变量名合法性
  - 添加 `SUPPORTED_CUSTOM_VAR_TYPES` 类型注释，说明值只能是 string
  - 在 `ChannelSender` 或相关类型附近添加注释说明变量系统扩展点

  **TDD Steps**:
  1. RED: 编写测试验证 `customVariables` 字段在 NotificationConfig 中可访问，验证 `VARIABLE_NAME_REGEX` 对合法/非法变量名的匹配
  2. GREEN: 实现类型定义和常量
  3. REFACTOR: 确保常量位置合理

  **Must NOT do**:
  - 不修改 EventPayload 类型
  - 不修改 Channel 类型
  - 不添加运行时校验函数（在 Task 2 中处理）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯类型定义和常量，改动小且明确
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:25-49` - NotificationConfig 接口定义，customVariables 应添加在此
  - `src/types.ts:316-325` - CostConfig 作为顶层配置字段的参考模式

  **API/Type References**:
  - `src/template.ts:renderTemplate()` - 使用 `/\{\{(\w+)\}\}/g` 正则，变量名必须是 `\w+` 字符

  **External References**:
  - MDN `\w` 正则：匹配 `[A-Za-z0-9_]`，变量名只能用这些字符

  **WHY Each Reference Matters**:
  - `types.ts:25-49` 确定新字段的精确插入位置
  - `template.ts` 的正则约束了变量名格式，必须保持一致

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/types-custom-vars.test.ts
  - [ ] bun test tests/types-custom-vars.test.ts -> PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 合法变量名通过校验
    Tool: Bash (bun test)
    Preconditions: VARIABLE_NAME_REGEX 常量已定义
    Steps:
      1. 运行 `bun test tests/types-custom-vars.test.ts`
      2. 测试验证 "hostname", "my_var", "var123", "MyVar" 全部匹配 /^\w+$/
      3. 测试验证 "my-var", "my.var", "my var", "my@var" 全部不匹配
    Expected Result: 所有断言通过，合法名匹配，非法名不匹配
    Failure Indicators: 任何断言失败
    Evidence: .sisyphus/evidence/task-1-var-name-regex.txt

  Scenario: customVariables 字段类型正确
    Tool: Bash (bun test)
    Preconditions: NotificationConfig 已添加 customVariables
    Steps:
      1. 运行 `bun test tests/types-custom-vars.test.ts`
      2. 测试验证 `customVariables: { key: "value" }` 被类型系统接受
      3. 测试验证 `customVariables: undefined` 可接受（可选字段）
    Expected Result: TypeScript 编译通过，测试通过
    Failure Indicators: tsc 报错或测试失败
    Evidence: .sisyphus/evidence/task-1-typecheck.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-var-name-regex.txt
  - [ ] task-1-typecheck.txt

  **Commit**: YES (groups with Task 2)
  - Message: `feat(types): add customVariables field to NotificationConfig`
  - Files: `src/types.ts, tests/types-custom-vars.test.ts`
  - Pre-commit: `bun test tests/types-custom-vars.test.ts`

- [x] 2. config.ts - customVariables 合并 + 校验逻辑

  **What to do**:
  - 在 `loadConfig()` 中实现 customVariables 合并：`{ ...globalConfig.customVariables, ...projectConfig.customVariables }`
  - 添加 `validateCustomVariables(vars: Record<string, unknown>)` 函数：
    - key 不匹配 `\w+` 时：logger.warn 并过滤
    - value 不是 string 时：logger.warn 并过滤
    - 返回过滤后的 `Record<string, string>`
  - 在合并后调用校验函数
  - 编写完整测试覆盖各种校验场景

  **TDD Steps**:
  1. RED: 编写测试：(a) 项目级覆盖全局级同名key；(b) 不同名追加；(c) 非法key被过滤+warn；(d) 非string值被过滤+warn；(e) 空配置安全处理
  2. GREEN: 实现合并逻辑和校验函数
  3. REFACTOR: 抽取校验为独立函数

  **Must NOT do**:
  - 不修改 channels 合并逻辑
  - 不修改顶层字段合并逻辑
  - 不实现环境变量展开

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 涉及配置合并逻辑和校验，需要理解现有合并模式
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1 (需要 customVariables 类型定义)

  **References**:

  **Pattern References**:
  - `src/config.ts:260` - `loadConfig()` 函数，理解全局+项目配置合并流程
  - `src/config.ts:332-334` - 现有顶层字段合并模式（`??` fallback chain）
  - `src/config.ts` channels 按 name 合并的逻辑 - 理解合并策略一致性

  **API/Type References**:
  - `src/types.ts:NotificationConfig` - customVariables 字段类型
  - `src/logger.ts` - `logger` 实例，用于 warn 日志

  **Test References**:
  - `tests/config.test.ts` - 现有配置测试，理解测试模式和 mock 策略

  **WHY Each Reference Matters**:
  - `config.ts:260` 确定合并逻辑的精确插入位置
  - `config.ts:332-334` 展示现有合并模式，新代码应保持一致
  - `tests/config.test.ts` 提供测试风格参考，确保新测试与现有风格统一

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/config-custom-vars.test.ts
  - [ ] bun test tests/config-custom-vars.test.ts -> PASS (5+ test cases, 0 failures)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 项目级覆盖全局级同名key，不同名追加
    Tool: Bash (bun test)
    Preconditions: 全局配置和项目配置都有 customVariables
    Steps:
      1. 创建全局配置: { customVariables: { env: "dev", region: "us" } }
      2. 创建项目配置: { customVariables: { env: "prod" } }
      3. 调用 loadConfig() 并检查结果
      4. 验证 result.customVariables.env === "prod" (项目覆盖全局)
      5. 验证 result.customVariables.region === "us" (全局追加)
    Expected Result: env="prod", region="us"
    Failure Indicators: env="dev" 或 region 缺失
    Evidence: .sisyphus/evidence/task-2-merge-override.txt

  Scenario: 非法变量名被过滤并输出警告
    Tool: Bash (bun test)
    Preconditions: 配置中包含非法 key
    Steps:
      1. 创建配置: { customVariables: { "valid-key": "ok", "my-var": "bad", "123": "ok" } }
      2. 调用 validateCustomVariables()
      3. 验证 "valid-key" 存在（\w+ 允许连字符不在正则中...实际 \w 不包含连字符）
      4. 重新确认：\w+ 不匹配 "my-var"（含连字符）
      5. 验证 "my-var" 被过滤，logger.warn 被调用
    Expected Result: "my-var" 被移除，"validkey" 或 "valid" 保留，warn 日志输出
    Failure Indicators: 非法 key 未被过滤
    Evidence: .sisyphus/evidence/task-2-validation-filter.txt

  Scenario: 非string值被过滤
    Tool: Bash (bun test)
    Preconditions: 配置中 customVariables 包含非 string 值
    Steps:
      1. 创建配置: { customVariables: { num: 123, bool: true, str: "ok" } as any }
      2. 调用 validateCustomVariables()
      3. 验证 num 和 bool 被过滤，str 保留
      4. 验证 logger.warn 被调用 2 次
    Expected Result: 仅 str="ok" 保留
    Failure Indicators: 非string值未被过滤
    Evidence: .sisyphus/evidence/task-2-type-validation.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-merge-override.txt
  - [ ] task-2-validation-filter.txt
  - [ ] task-2-type-validation.txt

  **Commit**: YES (groups with Task 1)
  - Message: `feat(config): add customVariables merge and validation`
  - Files: `src/config.ts, src/types.ts, tests/config-custom-vars.test.ts, tests/types-custom-vars.test.ts`
  - Pre-commit: `bun test tests/types-custom-vars.test.ts tests/config-custom-vars.test.ts`

- [x] 3. handler.ts - 静态系统变量收集 + 模板变量注册

  **What to do**:
  - 在 `createEventHandler(config)` 闭包中收集静态系统变量（只执行一次）：
    - `hostname`: `os.hostname()`
    - `osType`: `os.type()`
    - `osPlatform`: `os.platform()`
    - `osRelease`: `os.release()`
    - `osArch`: `os.arch()`
    - `username`: `os.userInfo().username`
    - `nodeVersion`: `process.version`
    - `pluginVersion`: 复用 `getCurrentVersion()` from `updater.ts`
  - 在 `handle()` 方法的 variables 构建区域（lines 119-190）添加这些静态变量
  - 编写测试验证每个变量存在且非空

  **TDD Steps**:
  1. RED: 编写测试验证 handler 返回的 variables map 包含所有 8 个静态系统变量，且值为非空字符串
  2. GREEN: 在 handler.ts 中实现静态变量收集和注册
  3. REFACTOR: 抽取系统变量收集为独立函数 `collectStaticSystemInfo()`

  **Must NOT do**:
  - 不在文件顶层 import os 模块
  - 不修改 EventPayload
  - 不修改 locales.ts 默认模板
  - 不创建新的版本获取机制（复用 updater.ts 的 getCurrentVersion）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解 handler.ts 的闭包模式和变量构建流程
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/handler.ts:53-110` - `createEventHandler(config)` 闭包结构，静态变量应在此收集
  - `src/handler.ts:119-190` - variables map 构建区域，新变量应添加在此

  **API/Type References**:
  - `src/updater.ts:52` - `getCurrentVersion()` 函数，返回插件版本字符串
  - Node.js `os` module: `hostname()`, `type()`, `platform()`, `release()`, `arch()`, `userInfo()`
  - `process.version` - Node.js 版本

  **Test References**:
  - `tests/handler.test.ts` - 现有 handler 测试，理解 mock 和断言模式

  **External References**:
  - Node.js os module docs: https://nodejs.org/api/os.html

  **WHY Each Reference Matters**:
  - `handler.ts:53-110` 确定静态变量收集的精确位置（闭包顶层）
  - `handler.ts:119-190` 确定变量注册的精确位置
  - `updater.ts:52` 提供已有的版本获取函数，必须复用避免重复
  - `tests/handler.test.ts` 提供测试风格参考

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/handler-system-vars.test.ts
  - [ ] bun test tests/handler-system-vars.test.ts -> PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 所有静态系统变量存在且非空
    Tool: Bash (bun test)
    Preconditions: handler 已创建
    Steps:
      1. 运行 `bun test tests/handler-system-vars.test.ts`
      2. 测试验证 variables map 包含: hostname, osType, osPlatform, osRelease, osArch, username, nodeVersion, pluginVersion
      3. 每个变量的值为非空字符串
      4. 验证 pluginVersion 不为 "unknown"（开发环境可能有真实版本号）
    Expected Result: 8 个变量全部存在，值为合法字符串
    Failure Indicators: 任何变量缺失或为空
    Evidence: .sisyphus/evidence/task-3-static-vars.txt

  Scenario: 静态变量只收集一次（性能验证）
    Tool: Bash (bun test)
    Preconditions: handler 创建时收集一次
    Steps:
      1. 创建 handler
      2. 调用 handle() 多次（3次以上）
      3. 验证 hostname 等值在各次调用中完全相同
      4. 验证不是每次调用都重新调用 os.hostname()
    Expected Result: 变量值跨调用一致，无重复计算
    Failure Indicators: 变量值变化或出现重复计算迹象
    Evidence: .sisyphus/evidence/task-3-static-cached.txt
  ```

  **Evidence to Capture:**
  - [ ] task-3-static-vars.txt
  - [ ] task-3-static-cached.txt

  **Commit**: YES (groups with Task 4)
  - Message: `feat(vars): add built-in static system environment variables`
  - Files: `src/handler.ts, tests/handler-system-vars.test.ts`
  - Pre-commit: `bun test tests/handler-system-vars.test.ts`

- [x] 4. handler.ts - 动态系统变量 (localIP, systemUptime, processPid)

  **What to do**:
  - 在 `handle()` 方法中添加动态系统变量（每次事件时获取）：
    - `processPid`: `String(process.pid)`
    - `systemUptime`: `formatSystemUptime(os.uptime())` - 格式化为人类可读（如 `3d 5h 20m`，不足1天则 `5h 20m`，不足1小时则 `20m 36s`）
    - `localIP`: 从 `os.networkInterfaces()` 获取第一个非内部 IPv4 地址
      - 跳过内部地址（`internal: true`）
      - 跳过虚拟网卡前缀：`docker`, `wsl`, `vEthernet`, `tun`, `vmnet`, `vnic`
      - 跳过 IPv6
      - 找不到时 fallback 为 `"127.0.0.1"`
  - 添加 `formatSystemUptime(seconds: number): string` 辅助函数
  - 添加 `getLocalIP(): string` 辅助函数
  - 编写测试

  **TDD Steps**:
  1. RED: 编写测试验证 (a) localIP 格式正确（匹配 IPv4 正则）；(b) systemUptime 格式人类可读；(c) processPid 为数字字符串；(d) localIP fallback 行为
  2. GREEN: 实现 formatSystemUptime、getLocalIP、动态变量注册
  3. REFACTOR: 抽取辅助函数到合理位置

  **Must NOT do**:
  - 不实现复杂的网络接口优先级排序
  - 不获取公网 IP
  - 不在文件顶层调用 os.networkInterfaces()

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: localIP 选取逻辑需要仔细处理多网卡环境
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Task 7
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `src/handler.ts:119-190` - variables map 构建区域，动态变量添加在此
  - `src/index.ts:duration` - 现有 duration 格式化参考（但只处理 ms 级）

  **API/Type References**:
  - Node.js `os.networkInterfaces()` 返回类型：`{ [iface: string]: os.NetworkInterfaceInfo[] }`
  - Node.js `os.uptime()` 返回 `number`（秒）
  - `process.pid` 返回 `number`

  **Test References**:
  - `tests/handler-system-vars.test.ts` - Task 3 创建的测试文件，在此扩展

  **External References**:
  - Node.js os.networkInterfaces(): https://nodejs.org/api/os.html#osnetworkinterfaces

  **WHY Each Reference Matters**:
  - `handler.ts:119-190` 确定变量插入位置
  - `os.networkInterfaces()` 返回结构决定了 IP 选取的遍历逻辑
  - 现有 duration 格式化可参考但不完全适用（需要天级别支持）

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests added to: tests/handler-system-vars.test.ts
  - [ ] bun test tests/handler-system-vars.test.ts -> PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 动态变量在每次事件中更新
    Tool: Bash (bun test)
    Preconditions: handler 已创建，os 模块已 mock
    Steps:
      1. 运行 `bun test tests/handler-system-vars.test.ts`
      2. 验证 variables 包含 processPid（数字字符串）
      3. 验证 variables 包含 systemUptime（匹配 /^\d+d \d+h \d+m$/ 或类似格式）
      4. 验证 variables 包含 localIP（匹配 IPv4 正则或 "127.0.0.1"）
    Expected Result: 3 个动态变量存在且格式正确
    Failure Indicators: 变量缺失或格式不正确
    Evidence: .sisyphus/evidence/task-4-dynamic-vars.txt

  Scenario: localIP fallback 到 127.0.0.1
    Tool: Bash (bun test)
    Preconditions: mock os.networkInterfaces() 返回空对象 {}
    Steps:
      1. 运行测试：mock 网络接口为空
      2. 调用 getLocalIP()
      3. 验证返回 "127.0.0.1"
    Expected Result: 返回 "127.0.0.1"
    Failure Indicators: 返回 undefined 或空字符串
    Evidence: .sisyphus/evidence/task-4-localip-fallback.txt

  Scenario: systemUptime 格式化正确
    Tool: Bash (bun test)
    Preconditions: 各种秒数输入
    Steps:
      1. formatSystemUptime(0) -> "0m"
      2. formatSystemUptime(45) -> "0m 45s"
      3. formatSystemUptime(3661) -> "1h 1m 1s"
      4. formatSystemUptime(90061) -> "1d 1h 1m 1s"
    Expected Result: 每个输入产生正确的人类可读格式
    Failure Indicators: 格式不正确或包含不合理的单位
    Evidence: .sisyphus/evidence/task-4-uptime-format.txt
  ```

  **Evidence to Capture:**
  - [ ] task-4-dynamic-vars.txt
  - [ ] task-4-localip-fallback.txt
  - [ ] task-4-uptime-format.txt

  **Commit**: YES (groups with Task 3)
  - Message: `feat(vars): add dynamic system variables (localIP, systemUptime, processPid)`
  - Files: `src/handler.ts, tests/handler-system-vars.test.ts`
  - Pre-commit: `bun test tests/handler-system-vars.test.ts`

- [x] 5. index.ts - opencodeVersion 从 SDK Session 获取

  **What to do**:
  - 在 `session.created` 事件处理中，从 `event.properties.info.version` 提取 OpenCode 版本
  - 将 opencodeVersion 缓存到模块级变量（整个插件生命周期内不变）
  - 将 opencodeVersion 传递到 handler：通过 `config` 对象传递（在 loadConfig 后注入），或在 handler 参数中添加
  - 推荐方案：在 `createEventHandler` 的 config 参数中注入 `opencodeVersion` 字段（临时扩展），或在 handler 闭包中通过回调获取
  - 在 handler.ts 的 variables map 中注册 `opencodeVersion` 变量
  - 编写测试

  **TDD Steps**:
  1. RED: 编写测试验证 opencodeVersion 变量存在于 variables map 中
  2. GREEN: 实现 SDK version 提取和传递
  3. REFACTOR: 选择最干净的数据传递方式

  **Must NOT do**:
  - 不修改 EventPayload 类型
  - 不在 session.created 之前使用 opencodeVersion（可能为空）
  - 不硬编码 OpenCode 版本

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 逻辑简单，只是从 SDK 数据中提取一个字段并传递
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6)
  - **Blocks**: Task 7
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `src/index.ts:585-906` - 插件入口，session.created 处理在此
  - `src/index.ts:sessionMap` - session 信息缓存，可从 event.properties.info 获取 version
  - `src/types.gen.d.ts:480` - SDK Session 类型包含 `version: string` 字段

  **API/Type References**:
  - SDK Event `session.created` -> `event.properties.info.version` 提供版本号
  - `src/handler.ts:createEventHandler(config)` - handler 创建接口

  **WHY Each Reference Matters**:
  - `index.ts:session.created` 确定提取 opencodeVersion 的时机
  - `types.gen.d.ts:480` 确认 SDK 确实提供 version 字段
  - handler.ts 的创建接口决定了数据传递方式

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests added to: tests/handler-system-vars.test.ts 或 tests/index-opencode-version.test.ts
  - [ ] bun test -> PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: opencodeVersion 从 SDK session 提取
    Tool: Bash (bun test)
    Preconditions: mock session.created 事件包含 version 字段
    Steps:
      1. 触发 session.created 事件，version="1.0.0"
      2. 触发 session.idle 事件
      3. 检查 variables map 中的 opencodeVersion
      4. 验证值为 "1.0.0"
    Expected Result: opencodeVersion === "1.0.0"
    Failure Indicators: 值为 undefined 或空字符串
    Evidence: .sisyphus/evidence/task-5-opencode-version.txt

  Scenario: opencodeVersion 在首次事件前为空
    Tool: Bash (bun test)
    Preconditions: 未收到 session.created 事件
    Steps:
      1. 不触发 session.created
      2. 直接触发 session.idle
      3. 检查 variables map 中的 opencodeVersion
      4. 验证值为 ""（空字符串，符合 template.ts 的 undefined -> "" 行为）
    Expected Result: opencodeVersion === "" (空字符串)
    Failure Indicators: 抛出错误或值为 undefined
    Evidence: .sisyphus/evidence/task-5-opencode-version-empty.txt
  ```

  **Evidence to Capture:**
  - [ ] task-5-opencode-version.txt
  - [ ] task-5-opencode-version-empty.txt

  **Commit**: YES
  - Message: `feat(vars): add opencodeVersion variable from SDK session`
  - Files: `src/index.ts, src/handler.ts, tests/`
  - Pre-commit: `bun test`

- [x] 6. handler.ts - 自定义变量解析 + 嵌套引用 + 覆盖逻辑

  **What to do**:
  - 在 `handle()` 方法中，在构建完所有内置变量（系统变量 + 事件变量 + token 变量）之后：
    1. 获取合并后的 `config.customVariables`（已在 config.ts 中合并完毕）
    2. 对每个自定义变量的值调用 `renderTemplate(value, builtInVariables)` 解析嵌套的 `{{}}` 引用（仅引用内置变量，单层解析）
    3. 将解析后的自定义变量合并到 variables map 中（覆盖同名内置变量）
  - 编写测试覆盖 5 个核心场景：
    - 基本自定义变量值
    - 嵌套引用内置变量（如 `"{{hostname}}-{{projectName}}"`）
    - 覆盖内置变量（如 `"hostname": "custom-host"`）
    - 项目级覆盖全局级同名 key
    - 空配置（无 customVariables）

  **TDD Steps**:
  1. RED: 编写 5 个测试场景（基本值、嵌套、覆盖、项目覆盖全局、空配置）
  2. GREEN: 实现解析和合并逻辑
  3. REFACTOR: 抽取为 `resolveCustomVariables()` 辅助函数

  **Must NOT do**:
  - 不实现多层递归解析（自定义变量不能引用其他自定义变量）
  - 不支持环境变量展开
  - 不修改 renderTemplate() 函数
  - 不修改 recorder.ts（自动消费）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心逻辑，需要理解变量解析顺序和边界情况
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: Tasks 1, 2, 3

  **References**:

  **Pattern References**:
  - `src/handler.ts:119-190` - variables map 构建区域，自定义变量合并应在此区域末尾
  - `src/handler.ts:53` - `createEventHandler(config)` 闭包，config.customVariables 可从 config 获取
  - `src/template.ts:renderTemplate()` - 用于解析自定义变量值中的嵌套引用

  **API/Type References**:
  - `src/types.ts:NotificationConfig.customVariables` - `Record<string, string>` 类型
  - `src/config.ts:loadConfig()` - 已处理合并和校验，返回干净的 customVariables

  **Test References**:
  - `tests/handler.test.ts` - 现有 handler 测试，理解如何构造 test payload 和 config

  **WHY Each Reference Matters**:
  - `handler.ts:119-190` 是所有变量操作的精确位置，自定义变量合并必须在末尾（确保覆盖能力）
  - `template.ts:renderTemplate()` 是现成的解析引擎，直接复用解析自定义变量值中的 `{{}}`
  - `tests/handler.test.ts` 提供构造测试 handler 的模式

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Test file created: tests/handler-custom-vars.test.ts
  - [ ] bun test tests/handler-custom-vars.test.ts -> PASS (5+ test cases, 0 failures)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 基本自定义变量值渲染
    Tool: Bash (bun test)
    Preconditions: config 中有 customVariables: { env: "production", team: "backend" }
    Steps:
      1. 创建 handler 并触发 handle()
      2. 检查 variables map
      3. 验证 variables["env"] === "production"
      4. 验证 variables["team"] === "backend"
    Expected Result: 自定义变量在 variables map 中可访问
    Failure Indicators: 变量缺失或值不正确
    Evidence: .sisyphus/evidence/task-6-basic-custom.txt

  Scenario: 嵌套引用内置变量正确解析
    Tool: Bash (bun test)
    Preconditions: config 中有 customVariables: { serverLabel: "{{hostname}}-{{projectName}}" }
    Steps:
      1. 创建 handler，内置 hostname="MY-PC"，projectName="my-project"
      2. 触发 handle()
      3. 检查 variables["serverLabel"]
      4. 验证值为 "MY-PC-my-project"（内置变量已替换）
    Expected Result: serverLabel = "MY-PC-my-project"
    Failure Indicators: 值仍包含 {{}} 或替换不完整
    Evidence: .sisyphus/evidence/task-6-nesting.txt

  Scenario: 自定义变量覆盖内置变量
    Tool: Bash (bun test)
    Preconditions: config 中有 customVariables: { hostname: "custom-host" }
    Steps:
      1. 创建 handler
      2. 触发 handle()
      3. 检查 variables["hostname"]
      4. 验证值为 "custom-host"（非系统 hostname）
    Expected Result: hostname = "custom-host"
    Failure Indicators: 值为系统 hostname（被覆盖失败）
    Evidence: .sisyphus/evidence/task-6-override-builtin.txt

  Scenario: 引用不存在的变量渲染为空字符串
    Tool: Bash (bun test)
    Preconditions: config 中有 customVariables: { label: "{{nonExistentVar}}-test" }
    Steps:
      1. 创建 handler
      2. 触发 handle()
      3. 检查 variables["label"]
      4. 验证值为 "-test"（不存在的变量变为空字符串）
    Expected Result: label = "-test"
    Failure Indicators: 值包含 "{{nonExistentVar}}" 或抛出错误
    Evidence: .sisyphus/evidence/task-6-missing-ref.txt

  Scenario: 无自定义变量配置时安全处理
    Tool: Bash (bun test)
    Preconditions: config 中没有 customVariables 字段
    Steps:
      1. 创建 handler（config 无 customVariables）
      2. 触发 handle()
      3. 验证不报错
      4. 验证内置变量不受影响
    Expected Result: 正常运行，所有内置变量正常
    Failure Indicators: 报错或内置变量缺失
    Evidence: .sisyphus/evidence/task-6-no-custom.txt
  ```

  **Evidence to Capture:**
  - [ ] task-6-basic-custom.txt
  - [ ] task-6-nesting.txt
  - [ ] task-6-override-builtin.txt
  - [ ] task-6-missing-ref.txt
  - [ ] task-6-no-custom.txt

  **Commit**: YES
  - Message: `feat(vars): add custom variable resolution with nesting and override support`
  - Files: `src/handler.ts, tests/handler-custom-vars.test.ts`
  - Pre-commit: `bun test tests/handler-custom-vars.test.ts`

- [x] 7. CLI 测试工具同步更新

  **What to do**:
  - 在 `src/cli.ts` 中同步新增的系统变量到 CLI 测试消息
  - 确保 CLI 测试发送的通知包含新的系统变量
  - 添加 `--custom-vars` CLI 参数支持，允许通过命令行传入自定义变量进行测试
  - 更新 CLI 帮助信息

  **TDD Steps**:
  1. RED: 编写 CLI 测试验证新变量出现在测试输出中
  2. GREEN: 更新 CLI 代码
  3. REFACTOR: 清理 CLI 参数解析

  **Must NOT do**:
  - 不改变 CLI 的核心测试流程
  - 不添加复杂的 CLI 参数解析框架

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: CLI 更新相对简单，主要是同步数据
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential with Task 8)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 4, 5, 6

  **References**:

  **Pattern References**:
  - `src/cli.ts` - CLI 工具，理解测试消息的构造方式
  - `src/cli.ts` 中构造 EventPayload 的方式 - 确定在哪里添加系统变量

  **API/Type References**:
  - `src/handler.ts:createEventHandler()` - CLI 也调用此函数创建 handler

  **WHY Each Reference Matters**:
  - `cli.ts` 的消息构造方式决定了系统变量注入点
  - handler 创建接口决定了 CLI 如何获取系统变量

  **Acceptance Criteria**:

  **If TDD:**
  - [ ] Tests updated: tests/cli.test.ts (if exists) or manual CLI test
  - [ ] `npx @ulthon/ul-opencode-event test` 包含新变量

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CLI 测试命令包含系统变量
    Tool: Bash
    Preconditions: 插件已构建 (npm run build)
    Steps:
      1. 运行 `node dist/cli.js test` (或 npx 方式)
      2. 检查输出中是否包含 hostname, osPlatform 等变量
      3. 验证不报错
    Expected Result: CLI 执行成功，输出包含系统变量信息
    Failure Indicators: 报错或变量缺失
    Evidence: .sisyphus/evidence/task-7-cli-test.txt

  Scenario: CLI --custom-vars 参数工作
    Tool: Bash
    Preconditions: 插件已构建
    Steps:
      1. 运行 `node dist/cli.js test --custom-vars '{"env":"test"}'`
      2. 检查输出中自定义变量 "env" 值为 "test"
    Expected Result: 自定义变量在测试消息中正确渲染
    Failure Indicators: 自定义变量缺失或值不正确
    Evidence: .sisyphus/evidence/task-7-cli-custom-vars.txt
  ```

  **Evidence to Capture:**
  - [ ] task-7-cli-test.txt
  - [ ] task-7-cli-custom-vars.txt

  **Commit**: YES
  - Message: `feat(cli): sync CLI test tool with new variables`
  - Files: `src/cli.ts`
  - Pre-commit: `npm run typecheck`

- [x] 8. 全量文档更新（README + docs/ 目录）

  **What to do**:

  **8a. `README.md` - 轻量更新**:
  - 在 Template Variables 表中追加新增的系统变量（选最重要的几个，如 hostname, localIP, pluginVersion）
  - 在表格底部添加一行提示"更多变量见 [Configuration 文档](docs/configuration.md)"
  - 在 Configuration section 中简要提及 customVariables 配置字段

  **8b. `docs/configuration.md` - 重度更新** (约 8 个章节):
  - **Section 4 "模板系统概述"**: 新增"变量来源"说明（事件数据 > 内置系统变量 > 自定义变量），说明优先级
  - **Section 8.1 "通用变量"表**: 追加 12 个新内置变量行（hostname, osType, osPlatform, osRelease, osArch, username, nodeVersion, pluginVersion, opencodeVersion, localIP, processPid, systemUptime），每行含 Variable | Description | Example
  - **Section 8.5 "变量速查表"**: 确认新变量属于"通用变量"分组
  - **Section 9 "配置示例"**: 新增 9.5 小节展示 customVariables 配置示例，包含：
    - 基本自定义变量
    - 嵌套引用内置变量
    - 全局级 + 项目级配置合并示例
  - **Section 12 "常见问题"**: 新增 FAQ 条目：
    - "Q: 如何使用自定义变量？" -- 说明配置、命名规则、嵌套、覆盖
    - "Q: 自定义变量会记录到本地文件吗？" -- 说明 recorder 自动记录
  - **Section 13 "顶层配置字段"表**: 追加 customVariables 行（类型 Record<string, string>，默认 undefined）
  - 更新 Section 13 的 JSON 示例，加入 customVariables 字段

  **8c. `docs/architecture/event-data-flow.md` - 中度更新**:
  - **Section 1 "整体流程"**: 在流程图中添加"自定义变量合并"步骤（位于 fillProjectData 和 renderTemplate 之间）
  - **Section 5 "本地文件数据流"**: 更新字段计数（从 ~56 更新为 ~68+），说明新增的系统变量和自定义变量也被记录

  **8d. `docs/channels/channel-development.md` - 轻量更新**:
  - **Section 1.2 "数据流"**: 添加注释说明 variables map 包含内置系统变量和自定义变量
  - **Section 1.3 "文件职责表"**: 如 template.ts 描述需要更新则更新

  **Must NOT do**:
  - 不重构整个文档体系
  - 不修改代码逻辑
  - 不修改 locales.ts 默认模板文档（因为默认模板本身不修改）

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 纯文档任务，涉及多个文档文件的协调更新
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 6

  **References**:

  **Pattern References**:
  - `README.md:Template Variables section` - 现有变量表，追加新变量行
  - `docs/configuration.md:190-203 (Section 8.1)` - 通用变量表，追加 12 个新变量行
  - `docs/configuration.md:367-379 (Section 8.5)` - 变量速查表
  - `docs/configuration.md:383-523 (Section 9)` - 配置示例，新增 9.5 小节
  - `docs/configuration.md:768-797 (Section 12)` - FAQ，新增问答
  - `docs/configuration.md:800-835 (Section 13)` - 顶层配置字段表，追加 customVariables
  - `docs/architecture/event-data-flow.md:8-37 (Section 1)` - 整体流程图
  - `docs/architecture/event-data-flow.md:245-257 (Section 5)` - 字段计数 ~56
  - `docs/channels/channel-development.md:44-62 (Section 1.2)` - 数据流图

  **API/Type References**:
  - 本计划中定义的 12 个新增变量清单（hostname, osType, osPlatform, osRelease, osArch, username, nodeVersion, pluginVersion, opencodeVersion, localIP, processPid, systemUptime）
  - `src/types.ts:NotificationConfig.customVariables` 类型定义
  - `src/config.ts:validateCustomVariables()` 校验规则（key 匹配 \w+，值必须为 string）
  - `src/handler.ts` 自定义变量解析顺序（内置变量 -> 解析自定义变量值 -> 覆盖合并）

  **WHY Each Reference Matters**:
  - `configuration.md` 是用户主要参考文档，变量表和配置示例是最常查阅的部分
  - `event-data-flow.md` 的流程图是架构理解的核心，需要反映新的数据流
  - `channel-development.md` 是开发者参考，需确保新开发者理解变量来源
  - README 的变量表是用户第一眼看到的信息

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: README 变量表包含新变量
    Tool: Bash (grep)
    Preconditions: README.md 已更新
    Steps:
      1. grep README.md 中 "hostname" "localIP" "pluginVersion" 关键词
      2. 验证至少有 3 个新变量出现在表格中
      3. 验证有指向 docs/configuration.md 的链接
    Expected Result: 新变量和链接都存在
    Failure Indicators: 缺失变量或链接
    Evidence: .sisyphus/evidence/task-8-readme-vars.txt

  Scenario: configuration.md 通用变量表包含 12 个新变量
    Tool: Bash (grep)
    Preconditions: docs/configuration.md 已更新
    Steps:
      1. grep "hostname\|osType\|osPlatform\|osRelease\|osArch\|username\|nodeVersion\|pluginVersion\|opencodeVersion\|localIP\|processPid\|systemUptime" docs/configuration.md
      2. 验证 12 个变量全部出现在文档中
    Expected Result: 12 个变量全部找到
    Failure Indicators: 任何变量缺失
    Evidence: .sisyphus/evidence/task-8-config-vars.txt

  Scenario: configuration.md 包含 customVariables 配置示例
    Tool: Bash (grep)
    Preconditions: docs/configuration.md 已更新
    Steps:
      1. grep "customVariables" docs/configuration.md
      2. 验证出现在配置字段表(Section 13)和配置示例(Section 9)中
      3. 验证有嵌套引用示例（包含 {{variable}} 的值）
      4. 验证有全局+项目级合并示例
    Expected Result: customVariables 在多个章节中出现，有完整使用示例
    Failure Indicators: 缺少配置示例或合并说明
    Evidence: .sisyphus/evidence/task-8-custom-vars-docs.txt

  Scenario: event-data-flow.md 字段计数已更新
    Tool: Bash (grep)
    Preconditions: docs/architecture/event-data-flow.md 已更新
    Steps:
      1. grep "56" docs/architecture/event-data-flow.md
      2. 验证旧的 ~56 字段描述已更新为新数字（~68+）
      3. 验证提到了系统变量和自定义变量
    Expected Result: 字段计数已更新
    Failure Indicators: 仍显示 ~56
    Evidence: .sisyphus/evidence/task-8-flow-docs.txt

  Scenario: 文档中的 JSON 配置示例语法正确
    Tool: Bash (node -e "JSON.parse(...)") 
    Preconditions: 文档包含 JSON 配置示例
    Steps:
      1. 提取 configuration.md 中所有 JSON 代码块
      2. 用 node 验证 JSON 语法正确
    Expected Result: 所有 JSON 解析成功
    Failure Indicators: JSON 解析失败
    Evidence: .sisyphus/evidence/task-8-json-valid.txt
  ```

  **Evidence to Capture:**
  - [ ] task-8-readme-vars.txt
  - [ ] task-8-config-vars.txt
  - [ ] task-8-custom-vars-docs.txt
  - [ ] task-8-flow-docs.txt
  - [ ] task-8-json-valid.txt

  **Commit**: YES
  - Message: `docs: update all documentation for new template variables and custom variables`
  - Files: `README.md, docs/configuration.md, docs/architecture/event-data-flow.md, docs/channels/channel-development.md`
  - Pre-commit: (none)

---

## Final Verification Wave (MANDATORY -- after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns -- reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task -- follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty config, invalid variable names, missing SDK version. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 -- everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1+2**: `feat(types): add customVariables field to NotificationConfig` - src/types.ts, src/config.ts, tests/
- **Task 3+4**: `feat(vars): add built-in system environment variables` - src/handler.ts, tests/
- **Task 5**: `feat(vars): add opencodeVersion variable from SDK` - src/index.ts, tests/
- **Task 6**: `feat(vars): add custom variable resolution with nesting support` - src/handler.ts, tests/
- **Task 7**: `feat(cli): sync CLI test tool with new variables` - src/cli.ts
- **Task 8**: `docs: update README with new template variables` - README.md

---

## Success Criteria

### Verification Commands
```bash
bun test                                          # Expected: all tests pass (0 failures)
npm run typecheck                                 # Expected: no errors
npm run lint                                      # Expected: no new errors
```

### Final Checklist
- [ ] All "Must Have" present (12 built-in vars + customVariables config + nesting + override)
- [ ] All "Must NOT Have" absent (no env var expansion, no recursive nesting, no default template changes)
- [ ] All tests pass
- [ ] recorder JSONL contains new variables
- [ ] customVariables project-level correctly overrides global-level
