# 增加请求次数变量（三级体系）

## TL;DR

> **快速摘要**：在通知插件中新增三级（会话/总计/项目）API 请求次数变量，遵循现有 Token 变量的聚合模式，并在所有默认模板中展示。
>
> **交付物**：
> - `sessionRequestCount` / `totalRequestCount` / `projectRequestCount` 三个新模板变量
> - 扩展 `SessionCacheEntry` 以持久化请求计数
> - 更新 zh/en 全部 9 种事件类型默认模板（Token 行与 Req 行分离布局）
> - 完整 TDD 测试覆盖
>
> **预估工作量**：Medium
> **并行执行**：是 - 4 波次
> **关键路径**：任务 1 -> 任务 2 -> 任务 3/4/5 -> 任务 6/7/8/9

---

## 上下文

### 原始需求
用户希望在通知插件中增加"请求次数"变量，并在默认模板中展示。请求次数定义为会话中 LLM API 调用的次数（即 assistant 消息数）。

### 访谈摘要
**关键讨论**：
- **请求次数定义**：LLM API 请求次数 = 会话中 assistant 回复的次数（`sessionData.messages.size`）
- **三级体系**：与 Token 变量一致 - 会话级 / 总计级（含子会话） / 项目级
- **模板布局**：Token 行单独一行（`Token(...) Cached: xx%`），Req 行单独一行（`Req(...) modelID`）
- **created 事件**：仅显示项目级请求计数（与 Token 行为一致）
- **缓存扩展**：扩展 `SessionCacheEntry` 以持久化请求计数，确保项目级历史数据准确
- **命名约定**：沿用驼峰风格 - `sessionRequestCount` / `totalRequestCount` / `projectRequestCount`
- **测试策略**：TDD 流程（bun test）

**研究发现**：
- `tokenDataMap` 中的 `messages` Map 天然代表请求计数（每个 assistant 消息 = 一次 API 调用）
- handler.ts 不持有 `tokenDataMap`，数据必须通过 EventPayload 传递
- `SessionCacheEntry` 目前不含 requestCount，需要扩展
- `projectAgg` 计数器也需增加 requestCount 字段
- recorder.ts 自动记录所有变量，无需修改

### Metis 审查
**识别的缺口**（已处理）：
- 模板展示位置：Token 行与 Req 行分离 → 用户确认布局
- created 事件行为：仅项目级 → 与 Token 一致
- 缓存扩展：需要 → 用户确认扩展 SessionCacheEntry
- 深层嵌套子会话聚合：遵循现有 `collectDescendantSessionIds` 递归模式
- `file.edited` 无 sessionId：与现有行为一致（跳过）

---

## 工作目标

### 核心目标
在通知插件的变量/模板系统中新增三级 API 请求次数变量，数据源为 `sessionData.messages.size`。

### 具体交付物
- `src/types.ts`：EventPayload 新增 `sessionRequestCount`/`totalRequestCount`/`projectRequestCount`，SessionCacheEntry 新增 `requestCount`
- `src/index.ts`：在 `fillTokenData()`/`aggregateSubSessions()`/`fillProjectData()` 中三级聚合请求计数
- `src/session-cache.ts`：`buildCacheEntry()` 和 `aggregateProjectFromCache()` 支持请求计数
- `src/handler.ts`：变量构建中加入三级请求计数变量
- `src/locales.ts`：zh/en 全部 9 种事件类型模板更新（Token 行与 Req 行分离）
- `tests/`：完整 TDD 测试覆盖

### 完成定义
- [ ] `bun test` 全部通过
- [ ] `tsc --noEmit` 无类型错误
- [ ] 所有默认模板正确渲染三级请求计数
- [ ] 项目级聚合包含缓存中的历史会话数据
- [ ] recorder.ts 自动记录新增变量

### 必须包含
- 三级请求计数变量（`sessionRequestCount`, `totalRequestCount`, `projectRequestCount`）
- 精确遵循现有 Token 三级聚合模式
- 所有数据通过 EventPayload 传递（handler.ts 不直接访问 tokenDataMap）
- SessionCacheEntry 扩展以支持持久化
- 全部 9 种事件类型的 zh/en 模板更新

### 必须排除（护栏）
- 不修改 formatter（email/dingtalk/feishu）
- 不修改 recorder.ts（自动记录所有变量）
- 不添加人类可读格式化版本（纯数字已足够）
- 不重构相邻代码或"顺便修复"
- 不改变现有 Token 行的变量映射（仅移动 modelID 到 Req 行）

---

## 验证策略

> **零人工干预** - 所有验证由代理执行，不含人工验收标准。

### 测试决策
- **基础设施存在**：是（bun test）
- **自动化测试**：TDD（RED-GREEN-REFACTOR）
- **框架**：bun test（`bun:test`）

### QA 策略
每个任务必须包含代理执行的 QA 场景。
证据保存到 `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`。

- **API/后端**：使用 Bash（curl + bun REPL）发送请求、断言状态码和响应字段
- **库/模块**：使用 Bash（bun test）运行测试套件验证

