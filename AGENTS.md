# AGENTS.md - @ulthon/ul-opencode-event

## 项目概述

OpenCode 多通道通知插件 (`@ulthon/ul-opencode-event`)。监听 OpenCode 会话事件，通过 SMTP 邮件、钉钉机器人、飞书机器人发送通知。作为 npm 包发布，附带 CLI 测试工具。

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
  index.ts      # 插件入口 - 导出 NotificationPlugin（默认导出）
  types.ts      # 所有类型定义（NotificationConfig、Channel、EventPayload、ChannelSender、ChannelFormatter 等）
  config.ts     # 从 JSON 文件加载配置，全局+项目配置合并与校验
  handler.ts    # 多通道事件分发器（延迟创建 sender），使用 formatter 格式化消息
  email.ts      # SMTP 发送器，含 DNS 预解析（适配代理环境）
  dingtalk.ts   # 钉钉机器人发送器 + Markdown 格式化器，Web Crypto HMAC-SHA256 签名
  feishu.ts     # 飞书机器人发送器 + 交互式卡片格式化器，Web Crypto HMAC-SHA256 签名
  formatters.ts # 通道格式化器注册表，按通道类型分发格式化逻辑
  template.ts   # 简单的 {{variable}} 模板渲染
  locales.ts    # i18n 默认模板（zh/en），按事件类型组织
  logger.ts     # 生产级文件日志，自动轮转，零依赖，同步 I/O
  updater.ts    # 自动更新模块，检查 npm registry 新版本并可选自动安装
  cli.ts        # 独立 CLI 工具（npx @ulthon/ul-opencode-event test）
```

入口：
- **库**: `src/index.ts` -> 导出 `NotificationPlugin`（默认），供 OpenCode 插件系统使用
- **CLI**: `src/cli.js`（构建产物）-> `ul-opencode-event test` 命令

## 关键约定

### 模块系统
- 仅 ESM（`package.json` 中 `"type": "module"`）
- `NodeNext` 模块解析 - import 必须带 `.js` 扩展名（如 `./config.js`）
- `strict: true`，target ES2022

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
SDK 事件（`session.created`、`session.idle`、`session.error`）映射为内部事件类型。额外事件（`question.asked`、`permission.updated`、`session.status`、`command.executed`、`file.edited`、`todo.updated`）在 `eventToPayload()` 的 `default` 分支中通过运行时类型收窄处理。

事件处理流程：`handler.ts` 接收事件 -> 渲染模板 -> 通过 `formatters.ts` 获取通道格式化器 -> 格式化为通道原生消息结构 -> 通过 `ChannelSender.send()` 发送。

### 通道类型
`smtp`、`dingtalk`、`feishu` 三种通道均已完整实现。每种通道包含：
- **发送器**（Sender）: 实现 `ChannelSender` 接口，负责实际发送（`email.ts`、`dingtalk.ts`、`feishu.ts`）
- **格式化器**（Formatter）: 实现 `ChannelFormatter` 接口，将通用 subject/body 转为通道原生格式（`formatters.ts` 中注册，dingtalk/feishu 的格式化器定义在各自模块中）
- `validateChannelTypes()` 校验通道类型必须在 `SUPPORTED_CHANNEL_TYPES`（smtp、dingtalk、feishu）中

### 日志系统
`logger.ts` 提供全局 `logger` 实例，写文件日志（默认 `~/.local/share/opencode/ul-opencode-event.log`），支持自动轮转（2MB 上限）。通过 `UL_OPENCODE_EVENT_DEBUG=1` 环境变量启用 debug 级别日志。

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
