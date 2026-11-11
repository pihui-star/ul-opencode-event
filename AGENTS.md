# AGENTS.md - @ulthon/ul-opencode-event

## 项目概述

OpenCode 多通道通知插件 (`@ulthon/ul-opencode-event`)。监听 OpenCode 会话事件，通过 SMTP 邮件、钉钉机器人、飞书机器人发送通知。作为 npm 包发布，附带 CLI 测试工具。

**目标运行时：OpenCode 2.x**（v2 插件 API：`@opencode/plugin` + `Plugin.define`）。
v1 插件实现不会在 v2 中运行，因此不兼容 OpenCode 1.x。

## 命令

```bash
npm run build      # tsc -> dist/  (发布前必须执行)
npm run test       # bun test      (使用 Bun 测试运行器，非 Jest/Vitest)
npm run lint       # eslint src
npm run typecheck  # tsc --noEmit
```

**测试运行器是 Bun**，不是 Node.js/Jest。使用 `bun test` 运行测试。

## 架构

```
src/
  index.ts      # 插件入口 - re-export plugin-core（默认导出为 v2 Plugin 定义）
  plugin-core.ts # v2 插件核心：Plugin.define + setup(ctx)，事件订阅/分发、位置过滤、跨进程去重、工具注册
  usage.ts      # 用量读取与聚合：opencode.db(session_v2) 为主，实时事件叠加，产出 会话/总计/项目 三级用量
  event-mapper.ts # v2 事件(event.data) -> 内部 EventPayload
  token-aggregator.ts # 用量快照 -> EventPayload 字段 + 费用格式化
  types.ts      # 所有类型定义（NotificationConfig、Channel、EventPayload、SessionMeta 等）
  config.ts     # 从 JSON 文件加载配置，全局+项目配置合并与校验
  handler.ts    # 多通道事件分发器（延迟创建 sender），使用 formatter 格式化消息
  email.ts      # SMTP 发送器，含 DNS 预解析（适配代理环境）
  dingtalk.ts   # 钉钉机器人发送器 + Markdown 格式化器，Web Crypto HMAC-SHA256 签名
  feishu.ts     # 飞书机器人发送器 + 交互式卡片格式化器，Web Crypto HMAC-SHA256 签名
  formatters.ts # 通道格式化器注册表，按通道类型分发格式化逻辑
  template.ts   # 简单的 {{variable}} 模板渲染
  locales.ts    # i18n 默认模板（zh/en），按事件类型组织
  file.ts       # file 渠道发送器，将通知消息写入本地 JSONL 文件
  recorder.ts   # 系统级事件变量录制器，记录全部模板变量到 JSONL（非渠道，始终开启），约59个字段（含 project* 项目级变量）
  session-cache.ts # 会话级 token 缓存（JSONL），数据库不可用时的兜底数据源，遵循 recorder.ts 的 I/O 模式
  db-preload.ts # SQLite 读取器，从 opencode.db 读取会话用量（v2: session_v2 / session_message）
  logger.ts     # 生产级文件日志，自动轮转，零依赖，同步 I/O
  updater.ts    # 版本检查模块（只读日志，不改动 OpenCode 的插件安装目录）
  cli.ts        # 独立 CLI 工具（npx @ulthon/ul-opencode-event test）
```

入口：
- **库**: `src/index.ts` -> 默认导出 v2 插件定义（`Plugin.define({ id, setup })`），供 OpenCode 插件系统使用
- **CLI**: `src/cli.js`（构建产物）-> `ul-opencode-event test` 命令
- **工具**: `ul-token-rebuild` -> AI 可调用工具（通过 `ctx.tool.transform()` 注册），从 opencode.db 重建 session cache，用于首次同步或恢复

## 关键约定

### 模块系统
- 仅 ESM（`package.json` 中 `"type": "module"`）
- `NodeNext` 模块解析 - import 必须带 `.js` 扩展名（如 `./config.js`）
- `strict: true`，target ES2022

