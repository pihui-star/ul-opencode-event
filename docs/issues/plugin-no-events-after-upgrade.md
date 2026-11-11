# 已修复：插件加载后收不到 SDK 事件

> ⚠️ **历史文档（OpenCode 1.18 时代）**
> 本插件已迁移到 OpenCode v2 插件 API，事件订阅方式改为 `ctx.event.subscribe()`，
> 下面描述的 `event` hook 与 `~/.cache/opencode/packages/` 缓存路径**仅适用于 OpenCode 1.x**。
> 当前状态见 [../opencode-v2-migration.md](../opencode-v2-migration.md)。

> 状态：已修复（v0.1.59+，开发态已绕过）
> 排查日期：2026-09-22
> 修复日期：2026-09-22
> opencode 版本：1.18.31
> 插件版本：0.1.59

## 现象

用户反馈：飞书通知配置正确（CLI `test` 命令能成功发送），但 opencode 实际运行过程中**完全收不到**任何会话空闲/错误/创建通知。`~/.local/share/opencode/ul-opencode-event.log` 自某次 opencode 升级后**整整两天没有任何新条目**。

## 根因

### 一句话总结

opencode 1.18 在启动时从 `~/.cache/opencode/packages/@ulthon/ul-opencode-event@latest/node_modules/.../dist/` 加载插件（一份由 opencode 自行管理的本地副本），**完全不走 npm 全局链接**。开发模式下修改源码 + `npm run build` 只更新了 npm 链接指向的项目目录，opencode 的 cache 副本仍是旧版本，导致插件 hook 仍然基于旧的 dist 运行——而旧 dist 没有 INFO 级入口日志，导致排查时无法判断事件 hook 是否真的被调用。

### 详细分析

#### 1. opencode 1.18 的插件加载路径

`opencode.json` 声明：
```json
"plugin": ["@ulthon/ul-opencode-event"]
```

opencode 启动后（`packages/opencode/src/plugin/index.ts::PluginLoader`）：

```
Config: plugin = ["@ulthon/ul-opencode-event"]
   ↓
loadExternal(spec)
   ↓
从 ~/.cache/opencode/packages/<scope>/<pkg>@<version>/ 找到/拉取副本
   ↓
import 副本的 dist/index.js
   ↓
applyPlugin() → 调用 event hook
```

**关键点**：opencode 用自己的 cache 目录（`~/.cache/opencode/packages/...`），而不是 npm 全局链接（`~/.nvm4w/nodejs/node_modules/@ulthon/...`）。即便 npm 全局链接已经指向项目源码、即便 `npm run build` 已重建 dist，opencode 实际加载的仍是 cache 副本。

#### 2. 本机环境的实际状态（排查时）

```
C:\nvm4w\nodejs\node_modules\@ulthon\ul-opencode-event\    dist/  2026/9/22 9:36:32 (新)
                                                                ↑ npm 全局链接 → 项目目录
                                                                ↑ CLI 测试走这里，所以 CLI 测试通过

C:\Users\poenr\.cache\opencode\packages\
  @ulthon\ul-opencode-event@latest\node_modules\
  @ulthon\ul-opencode-event\                            dist/  2026/9/19 18:24:39 (旧)
                                                                ↑ opencode 进程实际加载这里
```

**两次 rebuild 都只更新了第一处，第二处纹丝不动。**

#### 3. 排查时为什么误判为"插件未加载"

排查时只看 `~/.local/share/opencode/ul-opencode-event.log`，发现日志自 `2026-09-20T10:35:03` 后再没写入，于是判断"插件未在当前 opencode 进程加载"。

但实际上：
- opencode 启动是正常的（`init count=13`、`loop/process/stream` 日志齐全）
- 插件也加载了（旧 dist）
- 只是旧 dist 没写 INFO 级别日志，导致 hook 即使被调用也无迹可循

### 触发场景

- 用户**首次安装插件**（opencode 自动从 npm 拉取并缓存）
- 后续用户修改插件源码 + `npm run build` + 重启 opencode
- 重启后 opencode 仍从 cache 加载旧版本（除非用户显式触发 opencode 的 "plugin install --force"）

## 修复内容

### 1. 事件入口加 INFO 日志（src/plugin-core.ts）

目的：让 hook 是否被调用变得可见。

```typescript
// src/plugin-core.ts - event hook 入口
event: async ({ event }) => {
  const eventProps = event.properties as Record<string, unknown>;
  const eventInfo = (eventProps as { info?: { id?: string; title?: string } }).info;
  logger.info(`[EVENT] type=${event.type}` +
    (eventInfo?.id ? ` session.id=${eventInfo.id}` : '') +
    (eventProps.sessionID ? ` sessionID=${String(eventProps.sessionID)}` : '') +
    (eventInfo?.title ? ` title="${eventInfo.title}"` : ' title=(empty/missing)'));
  // ...原有 DEBUG 日志保留
}
```

效果：每次 hook 被调用就写一行 `[EVENT] type=xxx`，便于排查事件分发链路。

