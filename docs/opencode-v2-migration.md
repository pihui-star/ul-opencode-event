# OpenCode v2 插件迁移与启用修复记录

> 状态：已修复（v0.2.0+）
> 排查日期：2026-11-11
> opencode 版本：2.2.7（`@opencode/cli`）
> 插件版本：0.2.0
> 旧版 SDK：`@opencode-ai/plugin@1.18.31` → 新版 SDK：`@opencode/plugin@2.2.7`

---

## 一、现象

插件在 OpenCode 中**完全无法启用**：

- `opencode plugin list` 中条目的 ID 与版本列均为 `-`（加载失败）
- 日志中每次启动都会报错：

```
level=WARN message="failed to load plugin" target=@ulthon/ul-opencode-event
  cause="Cause([Die(ResolveMessage: Cannot find package '@opencode-ai/plugin' imported from
  C:\Users\poenr\.cache\opencode\npm\@ulthon\ul-opencode-event@latest\1794357249909\node_modules\
  @ulthon\ul-opencode-event\dist\plugin-core.js)])"
```

- 插件不接收任何事件，通知完全静默

## 二、根因

本机 OpenCode 已升级到 **v2.2.7**，而插件仍是 **v1 API** 实现。v2 明确说明：

> V1 plugin implementations do not run in V2. Moving a file or renaming its config entry is not enough.

两个独立问题叠加：

### 问题 1：运行时依赖缺失（导致加载直接失败）

OpenCode v2 把插件包安装到 `~/.cache/opencode/npm/<pkg>@<version>/<timestamp>/node_modules/`，
**只安装 `dependencies`，不安装 `devDependencies`**。旧版把 `@opencode-ai/plugin` 放在
`devDependencies` 中，并在 `dist/plugin-core.js` 里留下了运行时导入：

```js
import { tool } from '@opencode-ai/plugin';   // ← 运行时导入，缓存副本里不存在
```

模块解析失败 → 整个插件加载失败（静默）。

**修复**：把 `@opencode/plugin` 声明为 **`dependencies`**，并用 `Plugin.define` 的官方 API。

### 问题 2：v1 插件实现本身在 v2 不会运行

即使依赖齐全，v1 的「导出函数 + 返回 hooks」写法在 v2 也不再被识别。

## 三、v1 → v2 API 映射

| v1 | v2 |
|---|---|
| `import { type Plugin, tool } from '@opencode-ai/plugin'` | `import { Plugin } from '@opencode/plugin'` |
| `export default NotificationPlugin`（函数） | `export default Plugin.define({ id, setup(ctx) })` |
| `ctx.directory` | `ctx.location.directory` |
| `return { event: async ({ event }) => {} }` | `ctx.event.subscribe({ types, signal })`（异步迭代器） |
| `return { tool: { name: tool({...}) } }` | `ctx.tool.transform((editor) => editor.add({...}))` |
| `tool.schema.*`（zod） | JSON Schema（`{ type: 'object', properties: {} }`） |
| 工具返回 `string` | 工具返回 `{ content: string }` |
| `event.properties` | `event.data` |
| `ctx.client.tui.showToast()` | **服务端插件无 toast 能力**（改用日志） |
| 配置键 `"plugin"` | 配置键 `"plugins"` |

### 事件类型变化

| v1 事件 | v2 事件 / 机制 |
|---|---|
| `session.created` | `session.created`（data 为扁平字段） |
| `session.idle` | **`ctx.session.hook('experimental.idle', ...)`**（v2 不再发布 idle 事件） |
| `session.error` | `session.execution.failed` |
| `session.status` | `session.status`（`status.type`: `busy` / `idle` / `retry`） |
| `question.asked` | `form.created` |
| `permission.updated` | `permission.asked` |
| `command.executed` | `session.shell.ended` |
| `file.edited` | `filesystem.changed` |
| `todo.updated` | v2 无对应事件（保留模板变量，不再产生通知） |
| `message.updated`（token 来源） | `session.step.ended` / `session.usage.updated` |

## 四、Token / 费用统计改造

v2 的 `Session.Info` 直接带累计用量，且数据库 `session_v2` 表持久化了每个会话的
`cost / tokens_*`，`session_message` 表可统计 assistant 请求数。因此：