### v2 插件契约（重要）
- 默认导出必须是 `Plugin.define({ id, setup(ctx) })`（`@opencode/plugin`），**不能**再导出 v1 插件函数
- `@opencode/plugin` 必须是 `dependencies`（不是 devDependencies）——OpenCode 安装插件时只装运行时依赖，
  放在 devDependencies 会导致缓存副本里找不到该包，插件直接加载失败
- 事件订阅：`ctx.event.subscribe({ types, signal })` 返回异步迭代器；`setup()` 返回的清理函数负责 `abort()`
- 任务完成信号用 `ctx.session.hook('experimental.idle', cb)`（v2 不再发布 `session.idle` 事件）
- 事件数据在 `event.data`（v1 是 `event.properties`）
- 服务端插件**没有** toast 能力（`ctx.client.tui.showToast` 不存在），提示信息一律写日志

### 多实例与去重（重要）
OpenCode v2 会**为每个 location 创建一个插件实例**，且每个实例都能收到完整事件流。
因此通知前必须做两件事：
1. 事件所属目录 ≠ 实例目录 → 跳过（由该目录的实例负责通知）
2. 事件完全没有 location 信息时 → 用「独占创建标记文件」跨进程去重（`ul-opencode-event-claims/`）

否则同一个事件会被通知 N 次。

### 延迟导入模式（重要）
库代码（`index.ts`、`handler.ts`、`email.ts`）中 **绝不在顶层导入 nodemailer**。通过动态 `import('nodemailer')` 避免 OpenCode 内置的 nodemailer 冲突。**不要在库源文件中添加静态 `import * as nodemailer`。** CLI（`cli.ts`）例外，因为它独立运行。dingtalk.ts 和 feishu.ts 使用 Node.js 内置 fetch 和 Web Crypto API，无外部依赖。

### DNS 预解析
`email.ts` 和 `cli.ts` 都在创建 nodemailer transport 之前，通过 `node:dns/promises.lookup()` 主动解析 DNS。用于处理代理/TUN 环境（Clash、V2Ray）下系统 DNS 返回虚假 IP（198.18.x.x）的问题。修改 SMTP 连接逻辑时，保留此预解析 + 回退链路。

### 配置合并逻辑
配置文件位置（优先级从高到低）：
1. 项目级: `.opencode/ul-opencode-event.json` > `./ul-opencode-event.json`
2. 全局级: `~/.config/opencode/ul-opencode-event.json`

通道按 `name` 字段合并 - 同名时项目配置覆盖全局配置，不同名则追加。顶层字段（`language`、`timezone`、`auto_update`）：项目级优先。

### 事件系统
v2 事件（`session.created`、`session.execution.failed`、`session.status`、`permission.asked`、`form.created`、
`session.shell.ended`、`filesystem.changed`）映射为内部事件类型；任务完成由 `experimental.idle` hook 触发。
事件处理流程：`plugin-core.ts` 收到事件 -> `eventToPayload()` 生成 EventPayload -> 注入用量快照 ->
`handler.ts` 渲染模板 -> 通过 `formatters.ts` 获取通道格式化器 -> 格式化为通道原生消息结构 ->
通过 `ChannelSender.send()` 发送。

### 用量聚合流程
`usage.ts` 读取 `opencode.db`（v2 的 `session_v2` 累计列 + `session_message` assistant 计数），
再用实时事件（`session.usage.updated` / `session.step.ended`）覆盖更新，最后由 `aggregateUsage()` 产出
会话级 / 会话+子代理级 / 项目级三档用量，注入 payload。默认模板 Token 行格式为两行：
`Token(会话/总量/项目)` 接 `Req(会话/总量/项目) 模型名`。

### 通道类型
`smtp`、`dingtalk`、`feishu` 三种通道均已完整实现。每种通道包含：
- **发送器**（Sender）: 实现 `ChannelSender` 接口，负责实际发送（`email.ts`、`dingtalk.ts`、`feishu.ts`）
- **格式化器**（Formatter）: 实现 `ChannelFormatter` 接口，将通用 subject/body 转为通道原生格式（`formatters.ts` 中注册，dingtalk/feishu 的格式化器定义在各自模块中）
- `validateChannelTypes()` 校验通道类型必须在 `SUPPORTED_CHANNEL_TYPES`（smtp、dingtalk、feishu）中

