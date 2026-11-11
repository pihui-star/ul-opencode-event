# OpenCode 1.x / 2.x 双版本兼容说明

> 状态：已实现（v0.3.0+）
> 适用版本：OpenCode 1.x（>= 1.18.29）与 OpenCode 2.x

## 一、为什么需要双兼容

OpenCode v2 明确说明：

> V1 plugin implementations do not run in V2.

即 v2 不再执行 v1 的插件函数实现。而 v2 的迁移指南同时给出了「一个包同时支持两代」的官方写法：

```ts
export default {
  ...Plugin.define({ id: "example", async setup(ctx) { /* v2 */ } }),
  async server() { /* v1 */ },
}
```

- **v2 加载器**读取默认导出上的 `setup(ctx)`
- **v1 加载器**（1.18.29+）读取默认导出上的 `server(input)`，把它当作 v1 插件工厂

本插件按该方式实现，默认导出同时携带两个入口：

```ts
// src/index.ts
export default {
  ...Plugin.define({ id: PLUGIN_ID, setup: setupPlugin }),
  server: createV1Plugin,
};
```

## 二、两代实现的差异与共用部分

| 能力 | v2 实现 | v1 实现 |
|------|---------|---------|
| 入口 | `Plugin.define({ id, setup })` | `{ id, server }` |
| 事件来源 | `ctx.event.subscribe()` | 返回的 `event` hook |
| 任务完成 | `ctx.session.hook('experimental.idle')` | `session.idle` 事件 |
| 工具 | `ctx.tool.transform()` | 不注册（改用 CLI `npx @ulthon/ul-opencode-event rebuild`） |
| Token 来源 | `opencode.db` + `session.usage.updated` / `session.step.ended` | `message.updated` 事件累积 |
| 项目目录 | `ctx.location.directory` | `ctx.directory` |
| 启动提示 | 无（v2 服务端插件无 toast 能力） | `ctx.client.tui.showToast` |

共用部分（两代完全一致）：

- 通道实现：`email.ts` / `dingtalk.ts` / `feishu.ts` / `file.ts`
- 模板与格式化：`locales.ts` / `template.ts` / `formatters.ts`
- 事件 → 负载映射：`event-mapper.ts`（v1 通过 `v1/v1-event-adapter.ts` 转换后复用）
- 会话缓存与日志：`session-cache.ts` / `logger.ts` / `recorder.ts`

## 三、事件名对照（v1 → v2）

| v1 事件 | v2 事件 | 内部事件类型 |
|---|---|---|
| `session.created` | `session.created` | created |
| `session.idle` | `experimental.idle` hook | idle |
| `session.error` | `session.execution.failed` | error |
| `session.status` | `session.status` | status / idle |
| `question.asked` | `form.created` | question |
| `permission.updated` | `permission.asked` | permission |
| `command.executed` | `session.shell.ended` | command |
| `file.edited` | `filesystem.changed` | fileEdited |
| `todo.updated` | （v2 无此事件） | todo |
| `message.updated` | `session.step.ended` + `session.usage.updated` | ——（仅用于统计） |

## 四、用户侧配置差异

| | OpenCode 1.x | OpenCode 2.x |
|---|---|---|
| 配置键 | `"plugin": [...]` | `"plugins": [...]` |
| 安装命令 | `opencode plugin add <pkg>` | `opencode plugin add <pkg>` |
| 工具 `ul-token-rebuild` | 不可用（用 CLI 替代） | 可用 |

## 五、GitHub 分发

`opencode plugin add` 支持 **npm registry 或 Git 包 specifier**：

```bash
opencode plugin add github:ulthon/ul-opencode-event
```

Git 依赖安装时会执行 `prepare` 脚本完成构建（`dist/` 不入库），因此仓库只需包含源码。

已就绪的自动化：

- `.github/workflows/ci.yml`：push / PR 触发构建、类型检查、Lint、测试
- `.github/workflows/release.yml`：打 `v*` 标签触发 → 构建 → 测试 → 发布 npm → 生成 GitHub Release（含 tgz 附件）
  - npm 发布需要在仓库设置 secret `NPM_TOKEN`

## 六、验证结果

| 检查项 | 结果 |
|---|---|
| `npm run typecheck` / `build` / `lint` | 通过（0 error） |
| `npm test` | 442 通过 / 0 失败 |
| v2 实机（OpenCode 2.2.7） | 插件加载成功，idle 通知正常 |
| v1 单元测试（`tests/v1-plugin.test.ts`） | created / idle / error / question / token 统计全部通过 |
| git 依赖安装链路 | `prepare` 自动构建 `dist/index.js` ✓ |

## 七、相关文件

| 文件 | 用途 |
|---|---|
| `src/index.ts` | 默认导出（v2 `setup` + v1 `server`） |
| `src/plugin-core.ts` | v2 实现 |
| `src/v1/plugin-v1.ts` | v1 实现 |
| `src/v1/v1-event-adapter.ts` | v1 事件 → v2 事件封装转换 |
| `src/v1/token-aggregator-v1.ts` | v1 的按消息 Token 聚合 |
| `src/v1/db-preload-v1.ts` | v1 数据库预载（`message` 表） |
| `docs/opencode-v2-migration.md` | v2 迁移与「无法启用」问题排查记录 |