---

## 执行策略

### 并行执行波次

```
波次 1（立即开始 - 类型定义 + 基础测试）:
├── 任务 1：EventPayload/SessionCacheEntry 类型定义 [quick]
├── 任务 2：新增请求计数变量 TDD 测试 [quick]
└── 任务 3：模板预期布局更新测试 [quick]

波次 2（波次 1 后 - 核心数据聚合）：
├── 任务 4：index.ts 三级请求计数聚合 [deep]
└── 任务 5：session-cache.ts 请求计数持久化 [deep]

波次 3（波次 2 后 - 变量暴露 + 模板）：
├── 任务 6：handler.ts 请求计数变量暴露 [quick]
└── 任务 7：locales.ts zh/en 模板更新 [writing]

波次 4（波次 3 后 - 文档 + 集成验证）：
├── 任务 8：递归子会话聚合测试 [deep]
└── 任务 9：docs/configuration.md 变量文档更新 [writing]

波次 FINAL（全部任务后 - 4 并行审查）：
├── 任务 F1：计划合规性审计（oracle）
├── 任务 F2：代码质量审查（unspecified-high）
├── 任务 F3：实际手动 QA（unspecified-high）
└── 任务 F4：范围忠实度检查（deep）
-> 提交结果 -> 获取用户明确确认
```

**关键路径**：任务 1 → 任务 4 → 任务 6 → 任务 7 → F1-F4 → 用户确认
**并行加速**：比串行快约 50%
**最大并发**：3（波次 1、3）

### 依赖矩阵

- **1-3**: - - 4,5,6,7 波次 1
- **4**: 1 - 6,8 波次 2
- **5**: 1 - 8 波次 2
- **6**: 4 - 7 波次 3
- **7**: 3,6 - 9 波次 3
- **8**: 4,5 - - 波次 4
- **9**: 7 - - 波次 4

### 代理调度摘要

- **波次 1**：**3** - T1 → `quick`，T2 → `quick`，T3 → `quick`
- **波次 2**：**2** - T4 → `deep`，T5 → `deep`
- **波次 3**：**2** - T6 → `quick`，T7 → `writing`
- **波次 4**：**2** - T8 → `deep`，T9 → `writing`
- **FINAL**：**4** - F1 → `oracle`，F2 → `unspecified-high`，F3 → `unspecified-high`，F4 → `deep`

---

## TODOs

> 实施 + 测试 = 一个任务。不可分离。
> 每个任务必须包含：推荐代理配置 + 并行化信息 + QA 场景。
> **无 QA 场景的任务不完整。无例外。**

- [x] 1. 类型定义：EventPayload 和 SessionCacheEntry 扩展

  **要做什么**：
  - 在 `src/types.ts` 的 `EventPayload` 接口中新增三个可选字段：
    ```ts
    sessionRequestCount?: number;
    totalRequestCount?: number;
    projectRequestCount?: number;
    ```
  - 在 `SessionCacheEntry` 接口中新增字段：
    ```ts
    requestCount: number;
    ```
  - 确保字段注释清晰，说明数据来源（`sessionData.messages.size`）

  **不得做**：
  - 不修改任何现有字段的类型或注释
  - 不添加额外无关类型

  **推荐代理配置**：
  > 选择类别 + 技能，基于任务领域。每项说明理由。
  - **类别**：`quick`
    - 理由：单一文件、仅类型定义、无逻辑变更
  - **技能**：`[]`
    - 无需额外技能 - 纯类型声明

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与任务 2、3 并行）
  - **阻塞**：任务 4、5、6
  - **被阻塞**：无（可立即开始）

  **参考**（关键 - 详尽列出）：

  > 执行者没有你的访谈上下文。参考是唯一的指南。

  **模式参考**（要遵循的现有代码）：
  - `src/types.ts:TokenBreakdown` - 现有 token 类型结构，理解命名模式

  **API/类型参考**（实施时要遵循的契约）：
  - `src/types.ts:EventPayload`（第 164-214 行）- 现有 EventPayload 完整结构，找到插入位置
  - `src/types.ts:SessionCacheEntry` - 现有缓存条目结构，找到插入位置

  **每个参考的重要性说明**：
  - TokenBreakdown：理解现有 token 三级的命名约定（sessionTokensTotal/totalTokensTotal/projectTokensTotal）以保持一致性

  **验收标准**：

  **TDD（测试已启用）：**
  - [ ] `tsc --noEmit` 通过（新增字段后类型检查无错误）
  - [ ] 现有测试套件 `bun test` 仍然全部通过（类型变更未破坏任何测试）

  **QA 场景（强制 - 无此场景的任务不完整）：**

  ```
  场景：类型定义编译通过
    工具：Bash（bun）
    前置条件：TypeScript 项目配置正确
    步骤：
      1. 运行 npx tsc --noEmit
      2. 检查退出码为 0
    预期结果：无类型错误输出
    失败指示器：任何类型错误消息
    证据：.sisyphus/evidence/task-1-typecheck.txt

  场景：现有测试套件未破坏
    工具：Bash（bun）
    前置条件：类型变更已完成
    步骤：
      1. 运行 bun test
      2. 检查退出码为 0
    预期结果：全部测试通过，无失败
    失败指示器：任何测试失败或类型运行时错误
    证据：.sisyphus/evidence/task-1-existing-tests.txt
  ```

  **要捕获的证据**：
  - [ ] 每个证据文件命名：task-1-typecheck.txt、task-1-existing-tests.txt
  - [ ] 终端输出（命令输出和退出码）

  **提交**：是（分组到波次 1）
  - 消息：`feat(types): add requestCount fields to EventPayload and SessionCacheEntry`
  - 文件：`src/types.ts`
  - 预提交：`npx tsc --noEmit; if ($?) { bun test }`

