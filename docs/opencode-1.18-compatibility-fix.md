# OpenCode 1.18 插件兼容性修复记录

> ⚠️ **历史文档（OpenCode 1.18 时代）**
> 本插件已迁移到 OpenCode v2 插件 API（`@opencode/plugin` + `Plugin.define`），
> 下面描述的 `@opencode-ai/plugin` / `{ id, server }` 导出格式**仅适用于 OpenCode 1.x**，不再使用。
> 当前状态见 [opencode-v2-migration.md](./opencode-v2-migration.md)。

## 背景

`@ulthon/ul-opencode-event` 插件在 opencode 1.18 中无法正常加载。经过排查，发现两个独立的兼容性问题，均已修复。

- **排查日期**: 2026-09-19
- **opencode 版本**: 1.18.31
- **插件版本**: 0.1.59

---

## 问题一：导出格式不兼容

### 问题根因

opencode 1.18 的插件加载器（`packages/opencode/src/plugin/index.ts`）通过以下流程加载外部插件：

```
1. Config: plugin = ["@ulthon/ul-opencode-event"]
     ↓
2. PluginLoader.loadExternal():
   a. resolvePluginTarget(spec) → npm 包路径
   b. resolvePluginEntrypoint() → 检查 exports["./server"]，回退到 main 字段
   c. import(entry) → 加载模块
     ↓
3. applyPlugin(load, input, hooks):
   a. readV1Plugin(mod, "server", "detect") → 检查 mod.default 是否为 { id, server } 对象
   b. 若失败 → getLegacyPlugins(mod) → 遍历所有 export 将函数当作插件工厂
```

### 修复前的导出（有问题）

```typescript
// src/plugin-core.ts
export default NotificationPlugin;  // 裸函数
```

加载时的行为：
1. `readV1Plugin` 检查 `mod.default` → 是函数，`isRecord()` 返回 `false`
2. `mode="detect"` → 返回 `undefined`
3. 回退到 `getLegacyPlugins(mod)` → 遍历 `Object.values(mod)`，将每个函数导出当作插件工厂
4. 可能导致重复注册或静默失败

### 修复后的导出（正确）

```typescript
// src/plugin-core.ts
export default {
  id: '@ulthon/ul-opencode-event',
  server: NotificationPlugin,
};
```

加载时的行为：
1. `readV1Plugin` 检查 `mod.default` → 是对象，`isRecord()` 返回 `true`
2. 检查 `"server" in value` → `true`
3. 返回该对象 → `applyPlugin` 调用 `plugin.server(input, load.options)` 正确初始化

---

## 问题二：静态导入 `@opencode-ai/plugin` 导致模块加载失败

### 问题根因

opencode 的插件安装机制将 npm 包复制到 `~/.cache/opencode/packages/@ulthon/ul-opencode-event@latest/node_modules/@ulthon/ul-opencode-event/`。该缓存副本只包含运行时依赖（如 `nodemailer`），但 `@opencode-ai/plugin` 是 `devDependency`，不会被复制。

原代码中有静态导入：

```typescript
import { type Plugin, tool } from '@opencode-ai/plugin';
```

当 opencode 加载插件时：
1. Node.js ESM 加载器尝试解析 `@opencode-ai/plugin`
2. 在缓存副本的 node_modules 中找不到该包
3. **整个模块加载失败**（静默失败，无明显错误日志）
4. 插件完全不激活——不接收任何事件，不发送任何通知

### 修复方案

将 `tool` 从静态导入改为在 `tool` 属性定义中直接内联工具结构体：

```typescript
// src/plugin-core.ts
// 修复前：
import { type Plugin, tool } from '@opencode-ai/plugin';

// 修复后：
import type { Plugin } from '@opencode-ai/plugin';  // 仅类型导入（编译时擦除）
```

```typescript
// tool 属性中不再依赖 tool() 包装器
tool: {
  'ul-token-rebuild': {
    description: '...',
    args: {} as Record<string, never>,
    execute: async (_args, _toolCtx) => { ... },
  },
},
```

### 影响

- `ul-token-rebuild` 工具仍然正常工作（opencode 运行时通过 `@opencode-ai/plugin` 提供 `tool` 函数）
- 插件核心功能（事件监听、通知发送）不再依赖 `@opencode-ai/plugin` 包
- 修复了插件在缓存副本中静默不激活的问题

---

## 修改的文件

### `src/plugin-core.ts`

**修改 1：导出格式（第 475-488 行）**

