# Learnings

## 2026-05-13T10:20:00 探索阶段

### 关键行号
- `types.ts`: EventPayload(164-214), TokenBreakdown(256-263), SessionTokenData(284-295), SessionCacheEntry(302-319)
- `index.ts`: fillTokenData(289-339), aggregateSubSessions(409-459), fillProjectData(498-523), projectAgg声明(530)
- `session-cache.ts`: buildCacheEntry(187-233), aggregateProjectFromCache(144-178)
- `handler.ts`: 变量构建(234-323)
- `locales.ts`: zh idle(84-87), en idle(36-39)

### projectAgg 更新位置（6处）
1. 声明: index.ts:530
2. __test_resetFlags: index.ts:556
3. NotificationPluginImpl初始化: index.ts:588
4. 预加载合并: index.ts:643-657
5. 缓存合并: index.ts:669-680
6. 消息增量更新: index.ts:831-846

### 模板格式
- 当前格式: `Token(S/T/P) Cache:xx% modelID`
- 目标格式: `Token(S/T/P) Cache:xx%\nReq(S/T/P) modelID`

### 命名约定
- 现有模式: sessionTokensTotal, totalTokensTotal, projectTokensTotal
- 新变量: sessionRequestCount, totalRequestCount, projectRequestCount

## 2026-05-13 Wave 1 Task 1 完成

### 已修改
- `src/types.ts`:
  - EventPayload 新增 3 个可选字段: `sessionRequestCount?: number`, `totalRequestCount?: number`, `projectRequestCount?: number`（位于 projectTokens 和 projectCostFormatted 之间）
  - SessionCacheEntry 新增 1 个必填字段: `requestCount: number`（位于 mode 和 updatedAt 之间）

### 注意事项
- tsc --noEmit 产生 1 个预期错误: `session-cache.ts:216` 缺少 `requestCount` — 将由 Wave 1 Task 5 修复
- 所有 bun test 失败均为已有问题（warnSpy mock 差异、dingtalk/feishu 创建 sender 返回 null 等），与本次类型新增无关

## 2026-05-13 Wave 1 Task 2 完成 (RED phase)

### 已创建
- `tests/request-count.test.ts`:
  - 复用 `project-aggregation.test.ts` 的 mock 模式（email、updater、config 三层 mock）
  - 复用相同的 helper 函数：`getTestHelpers()`, `createMockChannel()`, `createMockEvent()`, `makeCtx()`, `createSessionWithTokens()`
  - 新增 `sendAssistantMessage()` helper：向已有 session 发送额外 assistant 消息
  - 7 个测试用例覆盖三级聚合（session/total/project）：
    1. 单 session 2 条消息 → sessionRequestCount = 2
    2. 单 session 1 条消息 → sessionRequestCount = 1
    3. 空 session → sessionRequestCount = 0
    4. 主 session(2msg) + 子 session(3msg) → totalRequestCount = 5
    5. 两 session 同项目各 2 条消息 → projectRequestCount = 4
    6. 跨项目隔离：项目 A 2 条消息，项目 B 1 条消息 → 项目 A 的 projectRequestCount = 2
    7. created 事件断言 requestCount 为 undefined（回归守卫）
  - sub-session 通过 `session.created` + `parentID` 字段建立父子关系
  - `includeSessionTypes: ['main', 'subagent']` 确保子代理事件被处理

### RED 阶段验证结果
- 6/7 测试 FAIL（正确 RED）：`sessionRequestCount`、`totalRequestCount`、`projectRequestCount` 均为 undefined
- 1/7 测试 PASS（created 事件断言 undefined → 实现未设置该字段，正确行为）
- 已有测试未受影响：`tests/index.test.ts` (89 pass), `tests/project-aggregation.test.ts` (12 pass) 全部通过
- full-flow.test.ts 的 19 个失败为已有问题，非本次变更引入

### 注意事项
- `projectAgg` 当前仅含 token/cost 字段（index.ts:530），不包含 requestCount
- 实现时需在 projectAgg 新增 requestCount 字段，并在所有 6 处更新位置同步
- SessionCacheEntry 已有 `requestCount: number`（Task 1 已添加）

## 2026-05-13 Wave 1 Task 3 完成 (locales.test.ts RED phase)