- [x] 2. TDD 测试：请求计数变量三级聚合测试

  **要做什么**：
  - 创建新测试文件 `tests/request-count.test.ts`（或扩展现有聚合测试）
  - 编写 RED 阶段测试（当前实现不存在，预期失败）：
    - 测试单会话请求计数：`sessionRequestCount` = 会话中 assistant 消息数
    - 测试总计请求计数：`totalRequestCount` = 当前会话 + 所有子会话消息数
    - 测试项目级请求计数：`projectRequestCount` = 项目路径下所有会话消息数
    - 测试空会话（零消息）：`requestCount` = 0
    - 测试跨项目隔离：项目 A 的计数不包含项目 B
  - 测试覆盖 `fillTokenData` / `aggregateSubSessions` / `fillProjectData` 三个聚合函数
  - 参考现有 `tests/project-aggregation.test.ts` 的测试模式

  **不得做**：
  - 不修改现有测试文件（除非必要适配）
  - 不测试不相关的功能

  **推荐代理配置**：
  - **类别**：`quick`
    - 理由：测试编写，遵循现有模式，逻辑简单
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与任务 1、3 并行）
  - **阻塞**：任务 4（验证聚合实现）
  - **被阻塞**：无（可立即开始）

  **参考**：
  - `tests/project-aggregation.test.ts` - 现有聚合测试模式（mock、断言风格、setup/teardown）
  - `tests/handler.test.ts` - handler 变量测试模式（变量构建和断言）
  - `src/index.ts:fillTokenData()` - 理解聚合逻辑入口
  - `src/index.ts:aggregateSubSessions()` - 子会话递归聚合

  **验收标准**：
  - [ ] 测试文件创建：`tests/request-count.test.ts`
  - [ ] `bun test tests/request-count.test.ts` → **预期 FAIL**（RED 阶段 - 实现尚未存在）
  - [ ] 所有现有测试 `bun test` 仍然通过

  **QA 场景**：

  ```
  场景：RED 阶段测试按预期失败
    工具：Bash（bun test）
    前置条件：类型定义已更新（任务 1 完成），聚合逻辑尚未实现
    步骤：
      1. 运行 bun test tests/request-count.test.ts
      2. 检查退出码非 0（测试失败）
      3. 验证失败原因匹配预期（缺少 requestCount 字段）
    预期结果：测试失败，错误信息与缺少 requestCount 变量相关
    失败指示器：测试意外通过（意味着实现已存在）或错误信息不相关
    证据：.sisyphus/evidence/task-2-red-tests.txt
  ```

  **提交**：是（分组到波次 1）
  - 消息：`test(request-count): add TDD test cases for three-level request count aggregation`
  - 文件：`tests/request-count.test.ts`
  - 预提交：`bun test`

- [x] 3. TDD 测试：模板预期布局更新测试

  **要做什么**：
  - 更新 `tests/locales.test.ts`（或创建新测试），验证新模板布局：
    - Token 行格式：`Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})  Cached: {{sessionCacheHitRate}}`
    - Req 行格式：`Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}})  {{modelID}}`
  - 验证 created 事件仅显示 `{{projectRequestCount}}`（无 session/total 级）
  - 验证全部 9 种事件类型模板包含 Req 行
  - 验证 zh 和 en 模板都包含 Req 行
  - RED 阶段：模板尚未更新，预期测试失败

  **不得做**：
  - 不修改现有测试的 Token 行验证（除非与布局变更直接相关）
  - 不改变任何其他模板验证逻辑

  **推荐代理配置**：
  - **类别**：`quick`
    - 理由：测试编写，验证模板字符串格式
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 1（与任务 1、2 并行）
  - **阻塞**：任务 7（验证模板更新）
  - **被阻塞**：无（可立即开始）

  **参考**：
  - `tests/locales.test.ts` - 现有模板测试（验证模式、断言风格）
  - `src/locales.ts` - 当前默认模板（了解现有布局）
  - `src/template.ts:renderTemplate()` - 模板渲染函数

  **验收标准**：
  - [ ] 测试文件更新：`tests/locales.test.ts`
  - [ ] `bun test tests/locales.test.ts` → **预期 FAIL**（RED 阶段）
  - [ ] 测试覆盖：全部 9 种事件类型 × 2 语言（zh/en）= 18 个模板断言

  **QA 场景**：

  ```
  场景：RED 阶段模板测试按预期失败
    工具：Bash（bun test）
    前置条件：模板尚未更新
    步骤：
      1. 运行 bun test tests/locales.test.ts
      2. 检查退出码非 0
      3. 验证失败原因是缺少 Req 行
    预期结果：测试失败，旧模板不包含 Req 变量
    失败指示器：测试意外通过或失败原因不相关
    证据：.sisyphus/evidence/task-3-red-templates.txt
  ```

  **提交**：是（分组到波次 1）
  - 消息：`test(locales): update template layout expectations for Req line`
  - 文件：`tests/locales.test.ts`
  - 预提交：`bun test`

