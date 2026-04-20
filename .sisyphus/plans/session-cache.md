# 会话级 Token 缓存：项目级聚合准确度提升

## TL;DR

> **Quick Summary**: 新增会话级 Token 缓存模块，将已完成会话的聚合 token 数据持久化到 JSONL 文件，解决项目级聚合只包含最近 10 个会话的问题。遵循现有 recorder.ts 的文件 I/O 模式。
> 
> **Deliverables**:
> - `src/session-cache.ts` - 会话缓存模块（加载/写入/去重/轮转）
> - 修改 `src/index.ts` - 集成缓存到 fillProjectData
> - `tests/session-cache.test.ts` - 缓存模块单元测试
> - 更新 `tests/` 中相关测试
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 3 -> Task 5 -> Task 7 -> F1-F4

---

## Context

### Original Request
项目级 token 聚合不准确。db-preload.ts 只加载最近 10 个会话，导致 `aggregateProjectTokens` 严重失真。用户开发一个月的项目只有 50M tokens，远低于实际用量。

### Interview Summary
**Key Discussions**:
- 方案对比：直接 SQL 聚合 vs 缓存文件 vs 加大 limit，选择缓存文件方案
- 更新策略：混合策略（idle 完整写入 + status 节流写入）
- 文件位置：与现有数据文件同目录（~/.local/share/opencode/）

**Research Findings**:
- 已完成的会话 token 数据不可变（核心洞察）
- 现有 recorder.ts / file.ts 的 JSONL 模式可直接复用
- tokenDataMap 存的是 per-message 数据，缓存存 per-session 聚合

### Metis Review
**Identified Gaps** (addressed):
- error 事件也需触发缓存写入：已纳入计划
- 子会话关系在缓存中无法表达：可接受，total 级别只计当前运行时的子会话，历史子会话计入 project
- 多实例并发写入风险：接受现有风险级别（与 recorder.ts 一致）
- 缓存降级路径：文件不存在时回退到现有行为

---

## Work Objectives

### Core Objective
将项目级 token 聚合从"最近 10 个会话"提升到"所有历史会话"，通过会话级缓存文件持久化聚合数据，并提供 DB 全量同步 tool。

### Concrete Deliverables
- `src/session-cache.ts`：新模块，JSONL 缓存文件管理
- `src/index.ts`：修改 fillProjectData 为双数据源（缓存 + 实时），注册 token-sync tool
- 缓存文件：`~/.local/share/opencode/ul-opencode-event-session-cache.jsonl`
- `token-sync` tool：AI 可调用，从 DB 全量同步历史会话到缓存
- 完整的单元测试覆盖

### Definition of Done
- [ ] `bun test` 全部通过（含新增和已有测试）
- [ ] 触发 idle 事件后，缓存文件出现对应会话条目
- [ ] 项目级聚合包含缓存中所有历史会话的数据
- [ ] 缓存文件不存在时，回退到现有行为无报错
- [ ] 调用 ul-token-rebuild tool 后，缓存包含 DB 中所有历史会话数据

### Must Have
- 会话完成后写入缓存（idle + error 事件）
- 缓存加载时 "latest-per-session wins" 去重
- 损坏 JSONL 行静默跳过
- 跨项目隔离（projectPath 过滤）
- 零 token 会话不写入缓存
- status 事件节流写入（60s 间隔）
- **ul-token-rebuild tool**：通过 `Hooks.tool` 注册，扫描 DB 全量同步到缓存，返回统计信息

### Must NOT Have (Guardrails)
- 不修改 db-preload.ts
- 不修改 aggregateProjectTokens 的聚合算法
- 不改变 fillProjectData 的函数签名
- 不引入外部依赖
- 不在插件启动时做 DB 全量同步（只在 tool 调用时做）
- 不实现文件锁机制
- 不添加缓存清理/过期策略
- 不重构现有模块的路径解析逻辑

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run tests, inspect results
- **File I/O**: Use Bash (node script) - Generate test data, verify file contents

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
+-- Task 1: session-cache.ts 核心模块 [deep]
+-- Task 2: 缓存类型定义 [quick]

Wave 2 (After Wave 1 - integration):
+-- Task 3: 修改 fillProjectData 集成缓存 [unspecified-high]
+-- Task 4: 缓存写入触发逻辑 [unspecified-high]
+-- Task 8: ul-token-rebuild tool 注册 + DB 全量同步 [deep]