- **主数据源**：`opencode.db`（`session_v2` + `session_message`）
- **实时叠加**：`session.usage.updated`（会话累计）/ `session.step.ended`（单次请求）
- **兜底**：JSONL 会话缓存（`ul-opencode-event-session-cache.jsonl`）

聚合层级不变：会话级 / 会话+子代理级 / 项目级。

## 五、修复内容

### `package.json`

```diff
- "devDependencies": { "@opencode-ai/plugin": "^1.18.0", ... }
+ "dependencies": { "@opencode/plugin": "2.2.7", "nodemailer": "^6.9.0" }
```

### `src/plugin-core.ts`（重写）

- `export default Plugin.define({ id: 'ul-opencode-event', setup })`
- `setup()` 内部：加载配置 → 注册 `ul-token-rebuild` 工具 → 注册 `experimental.idle` hook → 订阅事件流 → 返回清理函数（`AbortController.abort()`）
- 事件分发按 `event.data` 解析（v2 信封）

### `src/event-mapper.ts`（重写）

- 事件映射改为 v2 数据结构，新增 `form.created` / `permission.asked` / `session.shell.ended` / `filesystem.changed`
- 不再在此处填充 token（统一由 plugin-core 注入用量快照）

### `src/usage.ts`（新增）

- `readProjectUsage()`：读取项目下所有会话的累计用量
- `readSessionDirectory()`：反查会话所属目录
- `aggregateUsage()`：会话 / 会话+子代理 / 项目三级聚合
- `mergeLiveUsage()`：实时事件覆盖数据库快照

### `src/token-aggregator.ts`（重写）

`fillTokenData(payload, session, total, project, ...)`：把用量快照写入 payload 并格式化费用。

### `src/updater.ts`（重写）

v2 由 OpenCode 自己管理插件安装（`opencode plugin update`），插件不再删除/重装缓存目录，
只做版本检查并写日志。

## 六、附带修复：多实例重复通知

OpenCode v2 会**为每个 location 创建一个插件实例**，且每个实例都能收到完整事件流。
最初的移植版本因此对同一个事件发了 N 次通知。

**修复**（`src/plugin-core.ts`）：

1. 按事件 location 过滤：事件所属目录 ≠ 实例目录 → 跳过（由该目录的实例负责）
2. 事件无 location 时，用会话目录（事件 → `ctx.session.get()` → 数据库）判定
3. 仍无法判定时，用「独占创建标记文件」跨进程去重（`ul-opencode-event-claims/`）

## 七、验证结果

| 检查项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm test` | 434 通过 / 0 失败 |
| `npm run lint` | 0 error |
| `opencode plugin list` | `ul-opencode-event  local  D:\workspace\ul-opencode-event` |
| 插件加载日志 | 无 `failed to load plugin` |
| 事件流 | 收到 `session.created` / `session.usage.updated` / `session.step.ended` / `session.renamed` |
| idle 通知 | `experimental.idle` hook 触发，飞书 + file 各 1 条（无重复） |
| token 统计 | 通知中 `sessionTokens.total` / `projectTokens` 为真实数值 |
| 工具注册 | `ul-token-rebuild` 可用 |

## 八、用户侧操作

1. `~/.config/opencode/opencode.json`：

```json
{
  "plugins": ["@ulthon/ul-opencode-event"]
}
```

2. 发布新版本后更新插件：

```bash
opencode plugin update
```

3. 本地开发模式（直接跑源码）：

```json
{
  "plugins": ["file:///D:/workspace/ul-opencode-event"]
}
```

> 本地模式下插件跳过自动更新检查，且 OpenCode 会监听 `dist/` 变化自动热重载。

## 九、相关文件

| 文件 | 用途 |
|---|---|
| `src/plugin-core.ts` | v2 插件定义、事件分发、位置过滤、跨进程去重 |
| `src/usage.ts` | 用量读取与三级聚合 |
| `src/event-mapper.ts` | v2 事件 → EventPayload |
| `src/token-aggregator.ts` | 用量快照 → payload 字段 |
| `src/session-cache.ts` | JSONL 会话缓存（兜底数据源） |
| `src/updater.ts` | 版本检查（只读，不改安装目录） |
| `docs/opencode-1.18-compatibility-fix.md` | **历史文档**：1.18 时代的兼容性修复 |
| `docs/issues/plugin-no-events-after-upgrade.md` | **历史文档**：1.18 时代收不到事件的排查 |