- [x] 4. index.ts：三级请求计数聚合实现（GREEN 阶段）

  **要做什么**：
  - 在 `src/index.ts` 的 `fillTokenData()` 函数中：
    - 从 `sessionData.messages` 计算会话级请求计数
    - 检查 `eventType === 'created'` 时跳过（与现有 token 行为一致）
    - 设置 `payload.sessionRequestCount = sessionData.messages.size`
    - 初始设置 `payload.totalRequestCount = payload.sessionRequestCount`（在子会话聚合前）
  - 在 `aggregateSubSessions()` 函数中：
    - 使用 `collectDescendantSessionIds()` 收集所有子会话
    - 遍历子会话的 `tokenDataMap` 条目，累加 `messages.size` 到 `totalRequestCount`
  - 在 `fillProjectData()` 使用的 `projectAgg` 中：
    - 新增 `requestCount: number` 字段（初始化为 0）
    - 增量更新逻辑：新会话加入时累加 `messages.size`
    - 确保 `path.normalize()` 比较与 projectPath 匹配
  - 确保所有数据通过 EventPayload 传递（不直接在 handler.ts 中访问 tokenDataMap）

  **不得做**：
  - 不修改现有 token/cost 聚合逻辑
  - 不在 handler.ts 中直接访问 tokenDataMap
  - 不改变 `projectAgg` 现有字段的计算方式

  **推荐代理配置**：
  - **类别**：`deep`
    - 理由：修改核心聚合逻辑，涉及三个函数和增量计数器，需要彻底理解数据流
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：否（与任务 5 可部分并行，但共享 session-cache 上下文）
  - **并行组**：波次 2（与任务 5 并行）
  - **阻塞**：任务 6、8
  - **被阻塞**：任务 1

  **参考**：
  - `src/index.ts:fillTokenData()`（第 787-830 行）- 现有会话级 token 填充逻辑，明确镜像模式
  - `src/index.ts:aggregateSubSessions()` - 子会话递归聚合，理解 `collectDescendantSessionIds`
  - `src/index.ts:fillProjectData()`（第 831-870 行）- 项目级增量聚合，`projectAgg` 更新模式
  - `src/index.ts:eventToPayload()` - EventPayload 构建入口，理解字段映射
  - `src/types.ts:SessionTokenData` - sessionData 结构，确认 `messages` 字段类型

  **验收标准**：
  - [ ] `bun test tests/request-count.test.ts` → **PASS**（GREEN 阶段 - 任务 2 的测试通过）
  - [ ] `bun test` 全部通过（现有测试未破坏）
  - [ ] `tsc --noEmit` 无类型错误

  **QA 场景**：

  ```
  场景：GREEN 阶段 - 请求计数聚合测试通过
    工具：Bash（bun test）
    前置条件：任务 2 的 RED 测试存在，聚合逻辑已实现
    步骤：
      1. 运行 bun test tests/request-count.test.ts
      2. 检查退出码为 0
      3. 验证所有测试用例通过
    预期结果：全部测试通过，包括单会话、总计、项目级、空会话、跨项目隔离
    失败指示器：任何测试失败
    证据：.sisyphus/evidence/task-4-green-tests.txt

  场景：类型检查无错误
    工具：Bash（npx tsc）
    前置条件：聚合逻辑实现完成
    步骤：
      1. 运行 npx tsc --noEmit
      2. 检查退出码为 0
    预期结果：无类型错误
    证据：.sisyphus/evidence/task-4-typecheck.txt
  ```

  **提交**：是（分组到波次 2）
  - 消息：`feat(core): implement three-level request count aggregation in index.ts`
  - 文件：`src/index.ts`
  - 预提交：`npx tsc --noEmit; if ($?) { bun test }`