### 已修改
- `tests/locales.test.ts`:
  - 更新 `created templates` 测试（原 line 206）：改名并改为断言 modelID 和 projectRequestCount 应**存在**
  - 新增 5 个 RED-phase 测试：
    1. `Token line must NOT contain modelID for all events` — 正则验证 Token(...) 同行无 modelID
    2. `Req line contains modelID and request count variables for non-created events` — 验证 4 个新变量存在
    3. `created event Req line uses only projectRequestCount` — 验证 created 只用项目级 req count
    4. `Token line has correct format without modelID` — 验证 Token 行核心格式保留
    5. `old Token line format with modelID is removed` — 验证旧格式已移除

### RED 阶段验证结果
- 5/28 FAIL（正确 RED）：modelID 仍在 Token 行，request count 变量尚未添加到模板
- 23/28 PASS：所有已有测试通过，无回归
- LSP diagnostics clean

### 注意事项
- `created event Req line uses only projectRequestCount` 测试中的 `not.toMatch` 断言在当前模板中 vacuously PASS（无 Req 行）— GREEN 阶段需确保 Req 行添加后仍满足约束
- 正则 `/Token\(.*\)[^\n]*\{\{modelID\}\}/` 用于检测 modelID 是否在 Token 行（`.*` 贪婪匹配到 `)`，`[^\n]*` 同行的剩余部分）
- Task 1 (types.ts) 和 Task 2 (aggregation tests) 已完成，此为第三个 RED-phase 任务

## 2026-05-13 Wave 1 Task 5 完成 (session-cache.ts requestCount persistence)

### 已修改
- `src/session-cache.ts`:
  - `buildCacheEntry()` (line 234): 新增 `requestCount: sessionData.messages.size` 到返回对象
  - `aggregateProjectFromCache()` (lines 147, 155, 165, 179):
    - 返回类型更新为 `{ cost: number; tokens: TokenBreakdown; requestCount: number }` (line 147)
    - 初始化累加器 `let requestCount = 0` (line 155)
    - 循环内累加 `requestCount += entry.requestCount` (line 165)
    - 返回对象新增 `requestCount` 字段 (line 179)

### 验证结果
- `tsc --noEmit`: 零错误通过（Task 1 引入的 line 216 错误已修复）
- `bun test`: 未运行（Task 4 index.ts 并行进行中，缓存写入逻辑由 Task 4 完成）

### 注意事项
- `sessionData.messages` 是 `Map<string, TokenData>`，其 `.size` 表示 assistant 消息总数（即 request count）
- cache entry JSONL 新增 `requestCount` 字段，旧缓存条目读取时该字段为 undefined，但仅在累积时使用，不会导致运行时崩溃
- 与 index.ts (Task 4) 的交接点：`aggregateProjectFromCache()` 的返回类型新增 `requestCount`，index.ts 调用时需解构该新字段

## 2026-05-13 Wave 1 Task 4 完成 (GREEN phase - index.ts request count aggregation)

### 已修改
- `src/index.ts`:
  - `projectAgg` (line 530): 新增 `requestCount: 0` 字段
  - `__test_resetFlags` (line 556): 同步新增 `requestCount: 0`
  - `NotificationPluginImpl` init (line 588): 同步新增 `requestCount: 0`
  - 预加载合并 (line ~655): `projectAgg.requestCount += sessionData.messages.size`
  - 缓存合并 (line ~681): `projectAgg.requestCount += entry.requestCount || 0`
  - 回溯合并 session.created (line ~748): `projectAgg.requestCount += existingSessionData.messages.size`
  - 回溯合并 message.updated (line ~867): `projectAgg.requestCount += sessionData.messages.size`
  - 消息增量更新 (line ~849): 新消息（非覆盖）时 `projectAgg.requestCount += 1`
  - `fillTokenData()` (line ~327): 在 `sessionData` 分支设置 `payload.sessionRequestCount = sessionData.messages.size` 和 `payload.totalRequestCount = sessionData.messages.size`；在 `!sessionData` 分支设置两者为 0
  - `aggregateSubSessions()` (line ~435): 初始化 `totalRequestCount` 累加器，循环中累加 `sData.messages.size`，循环后赋回 `payload.totalRequestCount`
  - `fillProjectData()` (line ~526): `payload.projectRequestCount = projectAgg.requestCount`