Wave 3 (After Wave 2 - tests + docs):
+-- Task 5: 缓存模块单元测试 [deep]
+-- Task 6: 更新已有测试适配新行为 [unspecified-high]
+-- Task 7: 更新文档和 AGENTS.md [writing]

Wave FINAL (After ALL tasks - 4 parallel reviews):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 2 -> Task 3 -> Task 5 -> Task F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 3)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 3, 4, 5, 8 | 1 |
| 2 | - | 3 | 1 |
| 3 | 1, 2 | 5, 6 | 2 |
| 4 | 1 | 5, 6 | 2 |
| 8 | 1 | 5, 6 | 2 |
| 5 | 3, 4, 8 | F1-F4 | 3 |
| 6 | 3, 4, 8 | F1-F4 | 3 |
| 7 | - | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks - T1 `deep`, T2 `quick`
- **Wave 2**: 3 tasks - T3 `unspecified-high`, T4 `unspecified-high`, T8 `deep`
- **Wave 3**: 3 tasks - T5 `deep`, T6 `unspecified-high`, T7 `writing`
- **FINAL**: 4 tasks - F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. 创建 session-cache.ts 核心模块

  **What to do**:
  - 新建 `src/session-cache.ts`，遵循 `recorder.ts` 的文件 I/O 模式（`createRequire` + lazy init + `appendFileSync` + 轮转）
  - 实现以下导出函数：
    - `loadSessionCache(dataDir: string): Map<string, SessionCacheEntry>` -- 读取 JSONL，latest-per-session wins 去重，损坏行跳过并 warn
    - `writeCacheEntry(dataDir: string, entry: SessionCacheEntry): void` -- 追加一行 JSONL，文件超 2MB 时轮转（保留后半部分，与 recorder.ts 一致）
    - `aggregateProjectFromCache(cache: Map<string, SessionCacheEntry>, projectPath: string): { cost: number; tokens: TokenBreakdown }` -- 按 projectPath 过滤并累加
    - `buildCacheEntry(sessionId: string, sessionData: SessionTokenData): SessionCacheEntry | null` -- 从 tokenDataMap 中的 SessionTokenData 计算聚合，token 全零返回 null
  - 缓存文件路径：`OPENCODE_DATA_DIR ?? ~/.local/share/opencode/ul-opencode-event-session-cache.jsonl`
  - 所有函数不抛异常，错误时 logger.error 后静默返回空结果

  **Must NOT do**:
  - 不引入外部依赖
  - 不实现文件锁
  - 不实现 DB 查询

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 新模块从零创建，需要理解 recorder.ts 的 I/O 模式并正确实现 JSONL 加载/去重/轮转逻辑
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4, 5
  - **Blocked By**: None

  **References**:
  **Pattern References** (existing code to follow):
  - `src/recorder.ts:1-114` -- 完整的 JSONL 文件 I/O 模式：createRequire 绕过 mock、lazy init、appendFileSync、2MB 轮转、路径解析
  - `src/recorder.ts:31-36` -- 路径解析：`OPENCODE_DATA_DIR` 环境变量处理
  - `src/recorder.ts:67-80` -- 轮转策略：读取文件内容，保留后半部分，行对齐
  - `src/recorder.ts:93-113` -- 写入模式：先检查大小，超限轮转，追加写入，全程 try/catch
  - `src/logger.ts` -- logger 导入方式

  **API/Type References**:
  - `src/types.ts:248-255` -- TokenBreakdown 接口定义
  - `src/types.ts:276-287` -- SessionTokenData 接口（messages Map, projectPath）
  - `src/types.ts:259-271` -- TokenData 接口（cost, tokens, modelID, providerID, mode）
  - `src/index.ts:81-107` -- `sumAllCompletedTokens()` 累加逻辑（缓存聚合应与此等价）
  - `src/index.ts:36-74` -- `aggregateSessionTokens()` cost 累加方式

  **External References**:
  - 无外部依赖

  **WHY Each Reference Matters**:
  - recorder.ts 是 JSONL 文件操作的参考模板，新模块应完全复用其 I/O 模式
  - sumAllCompletedTokens 是聚合算法的权威实现，缓存条目的 tokens 字段必须与其结果一致
  - TokenBreakdown/SessionTokenData 是类型约束，缓存模块必须正确使用这些类型

  **Acceptance Criteria**:
  - [ ] `src/session-cache.ts` 文件存在且通过 `tsc --noEmit`
  - [ ] 导出 4 个函数：loadSessionCache, writeCacheEntry, aggregateProjectFromCache, buildCacheEntry
  - [ ] buildCacheEntry 对全零 token 会话返回 null
  - [ ] loadSessionCache 对损坏 JSON 行跳过不崩溃

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: 缓存文件加载与去重
    Tool: Bash (bun test)
    Preconditions: 创建临时 JSONL 文件，包含 3 行（其中 sessionId_A 出现 2 次，第二次 tokens 不同）
    Steps:
      1. 调用 loadSessionCache 读取文件
      2. 验证返回 Map 大小为 2（sessionId_A 去重，保留最后一次）
      3. 验证 sessionId_A 的 tokens.input === 第二次的值
    Expected Result: Map 包含 2 个条目，sessionId_A 为最新值
    Failure Indicators: Map 大小不是 2，或 sessionId_A tokens 与第二次不一致
    Evidence: .sisyphus/evidence/task-1-load-dedup.txt

  Scenario: 损坏行跳过
    Tool: Bash (bun test)
    Preconditions: JSONL 文件中间一行是无效 JSON（如 `{broken json`）
    Steps:
      1. 调用 loadSessionCache
      2. 验证不抛异常
      3. 验证损坏行前后的有效行正常加载
    Expected Result: 返回有效行数据，损坏行被跳过
    Evidence: .sisyphus/evidence/task-1-corrupt-line.txt

  Scenario: 轮转触发
    Tool: Bash (bun test)
    Preconditions: 创建接近 2MB 的 JSONL 文件
    Steps:
      1. 调用 writeCacheEntry 追加一行
      2. 验证文件被轮转（文件大小小于原始）
      3. 验证文件仍包含有效 JSONL 行
    Expected Result: 文件大小减少，内容有效
    Evidence: .sisyphus/evidence/task-1-rotation.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(cache): add session token cache module and types`
  - Files: `src/session-cache.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 2. 在 types.ts 中添加缓存类型定义

  **What to do**:
  - 在 `src/types.ts` 中新增 `SessionCacheEntry` 接口：
    ```typescript
    interface SessionCacheEntry {
      sessionId: string;
      projectPath: string;
      tokens: TokenBreakdown;   // sumAllCompletedTokens 的结果
      cost: number;             // 所有消息 cost 累加
      modelID: string;          // 最后一条消息的 modelID
      providerID: string;       // 最后一条消息的 providerID
      mode: string;             // 最后一条消息的 mode
      updatedAt: string;        // ISO 8601 时间戳
    }
    ```

  **Must NOT do**:
  - 不修改现有接口
  - 不引入外部类型

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件，新增一个接口定义
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:
  **API/Type References**:
  - `src/types.ts:248-255` -- TokenBreakdown，SessionCacheEntry.tokens 使用此类型
  - `src/types.ts:276-287` -- SessionTokenData，理解其字段以定义缓存条目

  **Acceptance Criteria**:
  - [ ] `src/types.ts` 包含 `SessionCacheEntry` 接口导出
  - [ ] 通过 `tsc --noEmit`

  **QA Scenarios**:
  ```
  Scenario: 类型检查通过
    Tool: Bash
    Steps:
      1. npx tsc --noEmit
    Expected Result: 无类型错误
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(cache): add session token cache module and types`
  - Files: `src/types.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 3. 修改 fillProjectData 集成双数据源

  **What to do**:
  - 修改 `src/index.ts` 中的 `fillProjectData` 函数，改为从两个数据源合并：
    1. 从 `sessionCacheMap`（缓存）读取所有历史会话聚合（排除当前运行中的会话 ID，即 tokenDataMap 中已有的 sessionId）
    2. 从 `tokenDataMap` 读取当前运行中会话的实时聚合（调用 `sumAllCompletedTokens` + cost sum）
    3. 合并两者作为项目级总量
  - 在 `NotificationPluginImpl` 函数中加载缓存：`const sessionCache = loadSessionCache(baseDir);`
  - 将 `sessionCache` 传入 `fillProjectData`（通过参数传递，不改变函数签名为原则，但需要新增一个参数来传递缓存 Map；实际上改签名是必要的，保持最小改动）
  - 修改 `aggregateProjectTokens` 的调用处，改为 `aggregateProjectFromCache` + tokenDataMap 实时数据合并

  **Must NOT do**:
  - 不修改 aggregateProjectTokens 的内部聚合算法
  - 不删除 aggregateProjectTokens 函数（可能被其他地方引用）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解现有的 fillProjectData 调用链，正确集成双数据源，确保不破坏现有行为
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Tasks 1, 2

  **References**:
  **Pattern References**:
  - `src/index.ts:465-514` -- 当前 `fillProjectData` 和 `aggregateProjectTokens` 的完整实现
  - `src/index.ts:553-797` -- `NotificationPluginImpl` 函数，理解 tokenDataMap 和 sessionCache 的初始化位置
  - `src/index.ts:764-765` -- 当前 fillProjectData 的调用点：`fillProjectData(payload, tokenDataMap, ctx.directory, ...)`
  - `src/index.ts:610-619` -- 插件初始化区域，缓存加载应在此处

  **API/Type References**:
  - `src/index.ts:81-107` -- `sumAllCompletedTokens()`，计算当前运行中会话的实时聚合
  - `src/session-cache.ts` -- `loadSessionCache`, `aggregateProjectFromCache`, `buildCacheEntry`（Task 1 产物）

  **Acceptance Criteria**:
  - [ ] fillProjectData 从缓存 + tokenDataMap 双数据源合并
  - [ ] 当前运行中的会话从 tokenDataMap 实时计算（不被缓存覆盖）
  - [ ] 缓存文件不存在时回退到现有行为
  - [ ] `npx tsc --noEmit` 通过
  - [ ] `bun test tests/` 已有测试全部通过

  **QA Scenarios**:
  ```
  Scenario: 缓存文件存在时的项目级聚合
    Tool: Bash (bun test)
    Preconditions: 模拟缓存中有 3 个历史会话（projectPath 匹配），tokenDataMap 有 1 个当前会话
    Steps:
      1. 触发 fillProjectData
      2. 验证 projectTokens 包含 4 个会话的累加值
    Expected Result: projectTokens = 3 个缓存会话 + 1 个当前会话的累加
    Evidence: .sisyphus/evidence/task-3-dual-source.txt

  Scenario: 缓存文件不存在的降级
    Tool: Bash (bun test)
    Preconditions: 缓存文件路径指向不存在的文件
    Steps:
      1. 触发 fillProjectData
      2. 验证 projectTokens 只包含 tokenDataMap 中的当前会话
      3. 验证无异常日志
    Expected Result: 与修改前的行为一致，不报错
    Evidence: .sisyphus/evidence/task-3-fallback.txt
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `feat(cache): integrate cache into project-level token aggregation`
  - Files: `src/index.ts`
  - Pre-commit: `bun test`