- [x] 5. session-cache.ts：请求计数持久化支持

  **要做什么**：
  - 在 `src/session-cache.ts` 的 `buildCacheEntry()` 中：
    - 从 `sessionData.messages.size` 提取请求计数
    - 填入 `entry.requestCount = sessionData.messages.size`
  - 在 `aggregateProjectFromCache()` 中：
    - 遍历缓存条目时累加 `entry.requestCount` 到项目级总数
    - 确保遵循现有的 `projectPath` 过滤逻辑
  - 在缓存初始化/恢复流程中：
    - 将恢复的 `requestCount` 累加到 `projectAgg.requestCount`
    - 保持与 token/cost 恢复路径完全一致

  **不得做**：
  - 不修改缓存文件的 JSONL 格式（仅添加字段）
  - 不改变现有 token/cost 缓存逻辑
  - 不修改缓存轮转大小或策略

  **推荐代理配置**：
  - **类别**：`deep`
    - 理由：需要理解缓存写入/读取/聚合的完整生命周期
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 2（与任务 4 并行）
  - **阻塞**：任务 8
  - **被阻塞**：任务 1

  **参考**：
  - `src/session-cache.ts:buildCacheEntry()` - 缓存条目构建函数，需要在此添加 requestCount
  - `src/session-cache.ts:aggregateProjectFromCache()` - 从缓存恢复项目聚合
  - `src/session-cache.ts:SessionCacheEntry` - 缓存条目类型（已在任务 1 中扩展）
  - `src/session-cache.ts:loadSessionCache()` - 缓存加载入口

  **验收标准**：
  - [ ] 缓存条目写入包含 `requestCount` 字段
  - [ ] 缓存恢复时 `projectAgg.requestCount` 正确累加历史会话数据
  - [ ] `bun test` 全部通过
  - [ ] 新增缓存相关测试覆盖：写入包含 requestCount、恢复累加正确

  **QA 场景**：

  ```
  场景：缓存写入包含 requestCount
    工具：Bash（bun test + cat）
    前置条件：会话已完成，缓存已写入
    步骤：
      1. 运行相关测试验证 buildCacheEntry 输出包含 requestCount
      2. 检查缓存 JSONL 文件的最后一条记录包含 "requestCount" 字段
    预期结果：缓存条目 JSON 包含 requestCount 字段且值为正整数
    失败指示器：缓存条目缺少 requestCount 字段或值为 undefined
    证据：.sisyphus/evidence/task-5-cache-write.txt

  场景：缓存恢复累加正确
    工具：Bash（bun test）
    前置条件：缓存文件包含多个带 requestCount 的会话条目
    步骤：
      1. 模拟缓存恢复流程
      2. 验证 aggregateProjectFromCache 返回的 requestCount 等于所有条目之和
    预期结果：聚合值等于各会话 requestCount 之和
    失败指示器：聚合值与期望不符
    证据：.sisyphus/evidence/task-5-cache-restore.txt
  ```

  **提交**：是（分组到波次 2）
  - 消息：`feat(cache): persist requestCount in session cache`
  - 文件：`src/session-cache.ts`
  - 预提交：`npx tsc --noEmit; if ($?) { bun test }`

- [x] 6. handler.ts：请求计数变量暴露（GREEN 阶段）

  **要做什么**：
  - 在 `src/handler.ts` 的 `createEventHandler().handle()` 函数中：
    - 在变量构建区域（约第 234-323 行）添加三级请求计数变量映射：
      ```ts
      sessionRequestCount: payload.sessionRequestCount != null ? String(payload.sessionRequestCount) : undefined,
      totalRequestCount: payload.totalRequestCount != null ? String(payload.totalRequestCount) : undefined,
      projectRequestCount: payload.projectRequestCount != null ? String(payload.projectRequestCount) : undefined,
      ```
    - 遵循现有变量映射模式（`String()` 转换，null/undefined 回退为 undefined）
  - 确保 created 事件场景下：
    - `sessionRequestCount` 和 `totalRequestCount` 为 undefined（因为 `fillTokenData` 在 created 时跳过）
    - `projectRequestCount` 存在（从 `projectAgg` 填充）
  - 变量通过 `recordEventVariables(variables)` 自动记录（recorder.ts 无需修改）

  **不得做**：
  - 不直接访问 tokenDataMap
  - 不修改现有变量的赋值方式
  - 不添加人类可读格式化变量（纯数字已够用）

  **推荐代理配置**：
  - **类别**：`quick`
    - 理由：单文件、少量变量映射添加、遵循现有模式
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：否
  - **并行组**：波次 3（在任务 7 之前）
  - **阻塞**：任务 7
  - **被阻塞**：任务 4

  **参考**：
  - `src/handler.ts:createEventHandler().handle()`（第 234-323 行）- 变量构建区域，找到插入位置
  - `src/handler.ts` 中 `sessionTokensTotal` / `totalTokensTotal` / `projectTokensTotal` 的变量映射模式 - 直接复制模式
  - `src/types.ts:EventPayload` - 确认字段名准确匹配

  **验收标准**：
  - [ ] 三级请求计数变量在 handler.ts 变量 Record 中正确映射
  - [ ] created 事件中仅 projectRequestCount 有值
  - [ ] 所有现有 handler 测试仍然通过
  - [ ] `tsc --noEmit` 无类型错误

  **QA 场景**：

  ```
  场景：handler 变量包含三级请求计数
    工具：Bash（bun test）
    前置条件：聚合逻辑已实现（任务 4 完成）
    步骤：
      1. 运行 handler 测试（含请求计数断言）
      2. 验证 variables.sessionRequestCount 为正整数
      3. 验证 variables.totalRequestCount 为会话+子会话总和
      4. 验证 variables.projectRequestCount 为项目会话总和
    预期结果：三级变量均为正整数或 undefined（created 场景）
    失败指示器：变量缺失、值为错误类型
    证据：.sisyphus/evidence/task-6-handler-vars.txt

  场景：created 事件仅含项目级
    工具：Bash（bun test）
    前置条件：created 事件场景设置
    步骤：
      1. 模拟 created 事件处理
      2. 验证 variables.sessionRequestCount 为 undefined
      3. 验证 variables.totalRequestCount 为 undefined
      4. 验证 variables.projectRequestCount 为数值
    预期结果：仅 projectRequestCount 有值
    失败指示器：created 事件中 session/total 级变量有值
    证据：.sisyphus/evidence/task-6-created-event.txt
  ```

  **提交**：是（分组到波次 3）
  - 消息：`feat(handler): expose requestCount variables in handler.ts`
  - 文件：`src/handler.ts`
  - 预提交：`npx tsc --noEmit; if ($?) { bun test }`