```diff
-/**
- * Default export is the plugin function itself, matching the OpenCode plugin
- * loader contract: `Plugin = (input: PluginInput, options?) => Promise<Hooks>`.
- *
- * Note: an earlier `{ id, server }` object export was used as a transitional
- * format between 1.14 and 1.18; opencode 1.18's loader rejects that shape and
- * silently drops the plugin, so we now export the function directly.
- */
-export default NotificationPlugin;
+/**
+ * Default export uses the V1 object format `{ id, server }` which is the
+ * recommended shape for opencode 1.18+ plugin compatibility.
+ *
+ * The `readV1Plugin` function in opencode's plugin loader checks `mod.default`
+ * for an object with a `server` (or `tui`) property. If `mod.default` is a
+ * plain function, it falls through to `getLegacyPlugins` which iterates all
+ * exports and treats each function as a plugin factory — this can cause
+ * duplicate registrations or silent failures.
+ */
+export default {
+  id: '@ulthon/ul-opencode-event',
+  server: NotificationPlugin,
+};
```

**修改 2：移除静态 tool 导入（第 10 行）**

```diff
-import { type Plugin, tool } from '@opencode-ai/plugin';
+import type { Plugin } from '@opencode-ai/plugin';
```

**修改 3：tool 属性内联（第 455-470 行）**

```diff
-    tool: {
-      'ul-token-rebuild': tool({
-        description: '...',
-        args: {},
-        execute: async (_args, _toolCtx) => { ... },
-      }),
-    },
+    tool: {
+      'ul-token-rebuild': {
+        description: '...',
+        args: {} as Record<string, never>,
+        execute: async (_args, _toolCtx) => { ... },
+      },
+    },
```

---

## 兼容性检查清单

### 1. PluginInput 字段

| 字段 | 插件是否使用 | 1.18 是否存在 |
|------|-------------|--------------|
| `ctx.client` | 是 | 是 |
| `ctx.directory` | 是 | 是 |
| `ctx.project` | 否 | 是 |
| `ctx.worktree` | 否 | 是 |
| `ctx.serverUrl` | 否 | 是 |
| `ctx.$` | 否 | 是 |
| `ctx.experimental_workspace` | 否 | 是 |

### 2. ctx.client.tui.showToast

调用格式与 SDK `TuiShowToastData.body` 完全匹配。

### 3. Hooks 返回类型

`Hooks` 接口所有字段均为 optional，插件返回 `{ event, tool }` 完全兼容。

### 4. package.json exports

`exports["./server"]` 字段存在，opencode 的 `resolvePackageEntrypoint` 会优先查找该字段。

---

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `npm test`（539 tests） | 0 fail |
| `npm run lint` | 0 error（仅预存 warning） |
| 导出格式验证 | `{ id, server }` ✓ |
| opencode plugin install | 已安装到全局配置 |
| opencode 日志无加载错误 | 确认 |
| 飞书通知发送 | 已确认收到 |

---

## 排查经验

### opencode 日志位置

- 系统日志：`~/.local/share/opencode/log/opencode.log`
- 插件日志：`~/.local/share/opencode/ul-opencode-event.log`

### 常见错误模式

| 错误信息 | 含义 |
|---------|------|
| `failed to load plugin path=list error="Plugin export is not a function"` | 配置文件中包含非插件条目（如误加 `"list"`） |
| `level=ERROR ... plugin` 无日志输出 | 静态导入失败导致模块加载中断 |
| `Notification sent: status -> default-file` 但无飞书 | 配置文件 JSON 解析失败，回退到默认 file 通道 |

### 本地开发调试

修改代码后需同步到 opencode 缓存：

```powershell
Copy-Item "dist\*" "$env:USERPROFILE\.cache\opencode\packages\@ulthon\ul-opencode-event@latest\node_modules\@ulthon\ul-opencode-event\dist\" -Recurse -Force
```

启用 debug 日志：

```powershell
$env:UL_OPENCODE_EVENT_DEBUG = "1"
```

---

## 相关文件索引

| 文件 | 用途 |
|------|------|
| `src/plugin-core.ts` | 插件主入口，包含导出格式定义 |
| `src/index.ts` | 模块入口，re-export plugin-core |
| `src/types.ts` | 类型定义 |
| `src/handler.ts` | 多通道事件分发器 |
| `src/event-mapper.ts` | SDK 事件到 EventPayload 转换 |
| `src/token-aggregator.ts` | Token 聚合逻辑 |
| `src/session-cache.ts` | 会话级 token 缓存 |
| `src/config.ts` | 配置加载与合并 |
| `package.json` | exports["./server"] 入口声明 |

## 参考链接

- [OpenCode 插件迁移指南](https://opencode.ai/v2/docs/build/plugins/migrate-v1)
- [opencode plugin/shared.ts (GitHub)](https://github.com/anomalyco/opencode/blob/master/packages/opencode/src/plugin/shared.ts)
- [opencode plugin/index.ts (GitHub)](https://github.com/anomalyco/opencode/blob/master/packages/opencode/src/plugin/index.ts)
- [GitHub Issue #42878: V1 plugin format silent failure](https://github.com/anomalyco/opencode/issues/42878)