- [x] 4. 添加缓存写入触发逻辑

  **What to do**:
  - 在 `src/index.ts` 的事件处理中添加缓存写入：
    1. `session.idle` 事件处理后：调用 `buildCacheEntry` + `writeCacheEntry`，写入当前会话聚合
    2. `session.error` 事件处理后：同上，error 事件也需要写入（会话异常终止不会再有 idle）
    3. `session.status` 事件：节流写入，每 60 秒最多一次（模块级变量记录上次写入时间）
  - 写入条件：`buildCacheEntry` 返回非 null（跳过全零 token 会话）
  - 缓存写入使用 fire-and-forget 模式（try/catch 包裹，不阻塞通知发送）

  **Must NOT do**:
  - 不让缓存写入失败影响通知发送
  - 不在 created 事件时写入（无 token 数据）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解事件处理流程，正确添加写入触发点，实现节流逻辑
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src/index.ts:786-795` -- 事件处理结束区域（`await eventHandler.handle(payload.eventType, payload)` 之后），缓存写入应在此之后
  - `src/index.ts:519-520` -- 模块级变量模式（`hasCheckedUpdate`, `hasShownStartupToast`），节流时间戳应使用同样模式
  - `src/recorder.ts:93-113` -- fire-and-forget 写入模式

  **API/Type References**:
  - `src/session-cache.ts` -- `writeCacheEntry`, `buildCacheEntry`
  - `src/types.ts` -- `SessionCacheEntry`

  **Acceptance Criteria**:
  - [ ] idle 事件处理后写入缓存
  - [ ] error 事件处理后写入缓存
  - [ ] status 事件 60 秒内最多写入一次
  - [ ] 全零 token 会话不写入
  - [ ] 写入失败不阻塞通知

  **QA Scenarios**:
  ```
  Scenario: idle 事件触发缓存写入
    Tool: Bash (bun test)
    Preconditions: tokenDataMap 中有一个含非零 token 的会话
    Steps:
      1. 模拟 session.idle 事件
      2. 读取缓存文件
      3. 验证包含对应 sessionId 的 JSONL 行
    Expected Result: 缓存文件包含该会话的聚合数据
    Evidence: .sisyphus/evidence/task-4-idle-write.txt

  Scenario: status 事件节流
    Tool: Bash (bun test)
    Preconditions: 模拟两次 status 事件间隔 < 60s
    Steps:
      1. 触发 status 事件 -> 缓存写入
      2. 立即触发第二个 status 事件
      3. 验证缓存文件只有 1 行新增（第二次被节流）
    Expected Result: 第二次 status 不产生新的缓存写入
    Evidence: .sisyphus/evidence/task-4-throttle.txt

  Scenario: 全零 token 会话不写入
    Tool: Bash (bun test)
    Preconditions: tokenDataMap 中有一个全零 token 的会话（无 assistant 消息）
    Steps:
      1. 触发 idle 事件
      2. 验证缓存文件无新增行
    Expected Result: 缓存文件不变
    Evidence: .sisyphus/evidence/task-4-zero-skip.txt
  ```

  **Commit**: YES (groups with Task 3)
  - Message: `feat(cache): integrate cache into project-level token aggregation`
  - Files: `src/index.ts`
  - Pre-commit: `bun test`

- [x] 8. 注册 ul-token-rebuild tool + DB 全量同步

  **What to do**:
  - 在 `src/index.ts` 的 `NotificationPluginImpl` 返回值中添加 `tool` 字段：
    ```typescript
    import { tool } from '@opencode-ai/plugin';

    return {
      event: async ({ event }) => { /* 现有 */ },
      tool: {
        "ul-token-rebuild": tool({
          description: "从 OpenCode 数据库重建会话 token 缓存。扫描所有历史会话，将缺失的会话聚合数据写入缓存文件。用于首次安装、缓存丢失后恢复、或定期刷新项目级 token 聚合准确度。",
          args: {},
          execute: async (args, toolCtx) => {
            // 1. 加载现有缓存
            // 2. 查询 DB 中所有 assistant 消息（按 session 分组，过滤 projectPath）
            // 3. 对缓存中不存在的会话计算聚合
            // 4. 写入缓存文件
            // 5. 返回统计：同步了多少新会话、总计多少会话、总 token
          }
        })
      }
    };
    ```
  - 在 `src/session-cache.ts` 中新增 `syncFromDB(dataDir: string, projectPath: string, existingCache: Map<string, SessionCacheEntry>): Promise<SyncResult>` 函数：
    - 打开 `opencode.db`（readonly，与 db-preload 相同模式）
    - 查询所有匹配 projectPath 的会话中不在 existingCache 里的
    - 对每个会话的消息计算聚合（等价于 sumAllCompletedTokens）
    - 写入缓存文件
    - 返回 `{ newSessions: number, totalSessions: number, totalTokens: TokenBreakdown }`
  - SQL 查询参考 db-preload.ts 的模式，但不过滤 LIMIT，而是过滤 NOT IN existing sessionIds
  - 注意 `import { tool }` 需要从 `@opencode-ai/plugin` 导入，需要确认是否需要 lazy import

  **Must NOT do**:
  - 不在插件启动时自动执行同步
  - 不修改 db-preload.ts
  - 不加载已有缓存中的会话（只处理缺失的）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解 OpenCode plugin tool API、SQL 聚合查询、与 session-cache 模块集成
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src/db-preload.ts:1-127` -- DB 查询模式：bun:sqlite readonly、SQL 查询、JSON 解析、错误处理
  - `src/db-preload.ts:30-39` -- SQL JOIN session 表的模式（projectSQL），需要类似但不加 LIMIT
  - `src/db-preload.ts:60-112` -- 消息数据解析：从 data JSON 提取 tokens/cost/modelID
  - `src/index.ts:803-806` -- 当前 PluginModule 导出格式，需要在 server 函数返回中添加 tool

  **API/Type References**:
  - `node_modules/@opencode-ai/plugin/dist/tool.d.ts:40-48` -- `tool()` 函数签名：description, args (zod), execute
  - `node_modules/@opencode-ai/plugin/dist/index.d.ts:170-180` -- `Hooks.tool` 类型：`{ [key: string]: ToolDefinition }`
  - `node_modules/@opencode-ai/plugin/dist/tool.d.ts:3-25` -- `ToolContext`：包含 directory, worktree, sessionID
  - `src/types.ts:248-255` -- TokenBreakdown
  - `src/index.ts:81-107` -- `sumAllCompletedTokens()` 逻辑，DB 聚合应与此等价

  **WHY Each Reference Matters**:
  - db-preload.ts 是 DB 操作的权威参考，tool 中的 SQL 查询应复用其模式
  - tool.d.ts 定义了 tool 注册的接口约束
  - sumAllCompletedTokens 是聚合算法的权威，DB 聚合必须产生相同结果

  **Acceptance Criteria**:
  - [ ] 插件注册了 `ul-token-rebuild` tool
  - [ ] tool 调用时查询 DB，只处理缓存中不存在的会话
  - [ ] 返回同步统计信息
  - [ ] `npx tsc --noEmit` 通过

  **QA Scenarios**:
  ```
  Scenario: tool 调用成功同步
    Tool: Bash (bun test)
    Preconditions: 缓存中有 2 个会话，DB 中有 5 个会话（同项目路径）
    Steps:
      1. 模拟调用 ul-token-rebuild tool execute
      2. 验证返回 newSessions=3, totalSessions=5
      3. 重新加载缓存，验证包含 5 个会话
    Expected Result: 缓存新增 3 个会话，总计 5 个
    Evidence: .sisyphus/evidence/task-8-sync.txt

  Scenario: 幂等性（重复调用）
    Tool: Bash (bun test)
    Preconditions: 缓存已包含所有 DB 会话
    Steps:
      1. 调用 ul-token-rebuild tool execute
      2. 验证返回 newSessions=0
      3. 缓存文件无新增行
    Expected Result: 无新会话被添加
    Evidence: .sisyphus/evidence/task-8-idempotent.txt
  ```

  **Commit**: YES (groups with Tasks 3, 4)
  - Message: `feat(cache): integrate cache into project-level token aggregation`
  - Files: `src/index.ts`, `src/session-cache.ts`
  - Pre-commit: `bun test`

  **What to do**:
  - 新建 `tests/session-cache.test.ts`
  - 测试用例覆盖：
    1. loadSessionCache：正常加载、去重（同 sessionId 多行）、损坏行跳过、空文件、文件不存在
    2. writeCacheEntry：正常追加、轮转触发
    3. buildCacheEntry：正常会话、全零 token 返回 null、空 messages Map
    4. aggregateProjectFromCache：正常累加、跨项目隔离、空缓存
  - 使用 `mock.module('node:fs')` 模拟文件系统操作
  - 遵循现有测试模式：`import { describe, it, expect, mock } from 'bun:test'`

  **Must NOT do**:
  - 不测试 index.ts 的集成逻辑（那是 Task 6 的范围）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 完整的单元测试套件，需要覆盖多种边界情况
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 3, 4

  **References**:
  **Test References**:
  - `tests/utils/mock-transport.ts` -- 现有 mock 模式参考
  - `tests/utils/sample-configs.ts` -- 测试配置参考
  - `tests/recorder.test.ts` -- 如果存在，JSONL 模块测试参考
  - `tests/db-preload.test.ts` -- DB/文件操作测试参考

  **API/Type References**:
  - `src/session-cache.ts` -- 被测模块的所有导出函数
  - `src/types.ts:SessionCacheEntry` -- 缓存条目类型

  **Acceptance Criteria**:
  - [ ] `bun test tests/session-cache.test.ts` 全部通过
  - [ ] 覆盖上述 4 个测试场景

  **QA Scenarios**:
  ```
  Scenario: 测试套件通过
    Tool: Bash
    Steps:
      1. bun test tests/session-cache.test.ts
    Expected Result: 所有测试通过，0 failures
    Evidence: .sisyphus/evidence/task-5-tests.txt
  ```

  **Commit**: YES (groups with Tasks 6, 7)
  - Message: `test(cache): add session cache tests and update docs`
  - Files: `tests/session-cache.test.ts`
  - Pre-commit: `bun test`