- [x] 7. locales.ts：zh/en 全部模板更新（GREEN 阶段）

  **要做什么**：
  - 更新 `src/locales.ts` 中所有默认模板（zh 和 en，全部 9 种事件类型）：
  - 修改 Token 行布局：
    - 旧格式：`Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})  {{modelID}}  Cached: {{sessionCacheHitRate}}`
    - 新格式：`Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})  Cached: {{sessionCacheHitRate}}`
  - 新增 Req 行（紧跟 Token 行后）：
    - `Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}})  {{modelID}}`
  - **created 事件特殊处理**：
    - Req 行仅显示项目级：`Req({{projectRequestCount}})  {{modelID}}`
    - 因为 created 事件无会话级请求计数
  - 确保 `{{modelID}}` 从 Token 行移除并正确添加到 Req 行

  **不得做**：
  - 不改变不相关事件类型的模板
  - 不修改 Token 行中的变量名称（如 `sessionTokensTotalHuman`）
  - 不添加额外未计划的变量

  **推荐代理配置**：
  - **类别**：`writing`
    - 理由：模板文本编辑，需要仔细处理 zh/en 双语言和 9 种事件类型
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：否
  - **并行组**：波次 3（在任务 6 之后）
  - **阻塞**：任务 9
  - **被阻塞**：任务 3、6

  **参考**：
  - `src/locales.ts` - 完整模板定义文件（需要修改）
  - `tests/locales.test.ts`（任务 3 中已更新）- 验证目标格式
  - `src/template.ts:renderTemplate()` - 理解变量替换行为

  **验收标准**：
  - [ ] `bun test tests/locales.test.ts` → **PASS**（GREEN 阶段 - 任务 3 的测试通过）
  - [ ] 全部 9 种事件类型 × 2 语言 = 模板正确渲染 Req 行
  - [ ] `{{modelID}}` 不再出现在 Token 行
  - [ ] `{{modelID}}` 正确出现在 Req 行
  - [ ] `bun test` 全部通过

  **QA 场景**：

  ```
  场景：GREEN 阶段 - 模板测试通过
    工具：Bash（bun test）
    前置条件：模板已更新
    步骤：
      1. 运行 bun test tests/locales.test.ts
      2. 检查退出码为 0
      3. 验证所有 zh/en 事件类型模板包含 Req 行
    预期结果：全部 18 个模板断言通过
    失败指示器：任何模板测试失败
    证据：.sisyphus/evidence/task-7-green-templates.txt

  场景：created 事件模板仅显示项目级
    工具：Bash（bun test + node REPL）
    前置条件：模板更新完成
    步骤：
      1. 加载 created 事件模板
      2. 用 renderTemplate 渲染，提供 projectRequestCount=5
      3. 验证输出包含 "Req(5)"
      4. 验证输出不含 "Req(undefined" 或 "Req(0/0"
    预期结果：created 模板的 Req 行格式为 Req(5)
    证据：.sisyphus/evidence/task-7-created-template.txt

  场景：modelID 正确迁移
    工具：Bash（bun test）
    前置条件：模板更新完成
    步骤：
      1. 渲染 idle 事件模板（含 modelID）
      2. 验证 Token 行不包含 modelID
      3. 验证 Req 行包含 modelID
    预期结果：modelID 仅在 Req 行出现
    证据：.sisyphus/evidence/task-7-modelid-migration.txt
  ```

  **提交**：是（分组到波次 3）
  - 消息：`feat(locales): add Req line to all default templates (zh/en)`
  - 文件：`src/locales.ts`
  - 预提交：`npx tsc --noEmit; if ($?) { bun test }`

