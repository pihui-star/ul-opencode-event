# 插件重启后 token 数据预加载

## TL;DR

> **Quick Summary**: 新增 `db-preload.ts`，在插件初始化时用 `bun:sqlite` 只读打开 OpenCode 的 SQLite 数据库，预加载最近会话的 assistant 消息 token 数据到 `tokenDataMap`，解决插件重启后 token 显示为 0 的问题。
> 
> **Deliverables**:
> - `src/db-preload.ts` — 预加载函数
> - `src/bun-sqlite.d.ts` — bun:sqlite 类型声明
> - `src/index.ts` 集成调用
> - 单元测试
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: NO - sequential（单文件核心 + 集成）
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5

---

## Context

### Original Request
插件重启后 `tokenDataMap` 为空（纯内存 Map），旧会话的 token 显示为 0。需要在初始化时预加载历史数据。

### Research Findings
1. **OpenCode SQLite 数据库** (`opencode.db`) 存储了完整的 token 数据在 `message.data` JSON 字段中
2. **WAL 模式只读并发安全** — SQLite 官方确认
3. **bun:sqlite 内置** — 零外部依赖，支持 `{ readonly: true }`
4. **tokenscope 用 SDK API** — 不适合我们的场景（需要每次 HTTP 调用）
5. **业界先例** — better-sqlite3 作者确认多进程只读完全可行

### Metis Review
**关键发现**:
1. `message.data.tokens.cache` 是嵌套对象（`{ read: N, write: N }`），需要转为我们的扁平 `TokenBreakdown` 格式
2. SQL 查询必须按 `time_created ASC` 排序，保证 Map 插入顺序正确
3. `bun:sqlite` 没有 TypeScript 类型定义，需要自定义声明文件
4. 预加载不得阻塞插件返回超过 200ms
5. 每行 `JSON.parse(data)` 需要 try/catch（可能为 null/非 JSON）
6. 预加载的数据会被后续 `message.updated` 事件自然覆盖（同 messageId 的 set 操作）

---

## Work Objectives

### Core Objective
插件初始化时从 SQLite 预加载最近 N 个会话的 assistant 消息 token 数据，使重启后旧会话的 token 不再显示为 0。

### Concrete Deliverables
- `src/db-preload.ts` — `preloadTokenData(tokenDataMap, dataDir)` 函数
- `src/bun-sqlite.d.ts` — bun:sqlite 最小类型声明
- `src/index.ts` — 在 tokenDataMap 创建后调用预加载
- `tests/db-preload.test.ts` — 单元测试

### Definition of Done
- [ ] 插件重启后，旧会话首次事件显示非零 token（当有已完成消息时）
- [ ] DB 文件不存在/损坏时插件正常启动，无报错
- [ ] typecheck 通过
- [ ] 现有测试全部通过

### Must Have
- 只读打开数据库，绝不写入
- 静默失败（DB 不可用时只写 debug 日志）
- 数据转换：DB 格式 `tokens.cache.read` → TokenBreakdown `cacheRead`
- SQL 按 time_created ASC 排序
- 每行 JSON.parse 有 try/catch

### Must NOT Have (Guardrails)
- 不添加 `better-sqlite3` 或任何外部依赖
- 不保持 DB 长连接（open-read-close 模式）
- 不添加后台刷新机制
- 不修改现有事件处理流程（fillTokenData/aggregateSubSessions）
- 不在 CLI 模式下预加载
- 不添加用户可配置的 DB 路径

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION**

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **Automated tests**: YES (tests-after)
- **Framework**: bun test

### QA Policy
每个 task 包含 agent-executed QA scenarios。

---

## Execution Strategy

```
Task 1: 新增 bun-sqlite.d.ts 类型声明 [quick]
  |
Task 2: 新增 db-preload.ts 预加载函数 [deep]
  |
Task 3: 集成到 index.ts [quick]
  |
Task 4: 单元测试 [unspecified-high]
  |
Task 5: 更新文档 [quick]
```