### 日志系统
`logger.ts` 提供全局 `logger` 实例，写文件日志（默认 `~/.local/share/opencode/ul-opencode-event.log`），支持自动轮转（2MB 上限）。通过 `UL_OPENCODE_EVENT_DEBUG=1` 环境变量启用 debug 级别日志。

### Token 聚合层级
用量数据分为三个聚合层级（数据源：数据库 + 实时事件）：

| 层级 | 变量前缀 | 范围 | 聚合位置 |
|------|---------|------|---------|
| 会话 | `session` | 当前会话 | `aggregateUsage().session` |
| 总计 | `total` | 当前会话 + 所有子代理会话 | `aggregateUsage().total`（递归 `collectDescendants()`） |
| 项目 | `project` | 当前项目路径下所有会话 | `aggregateUsage().project`（数据库按 `directory` 过滤） |

项目级聚合使用 `path.normalize()` 比较会话目录与项目目录（Windows 下大小写不敏感）。

### 本地文件
插件运行时在 `~/.local/share/opencode/` 目录下生成以下文件（可通过 `OPENCODE_DATA_DIR` 环境变量覆盖基目录）。
`usage.ts` / `db-preload.ts` 以**只读**方式访问同目录下的 `opencode.db`（OpenCode 主程序维护的 SQLite 数据库，
v2 中会话累计用量在 `session_v2` 表、助手消息在 `session_message` 表）。

| 文件 | 来源模块 | 格式 | 用途 |
|------|---------|------|------|
| `ul-opencode-event.log` | `logger.ts` | 文本日志 | 运行日志、错误追踪、debug 输出（2MB 轮转） |
| `ul-opencode-event-messages.log` | `file.ts` | JSON Lines | 渠道级消息记录：EventPayload + 渲染后的 subject/body（1MB 轮转，自动注入的默认 file 渠道） |
| `ul-opencode-event-variables.jsonl` | `recorder.ts` | JSON Lines | 系统级变量记录：handler.ts 中全部模板变量（约59个字段，含 project* 项目级、人类可读 token 格式等衍生字段），始终开启，不受渠道配置影响（2MB 轮转） |
| `ul-opencode-event-session-cache.jsonl` | `session-cache.ts` | JSON Lines | 会话级用量缓存：已完成会话的累计用量，数据库不可用时作为项目级聚合的兜底数据源。latest-per-session wins 去重，2MB 轮转 |
| `ul-opencode-event-claims/` | `plugin-core.ts` | 标记文件 | 跨进程事件去重标记（1 小时后自动清理） |

调试时可直接用 `tail -f` 监控或 `jq` 筛选 JSONL 文件。

## 测试

- 框架：**Bun test**（`bun:test`）
- 测试文件位置：`tests/` 目录，结构与 src 对应
- Mock 方式：模块级 mock 用 `mock.module()`，函数级 mock 用 `mock()`
- 集成测试：`tests/integration/full-flow.test.ts`（完整 event->handler->email 流程）
- 测试工具：`tests/utils/mock-transport.ts`（nodemailer jsonTransport mock）、`tests/utils/sample-configs.ts`

测试使用动态 `import('../src/config')` 并在 import 前设置 mock，确保模块被 mock 后再求值。

## 构建产物

- `dist/index.js` + `dist/index.d.ts` - 库入口
- `dist/cli.js` - CLI 入口（通过 package.json 的 `bin` 字段）
- `dist/` 已加入 .gitignore

## 发布

- `prepublishOnly` 脚本会自动执行 `npm run build`
- 发布包仅包含 `dist/` 和 `README.md`（由 `package.json` 的 `files` 字段控制）
- 代码仓库：Gitee（非 GitHub）