- [x] 8. 递归子会话聚合和缓存恢复集成测试

  **要做什么**：
  - 扩展现有测试（`tests/project-aggregation.test.ts` 或独立测试文件）：
    - 测试深层嵌套子会话：父会话 -> 子会话 -> 孙子会话，验证 `totalRequestCount` 正确聚合所有层级
    - 测试缓存恢复后请求计数正确累加到 `projectAgg.requestCount`
    - 测试预加载会话（从 opencode.db 恢复）的请求计数参与项目聚合
    - 测试缓存 + 运行时混合场景：部分会话来自缓存，部分来自当前运行
    - 测试 `collectDescendantSessionIds()` 递归收集所有后代
  - 确保 `path.normalize()` 项目路径比较逻辑正确过滤跨项目会话

  **不得做**：
  - 不重复任务 2 中已有的基本测试用例
  - 不修改缓存文件的实际路径（使用 mock 或临时目录）

  **推荐代理配置**：
  - **类别**：`deep`
    - 理由：复杂集成测试，需要模拟多层级会话和缓存恢复场景
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：否
  - **并行组**：波次 4（与任务 9 并行）
  - **阻塞**：无（最终验证前）
  - **被阻塞**：任务 4、5

  **参考**：
  - `tests/project-aggregation.test.ts` - 现有聚合测试（mock/setup 模式）
  - `tests/utils/sample-configs.ts` - 测试配置工具
  - `src/session-cache.ts:aggregateProjectFromCache()` - 缓存聚合逻辑
  - `src/index.ts:collectDescendantSessionIds()` - 递归收集函数

  **验收标准**：
  - [ ] 深层嵌套子会话测试通过（3 层嵌套聚合正确）
  - [ ] 缓存恢复测试通过（历史会话贡献正确）
  - [ ] 混合场景测试通过（缓存 + 运行时）
  - [ ] `bun test` 全部通过

  **QA 场景**：

  ```
  场景：三层嵌套子会话聚合
    工具：Bash（bun test）
    前置条件：模拟父会话(2条消息)->子会话(3条)->孙子会话(1条)
    步骤：
      1. 运行嵌套聚合测试
      2. 验证 totalRequestCount = 6（2+3+1）
      3. 验证 sessionRequestCount = 2（仅当前会话）
    预期结果：三级聚合值均正确
    证据：.sisyphus/evidence/task-8-nested-aggregation.txt

  场景：缓存恢复混合场景
    工具：Bash（bun test）
    前置条件：模拟缓存含 2 个历史会话（各 3 条消息），运行时 1 个新会话（2 条消息）
    步骤：
      1. 触发项目聚合（含缓存恢复）
      2. 验证 projectRequestCount = 8（3+3+2）
    预期结果：项目聚合包含缓存和运行时数据
    证据：.sisyphus/evidence/task-8-cache-hybrid.txt
  ```

  **提交**：是（分组到波次 4）
  - 消息：`test(aggregation): add recursive sub-session and cache recovery tests`
  - 文件：`tests/request-count.test.ts`（追加）
  - 预提交：`bun test`

- [x] 9. 全部文档同步更新

  **要做什么**：
  - **`docs/configuration.md`**：
    - 在变量参考章节中添加三级请求计数变量表格（`sessionRequestCount` / `totalRequestCount` / `projectRequestCount`）
    - 更新全部 15 处 Token 行模板示例（第 640-832 行），改为新格式：
      ```
      Token({{sessionTokensTotalHuman}}/{{totalTokensTotalHuman}}/{{projectTokensTotalHuman}})  Cached: {{sessionCacheHitRate}}
      Req({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}})  {{modelID}}
      ```
    - created 事件的 Req 行：`Req({{projectRequestCount}})  {{modelID}}`
  - **`README.md`**：
    - 模板变量表格新增三级请求计数行
    - 变量数量从 "71+" 更新为 "74+"
  - **`docs/architecture/event-data-flow.md`**：
    - 第 235-242 行模板格式更新为 Token + Req 两行
    - 变量数量从 "71+" 更新为 "74+"
  - **`AGENTS.md`**：
    - 第 71 行 Token 行格式更新
    - recorder 变量数量从 "约56个" 更新为 "约59个"
  - **`docs/performance-optimization-test-guide.md`**：
    - 受影响的模板变量数量从 "15 个" 更新为 "18 个"

  **不得做**：
  - 不重写现有文档结构
  - 不删除任何现有变量文档
  - 不修改与请求计数无关的章节

  **推荐代理配置**：
  - **类别**：`writing`
    - 理由：多文档同步更新，需仔细处理模板格式和变量数量一致性
  - **技能**：`[]`

  **并行化**：
  - **可并行运行**：是
  - **并行组**：波次 4（与任务 8 并行）
  - **阻塞**：无（最终验证前）
  - **被阻塞**：任务 7

  **参考**：
  - `docs/configuration.md`（第 197-404 行变量参考、第 640-832 行模板示例）
  - `README.md`（第 112-116 行模板变量表格）
  - `docs/architecture/event-data-flow.md`（第 235-242 行模板格式、第 259 行变量数量）
  - `AGENTS.md`（第 33、71、101 行）
  - `docs/performance-optimization-test-guide.md`（第 47、73 行）

  **验收标准**：
  - [ ] `docs/configuration.md`：三级请求计数变量已记录 + 全部 15 处 Token 行示例已更新
  - [ ] `README.md`：模板变量表格含请求计数 + 变量数量已更新
  - [ ] `docs/architecture/event-data-flow.md`：模板格式 + 变量数量已更新
  - [ ] `AGENTS.md`：Token 格式 + recorder 变量数量已更新
  - [ ] `docs/performance-optimization-test-guide.md`：变量数量已更新
  - [ ] 所有文档无格式错误或拼写错误

  **QA 场景**：

  ```
  场景：所有文档包含请求计数变量
    工具：Bash（grep）
    前置条件：文档已更新
    步骤：
      1. grep "sessionRequestCount" docs/configuration.md
      2. grep "sessionRequestCount" README.md
      3. grep "Req(" docs/configuration.md
      4. grep "Req(" docs/architecture/event-data-flow.md
      5. grep "约59个" AGENTS.md
      6. grep "18 个" docs/performance-optimization-test-guide.md
    预期结果：所有文档包含新变量引用和更新后的格式
    失败指示器：任何文档缺少新变量或旧 Token 行格式
    证据：.sisyphus/evidence/task-9-docs-coverage.txt
  ```

  **提交**：是（分组到波次 4）
  - 消息：`docs: add requestCount variables to all documentation`
  - 文件：`docs/configuration.md`, `README.md`, `docs/architecture/event-data-flow.md`, `AGENTS.md`, `docs/performance-optimization-test-guide.md`
  - 预提交：无（文档不参与类型检查）