### 2. status(idle) → idle 事件升级（src/event-mapper.ts）

目的：在某些 opencode 版本/场景下，`session.idle` 事件不被发送，任务完成仅通过 `session.status` 事件中 `statusType: 'idle'` 表达，导致用户配的 `idle: true` 永远收不到通知。

```typescript
// src/event-mapper.ts - session.status 分支
if (rawType === 'session.status') {
  const statusEvent = rawProps as { sessionID?: string; status?: { type?: string } };
  const statusType = statusEvent.status?.type;
  // 升级：status(idle) 等价于任务完成（session.idle），以便让 idle 通道能接住该信号
  const effectiveEventType: EventType = statusType === 'idle' ? 'idle' : 'status';
  const p: EventPayload = {
    ...basePayload,
    eventType: effectiveEventType,
    sessionId: statusEvent.sessionID || '',
    statusType,
    message: effectiveEventType === 'idle' ? 'Task completed successfully' : undefined,
    duration: effectiveEventType === 'idle' && sessionInfo
      ? formatDuration(Date.now() - sessionInfo.time.created)
      : undefined,
    sessionTitle: sessionInfo?.title,
    sessionType: resolveSessionType(sessionInfo),
    parentSessionId: sessionInfo?.parentID ?? undefined,
  };
  fillTokenData(p, ...);
  return p;
}
```

效果：用户的 `idle: true` 配置**无需改动**就能接住通过 status 信号表达的"任务完成"。

### 3. 同步 dist 到 opencode cache（手动步骤）

排查完成后执行：

```powershell
Copy-Item -Path "D:\workspace\ul-opencode-event\dist\*" `
  -Destination "C:\Users\poenr\.cache\opencode\packages\@ulthon\ul-opencode-event@latest\node_modules\@ulthon\ul-opencode-event\dist\" `
  -Recurse -Force
```

然后**完全退出 opencode 进程**（`Ctrl+C`）并重新启动。

## 验证

执行后 `ul-opencode-event.log` 出现新条目：

```
2026-09-22T01:51:54.829Z [INFO] [EVENT] type=integration.updated title=(empty/missing)
2026-09-22T01:51:55.346Z [INFO] [EVENT] type=session.status sessionID=ses_f398c4006ffeaGJHnNX7mnzF1U
2026-09-22T01:51:55.348Z [INFO] Notification sent: status -> default-file (ses_f398c4006ffeaGJHnNX7mnzF1U)
```

opencode 进程产生的实际 SDK 事件类型是 `integration.updated / catalog.updated / session.status / message.part.{updated,delta}`（**不是文档中提到的 `session.created / session.idle`**——这是 opencode 1.18+ 实际使用的命名空间）。这进一步说明 hook 升级阶段才能看到这些事件。

飞书用户在重启后收到 `[xxx] 任务已完成` 通知 ✓。

## 排查时间线

| 时间 | 现象 |
|------|------|
| 2026-09-22 09:00 | 用户反馈飞书通知收不到 |
| 2026-09-22 09:10 | 验证 CLI 测试 OK，飞书凭据有效 |
| 2026-09-22 09:25 | 怀疑 SDK 兼容性，加 INFO 日志 + status→idle 升级 + rebuild |
| 2026-09-22 09:36 | rebuild 完成，但 ul-opencode-event.log 仍无新条目 |
| 2026-09-22 09:45 | 用户重启 opencode，仍无新条目 |
| 2026-09-22 09:49 | 用户再次重启 opencode，仍无新条目 |
| 2026-09-22 09:50 | 比对 npm 全局链接目录 vs OpenCode cache 目录，发现 cache 副本是旧版 |
| 2026-09-22 09:50 | 手动同步 dist 到 OpenCode cache |
| 2026-09-22 09:51 | 用户重启 opencode，日志开始正常写入 ✓ |

## 经验教训

### 开发流程缺陷

插件开发模式下，源码改 → 但 opencode 不感知 npm 全局链接的更新 → 必须**手动同步 dist 到 cache 目录** → 否则用户必须执行 `opencode plugin install --force` 才能让新版本生效。

### 后续改进建议

1. **提供一个 dev 脚本** `scripts/sync-dist-to-cache.ps1`，自动检测并同步 dist 到 opencode cache
2. **或**在 `prepublishOnly` 中增加一步：将 dist 同步到已知 cache 位置
3. **或**改用 `ul-opencode-event-local.mjs` shim 模式（参见 `docs/opencode-1.18-compatibility-fix.md`）—— 之前已经用过类似方案绕过 npm 强制重装问题
4. **或**直接 patch opencode 的插件加载逻辑，使其优先读取 npm 全局链接（不推荐，会污染 opencode 源码）

## 相关文档

- `docs/opencode-1.18-compatibility-fix.md` — 1.18 导出格式兼容性修复（同时期另一个兼容性 bug）
- `docs/issues/token-zero-on-mid-event.md` — 中间事件 token=0 问题