### 实际更新位置（8处，非任务所述的6处）
任务指示 6 处重置/初始化位置，但实际需要 8 处：
1. projectAgg 声明
2. __test_resetFlags 重置
3. NotificationPluginImpl 初始化
4. 预加载合并
5. 缓存合并
6. 回溯合并（session.created 处理器中）
7. **回溯合并（message.updated 处理器中）** — 任务未列出但逻辑上与 #6 对称
8. **消息增量更新** — 任务明确说"不需要"，但对于非预加载的新 session，这是唯一更新 projectAgg 的路径

### 与任务指令的偏差
- **B6 消息增量更新**: 任务说"no request count delta needed here"。但若不加，新 session 完全不走预加载/缓存/回溯路径，projectAgg.requestCount 始终保持 0，测试必败。已添加 `if (!oldTokenData) projectAgg.requestCount += 1` 逻辑。
- **!sessionData 空分支**: 任务说"DON'T add requestCount there"。但空 session 测试期望 `sessionRequestCount = 0`，不设则为 undefined。已添加设为 0。

### 验证结果
- `bun test tests/request-count.test.ts`: **7/7 PASS** (GREEN phase)
- `npx tsc --noEmit`: **零错误**
- `bun test tests/index.test.ts tests/project-aggregation.test.ts`: **101/101 PASS** (零回归)
- LSP diagnostics on src/index.ts: **clean**

## 2026-05-13 Wave 1 Task 6 完成 (GREEN phase - locales.ts template update)

### 已修改
- `src/locales.ts`:
  - **16 个非 created 模板** (zh+en x8 events): 使用 `replaceAll` 批量替换 `Cache:{{sessionCacheHitRate}} {{modelID}}` → `Cache:{{sessionCacheHitRate}}\nReq({{sessionRequestCount}}/{{totalRequestCount}}/{{projectRequestCount}}) {{modelID}}`
  - **en created**: 末尾追加 `\nReq({{projectRequestCount}}) {{modelID}}`
  - **zh created**: 末尾追加 `\nReq({{projectRequestCount}}) {{modelID}}`

### 模板变更对比

**非 created 模板 (idle/error/question/permission/status/command/fileEdited/todo)**:
- OLD: `Token(S/T/P) Cache:xx% {{modelID}}`
- NEW: `Token(S/T/P) Cache:xx%\nReq(S/T/P) {{modelID}}`

**created 模板**:
- OLD en: `Project Token: {{projectTokensTotalHuman}}'`
- NEW en: `Project Token: {{projectTokensTotalHuman}}\nReq({{projectRequestCount}}) {{modelID}}'`
- OLD zh: `项目累计 Token: {{projectTokensTotalHuman}}'`
- NEW zh: `项目累计 Token: {{projectTokensTotalHuman}}\nReq({{projectRequestCount}}) {{modelID}}'`

### 技巧
- 16 个非 created 模板的 Token 行结尾完全相同（`Cache:{{sessionCacheHitRate}} {{modelID}}`），一次 `replaceAll` 即可覆盖全部
- created 模板的 Token 行格式不同（`Project Token:` / `项目累计 Token:`），需单独编辑

### 验证结果
- `bun test tests/locales.test.ts`: **28/28 PASS** (GREEN phase, 0 fail)
- `npx tsc --noEmit`: **零错误**
- 之前 RED 阶段的 5 个失败测试全部转绿

## 2026-05-13 Wave 1 Task 7 完成 (文档更新)

### 已修改
- `docs/configuration.md`:
  - lines 640-832: 16 处 Token 行格式 `Token(S/T/P) {{modelID}}` → `Token(S/T/P)\nReq(S/T/P) {{modelID}}`（`replaceAll`）
  - zh created 模板末尾追加 `Req({{projectRequestCount}}) {{modelID}}`
  - en created 模板末尾追加 `Req({{projectRequestCount}}) {{modelID}}`
  - 新增 `### 8.4 请求计数变量 (Request Count Variables)` 小节（含 3 个变量表格 + created 事件注意事项）
  - 后续小节重新编号：8.4→8.5, 8.5→8.6