---

## 最终验证波次（强制 - 全部实施任务后）

> 4 个审查代理并行运行。全部必须 APPROVE。汇总结果并获取用户明确"okay"后才能完成。
>
> **在获取用户明确批准前不得自动继续。拒绝或用户反馈 -> 修复 -> 重新运行 -> 重新提交 -> 等待确认。**

- [x] F1. **计划合规性审计** — `oracle`
  端到端阅读计划。对每个"必须包含"：验证实施存在。对每个"必须排除"：搜索代码库中禁止的模式。检查证据文件存在于 `.sisyphus/evidence/`。对比交付物与计划。
  输出：`必须包含 [N/N] | 必须排除 [N/N] | 任务 [N/N] | 判定：APPROVE/REJECT`

- [x] F2. **代码质量审查** — `unspecified-high`
  运行 `tsc --noEmit` + `eslint src` + `bun test`。审查所有变更文件：`as any`/`@ts-ignore`、空 catch、console.log、注释代码、未使用导入。检查 AI 冗余：过度注释、过度抽象、通用名称（data/result/item/temp）。
  输出：`构建 [PASS/FAIL] | Lint [PASS/FAIL] | 测试 [N pass/N fail] | 文件 [N clean/N issues] | 判定`

- [x] F3. **实际手动 QA** — `unspecified-high`
  从干净状态开始。执行每个任务的每个 QA 场景。测试跨任务集成。测试边界情况：空会话、深层嵌套子会话、预加载恢复。保存到 `.sisyphus/evidence/final-qa/`。
  输出：`场景 [N/N pass] | 集成 [N/N] | 边界情况 [N 已测试] | 判定`

- [x] F4. **范围忠实度检查** — `deep`
  对每个任务：读取"要做什么"，读取实际差异。验证 1:1 对应。检查"不得做"合规性。检测跨任务污染。标记未计入的变更。
  输出：`任务 [N/N 合规] | 污染 [CLEAN/N issues] | 未计入 [CLEAN/N files] | 判定`

---

## 提交策略

- **1**: `feat(types): add requestCount fields to EventPayload and SessionCacheEntry` - src/types.ts
- **2**: `test(request-count): add TDD test cases for three-level request count` - tests/
- **3**: `test(locales): update template layout expectations for Req line` - tests/
- **4**: `feat(core): implement three-level request count aggregation in index.ts` - src/index.ts
- **5**: `feat(cache): persist requestCount in session cache` - src/session-cache.ts
- **6**: `feat(handler): expose requestCount variables in handler.ts` - src/handler.ts
- **7**: `feat(locales): add Req line to all default templates (zh/en)` - src/locales.ts
- **8**: `test(aggregation): add recursive sub-session and project aggregation tests` - tests/
- **9**: `docs: add requestCount variables to all documentation` - docs/configuration.md, README.md, docs/architecture/event-data-flow.md, AGENTS.md, docs/performance-optimization-test-guide.md

---

## 成功标准

### 验证命令
```bash
bun test                          # 预期：全部测试通过
npx tsc --noEmit                  # 预期：无类型错误
npx eslint src                    # 预期：无 lint 错误
```

### 最终检查清单
- [ ] 所有"必须包含"存在
- [ ] 所有"必须排除"缺失
- [ ] 所有测试通过
- [ ] 所有默认模板正确渲染三级请求计数