- [x] 6. 更新已有测试适配新行为

  **What to do**:
  - 运行 `bun test` 检查哪些已有测试失败
  - 在已有测试中 mock 掉 `session-cache` 模块（使用 `mock.module`），确保隔离
  - 添加集成测试用例：验证 fillProjectData 使用缓存后的项目级聚合正确性
  - 确保所有已有测试通过

  **Must NOT do**:
  - 不删减已有测试的断言
  - 不修改测试框架或运行方式

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要理解现有测试结构，正确 mock 新依赖
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 5, 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 3, 4

  **References**:
  **Test References**:
  - `tests/index.test.ts` -- 主入口测试，可能需要 mock session-cache
  - `tests/integration/full-flow.test.ts` -- 集成测试
  - `tests/db-preload.test.ts` -- DB 预加载测试

  **Acceptance Criteria**:
  - [ ] `bun test` 全部通过（含已有和新增测试）
  - [ ] 已有测试无失败

  **QA Scenarios**:
  ```
  Scenario: 全量测试通过
    Tool: Bash
    Steps:
      1. bun test
    Expected Result: 所有测试通过，0 failures
    Evidence: .sisyphus/evidence/task-6-all-tests.txt
  ```

  **Commit**: YES (groups with Tasks 5, 7)
  - Message: `test(cache): add session cache tests and update docs`
  - Files: `tests/` 下的相关文件
  - Pre-commit: `bun test`