---

## TODOs

- [x] 1. 新增 bun-sqlite.d.ts 类型声明

  **What to do**:
  - 在 `src/` 目录创建 `bun-sqlite.d.ts` 文件
  - 声明 `bun:sqlite` 模块的最小类型（仅 Database class 的构造函数、prepare、close 方法）
  - 确保 `tsc --noEmit` 通过

  **Must NOT do**:
  - 不安装任何 npm 包
  - 不修改 tsconfig.json

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **References**:
  - Bun 文档中 `bun:sqlite` 的 API：`new Database(path, options)`, `db.prepare(sql).all(...params)`, `db.close()`
  - `src/types.ts` — 了解项目中类型声明风格

  **Acceptance Criteria**:
  - [ ] `src/bun-sqlite.d.ts` 存在
  - [ ] `import { Database } from 'bun:sqlite'` 在 TS 中不报错
  - [ ] `npm run typecheck` 通过

  **Commit**: YES (groups with 2, 3)

- [x] 2. 新增 db-preload.ts 预加载函数

  **What to do**:
  - 创建 `src/db-preload.ts`
  - 导出函数 `preloadTokenData(tokenDataMap: Map<string, SessionTokenData>, dataDir: string): void`
  - 逻辑：
    1. 用 `bun:sqlite` 以 `{ readonly: true }` 打开 `${dataDir}/opencode.db`
    2. 查询最近 N 个 session 的 assistant 消息：
       ```sql
       SELECT id, session_id, data FROM message
       WHERE json_extract(data, '$.role') = 'assistant'
         AND session_id IN (
           SELECT id FROM session ORDER BY time_updated DESC LIMIT 10
         )
       ORDER BY session_id, time_created ASC
       ```
    3. 遍历每行，try/catch JSON.parse(data)
    4. 从 data 中提取 tokens/cost/modelID/providerID/mode
    5. 转换 token 格式：`data.tokens.cache.read` → `cacheRead`, `data.tokens.cache.write` → `cacheWrite`
    6. 安全转换数值：`Number(x) || 0`
    7. 写入 tokenDataMap（与 message.updated 事件相同的数据结构）
    8. 关闭 DB 连接
  - 整个函数包裹在 try/catch 中，任何异常只写 debug 日志
  - N 默认为 10（可函数参数覆盖）

  **Must NOT do**:
  - 不保持 DB 连接
  - 不修改 tokenDataMap 后续处理逻辑
  - 不在模块级自动执行

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **References**:
  **Pattern References**:
  - `src/index.ts:618-658` — `message.updated` 事件中 tokenDataMap 的写入模式，**必须完全一致**（相同的数据结构、相同的字段名）
  - `src/index.ts:629-634` — 数值安全转换：`Number(event.properties.info.tokens?.input) || 0`

  **API/Type References**:
  - `src/types.ts:SessionTokenData` — 目标数据结构
  - `src/types.ts:TokenData` — 单条消息的 token 数据
  - `src/types.ts:TokenBreakdown` — token 分项

  **External References**:
  - DB 中 message.data 的 tokens 格式：`{ input, output, reasoning, cache: { read, write } }`
  - 我们的 TokenBreakdown 格式：`{ input, output, reasoning, cacheRead, cacheWrite, total }`
  - 转换：`cacheRead = data.tokens.cache?.read ?? 0`, `cacheWrite = data.tokens.cache?.write ?? 0`

  **Acceptance Criteria**:
  - [ ] `src/db-preload.ts` 存在且导出 `preloadTokenData`
  - [ ] `npm run typecheck` 通过
  - [ ] DB 文件不存在时不抛异常
  - [ ] JSON.parse 失败时跳过该行

  **Commit**: YES (groups with 1, 3)