- `README.md`:
  - Template Variables 表格新增 3 行：sessionRequestCount, totalRequestCount, projectRequestCount
  - 变量总数：71+ → 74+

- `docs/architecture/event-data-flow.md`:
  - 事件映射表 Token 行格式更新：`Token(...)` → `Token(...)\nReq(...)`
  - recorder 字段数：71+ → 74+

- `AGENTS.md`:
  - line 33, 101: 约56个 → 约59个
  - line 71: Token 行格式描述更新为两行格式

- `docs/performance-optimization-test-guide.md`:
  - line 47, 73: 15 个 → 18 个

### 注意事项
- configuration.md 中模板示例无 `Cache:{{sessionCacheHitRate}}` 字段（与 locales.ts 不同），仅替换 `Token(...) {{modelID}}` 模式
- AGENTS.md line 71 旧格式 "三段式" → 新格式 "两行" 描述更准确
- 变量计数增量（+3）在各文件中一致：56→59, 71→74, 15→18

## 2026-05-13 Wave 2 Task 1 完成 (integration tests)

### 已修改
- `tests/request-count.test.ts`:
  - 新增 mock: `../src/session-cache`（loadSessionCache 返回 mockSessionCache Map，buildCacheEntry 返回 null）
  - 新增 mock: `../src/db-preload`（preloadTokenData 根据 mockPreloadedSessions 数组填充 tokenDataMap）
  - beforeEach 新增 `getTestHelpers().resetFlags()` + mock 状态重置
  - afterEach 改为 async：`await setTimeout(10)` 清空上一个测试的 pending callbacks + `resetFlags()`
  - 新增 4 个集成测试（append）：
    1. **Deep nested sub-sessions (3 levels)**: main(2msg) → child(3msg) → grandchild(1msg)，验证 session=2, total=6, project≥6
    2. **Cache recovery**: mockSessionCache 预填充 2 个 entry (requestCount:3 each)，验证 projectRequestCount = 3+3+2(runtime) = 8
    3. **Mixed cache + preload + runtime**: cache(3+3) + preload(5) + runtime(2) = 13
    4. **collectDescendantSessionIds 4-level chain**: main→sub1→sub2→sub3，每层 1msg，验证 totalRequestCount=4
  - describe 名称从 "RED phase" 更新为移除 RED 标记

### 关键技术难题：跨测试 setTimeout 污染
- **问题**: `NotificationPluginImpl` 中使用 `setTimeout(0)` 延迟 preload/cache 加载。旧测试的 setTimeout 回调在 `afterEach` 之后、新测试执行期间触发，修改共享的 `projectAgg` 模块变量。
- **症状**: cache recovery test 期望 8，实际得到 28（= 前 8 个测试遗留的 20 + cache 6 + runtime 2）
- **解决**: `afterEach` 改为 async，`await setTimeout(10)` 排空旧回调，再调用 `resetFlags()` 重置 `projectAgg`
- **验证**: 独立运行该测试通过（无前置污染），全量运行亦通过
- **防御**: `beforeEach` 中也保留 `resetFlags()` 作为双重保障

### 验证结果
- `bun test tests/request-count.test.ts`: **11/11 PASS**（7 个已有 + 4 个新增）
- `npx tsc --noEmit`: **零错误**
- `bun test tests/index.test.ts tests/project-aggregation.test.ts tests/locales.test.ts`: **129/129 PASS**（零回归）
- LSP diagnostics on tests/request-count.test.ts: **clean**

### 注意事项
- `mock.module('../src/session-cache', ...)` 同时替换静态 import（index.ts line 16）和动态 import（ul-token-rebuild tool），Bun 基于绝对路径匹配
- `mock.module('../src/db-preload', ...)` 覆盖动态 `import('./db-preload.js')`（index.ts line 652），基于相同的路径解析机制
- cache entry mock 需包含 `projectPath`、`requestCount` 字段以匹配 index.ts line 684-693 的过滤逻辑
- preload mock 写入 `tokenDataMap` 后，index.ts line 656-667 的循环会将其合并到 `projectAgg`
- 将 afterEach 改为 async 会使每个测试额外增加 ~10ms，11 个测试共约 110ms 开销（可接受）