- [x] 7. 更新文档

  **What to do**:
  - 更新 `AGENTS.md`：
    - 在架构部分的文件列表中添加缓存文件说明
    - 在"本地文件"表格中新增一行：`ul-opencode-event-session-cache.jsonl` | `session-cache.ts` | JSON Lines | 会话级 token 聚合缓存
  - 更新 `docs/architecture/event-data-flow.md`：
    - 在 3.6 项目级聚合部分添加缓存数据源说明
    - 说明双数据源合并逻辑：缓存历史会话 + tokenDataMap 当前会话
  - 更新 `docs/configuration.md` 无需修改（变量名不变）

  **Must NOT do**:
  - 不添加新的配置项文档（无新增配置）
  - 不修改 README.md（功能无用户可见变化）

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 纯文档更新
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 5, 6)
  - **Blocks**: F1-F4
  - **Blocked By**: None（可与 Wave 1/2 并行，但逻辑上应在实现后确认）

  **References**:
  - `AGENTS.md` -- 项目架构文档
  - `docs/architecture/event-data-flow.md:188-205` -- 当前 3.6 项目级聚合描述

  **Acceptance Criteria**:
  - [ ] AGENTS.md 文件列表包含缓存文件
  - [ ] event-data-flow.md 3.6 节描述了缓存数据源

  **QA Scenarios**:
  ```
  Scenario: 文档完整性
    Tool: Bash (grep)
    Steps:
      1. grep "session-cache" AGENTS.md
      2. grep "session-cache" docs/architecture/event-data-flow.md
    Expected Result: 两处都有匹配
    Evidence: .sisyphus/evidence/task-7-docs.txt
  ```

  **Commit**: YES (groups with Tasks 5, 6)
  - Message: `test(cache): add session cache tests and update docs`
  - Files: `AGENTS.md`, `docs/architecture/event-data-flow.md`
  - Pre-commit: `bun test` (MANDATORY -- after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.
> Never mark F1-F4 as checked before getting user's okay. Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns -- reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Run `tsc --noEmit` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** -- `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task -- follow exact steps, capture evidence. Test cross-task integration. Test edge cases: empty state, invalid input. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** -- `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 -- everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(cache): add session token cache module and types` - src/session-cache.ts, src/types.ts
- **Wave 2**: `feat(cache): integrate cache into project-level token aggregation` - src/index.ts
- **Wave 3**: `test(cache): add session cache tests and update docs` - tests/, docs/, AGENTS.md
- Pre-commit: `bun test`

---

## Success Criteria

### Verification Commands
```bash
bun test                                          # Expected: all pass
npx tsc --noEmit                                  # Expected: no errors
grep -c "sessionId" ~/.local/share/opencode/ul-opencode-event-session-cache.jsonl  # Expected: > 0 after idle event
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Cache file appears after idle/error events
- [ ] Project-level aggregation includes cached sessions
- [ ] Graceful fallback when cache file missing