- [x] 3. 集成到 index.ts

  **What to do**:
  - 在 `src/index.ts` 第 554 行 `const tokenDataMap = new Map<...>()` 之后
  - 添加预加载调用：
    ```typescript
    // Preload token data from OpenCode database (plugin restart recovery)
    try {
      const { preloadTokenData } = await import('./db-preload.js');
      preloadTokenData(tokenDataMap, dataDir);
    } catch { /* non-critical, plugin works without preloaded data */ }
    ```
  - `dataDir` 需要从 `logger.ts` 或 `recorder.ts` 中获取相同的环境变量逻辑

  **Must NOT do**:
  - 不在顶层静态 import db-preload（保持延迟导入模式）
  - 不修改 tokenDataMap 的后续使用

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **References**:
  - `src/index.ts:554` — tokenDataMap 创建位置
  - `src/logger.ts` — dataDir 获取逻辑
  - `src/recorder.ts` — dataDir 获取逻辑

  **Acceptance Criteria**:
  - [ ] 预加载在 tokenDataMap 创建后调用
  - [ ] 失败时不影响插件启动
  - [ ] `npm run typecheck` 通过
  - [ ] `npm run build` 通过

  **Commit**: YES (groups with 1, 2)
  - Message: `feat(token): 插件初始化时从 SQLite 预加载历史 token 数据`
  - Files: `src/bun-sqlite.d.ts`, `src/db-preload.ts`, `src/index.ts`

- [x] 4. 单元测试

  **What to do**:
  - 创建 `tests/db-preload.test.ts`
  - 测试场景：
    1. 正常预加载：mock DB 返回 assistant 消息，验证 tokenDataMap 被填充
    2. DB 文件不存在：函数不抛异常
    3. JSON 解析失败：跳过损坏行，不中断
    4. token 格式转换：cache.read → cacheRead
    5. 数值安全转换：null/undefined/NaN → 0
    6. 排序正确性：先创建的消息在前（Map 插入顺序）
  - Mock 策略：mock `bun:sqlite` 模块
  - 运行 `npm run typecheck && bun test && npm run build`

  **Must NOT do**:
  - 不修改现有测试

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **References**:
  - `tests/index.test.ts` — 搜索 "Token Accum" 或 "Token Dedup" 参考测试结构
  - `tests/index.test.ts` 中 mock 模式：`mock.module()`

  **Acceptance Criteria**:
  - [ ] 新增 >= 5 个测试用例
  - [ ] bun test 通过
  - [ ] npm run typecheck 通过
  - [ ] npm run build 通过

  **Commit**: YES
  - Message: `test(token): 新增 db-preload 预加载单元测试`
  - Files: `tests/db-preload.test.ts`

- [x] 5. 更新文档

  **What to do**:
  - 更新 `docs/architecture/event-data-flow.md`：新增第 7 节"预加载"
  - 更新 `docs/issues/token-zero-on-mid-event.md`：记录预加载机制
  - 更新 `AGENTS.md`：添加 db-preload.ts 到架构说明

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **References**:
  - `docs/architecture/event-data-flow.md`
  - `docs/issues/token-zero-on-mid-event.md`
  - `AGENTS.md`

  **Acceptance Criteria**:
  - [ ] 文档描述与新实现一致

  **Commit**: YES
  - Message: `docs(token): 添加 SQLite 预加载文档`
  - Files: `docs/architecture/event-data-flow.md`, `docs/issues/token-zero-on-mid-event.md`, `AGENTS.md`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** -- `oracle`
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** -- `unspecified-high`
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

---

## Commit Strategy

- **Task 1+2+3**: `feat(token): 插件初始化时从 SQLite 预加载历史 token 数据`
- **Task 4**: `test(token): 新增 db-preload 预加载单元测试`
- **Task 5**: `docs(token): 添加 SQLite 预加载文档`

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck    # Expected: 0 errors
npm run test         # Expected: all pass (updater.test.ts excluded)
npm run build        # Expected: success
```

### Final Checklist
- [ ] 插件重启后旧会话 token 不为 0
- [ ] DB 文件不存在时插件正常启动
- [ ] 所有现有测试通过
- [ ] 零新增外部依赖
