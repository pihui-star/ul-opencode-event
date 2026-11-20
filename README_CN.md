# @ulthon/ul-opencode-event

**远程开发也能收到 OpenCode 通知 -- 同时精准掌握 Token 用量。**

OpenCode 多通道通知与用量分析插件。通过邮件、钉钉、飞书接收任务完成或错误提醒 -- 每条通知自带多层级 Token 消耗和 API 请求统计数据。

> [!IMPORTANT]
> **维护声明**
>
> 原作者（[@ulthon](https://github.com/ulthon)）**已不再维护本项目**。
> 本仓库由 [@pihuiarch](https://github.com/pihuiarch) 维护，托管在 `pihui-star` 组织下，
> 是版本发布、问题反馈与缺陷修复的**唯一来源**。
>
> - 版本发布与 issue → [github.com/pihui-star/ul-opencode-event](https://github.com/pihui-star/ul-opencode-event)
> - 原仓库（只读存档）→ [gitee.com/ulthon/ul-opencode-event](https://gitee.com/ulthon/ul-opencode-event)
>
> 请从本仓库安装 —— npm 上的 `@ulthon/ul-opencode-event` 仍由原作者发布，**不包含**下文所述的 OpenCode 2.x 适配。

## 为什么它是日常工作的一部分

一次 AI 编程任务往往不是十几秒能完成的：跨 20 个文件的重构、跑不通的 CI、几百个生成文件的批量迁移 —— 你把任务交给它，切到别的窗口，十分钟后再回来，才知道它**是完成了、失败了，还是正等着你回答**。而终端里只剩一条长输出流的最后一行，Token 计数要么根本不显示，要么淹没在 TUI 界面里。

这个插件消除的就是这份日常摩擦：

- **你离开终端，终端也会告诉你。** 任务完成、任务失败、AI 反问、等待确认权限 —— 每一件事都直接发到飞书 / 钉钉 / 邮件，而不是留在一个你已经关掉的窗口里。
- **不用再猜这次任务花了多少钱。** 每条通知都带上本次会话的 Token、缓存命中率、请求次数和费用估算，且区分会话 / 总计 / 项目三个层级。
- **留下可追溯的记录。** 通知内容同步落成本地 JSONL 文件，一天的工作可以用 `jq` 直接检索，而不是只存在于终端回滚里。

它不是演示性质的玩具通道，而是让「长时间运行、无人值守」的 OpenCode 在正常工作流里真正可用的那一块拼图。

## 为什么必须做 OpenCode 的适配改造

OpenCode 2 重写了插件 API：1.x 的插件契约不再被运行，而且失败方式是**静默**的 —— 加载器直接丢弃插件，控制台不给有效提示，结果就是通知从此消失：

```
failed to load plugin target=@ulthon/ul-opencode-event
  cause="Cannot find package '@opencode-ai/plugin' ..."
```

| OpenCode 2 的变化 | 对 1.x 插件的影响 |
|---|---|
| 插件入口 | `export default function` → `Plugin.define({ id, setup })` |
| SDK 包 | `@opencode-ai/plugin` → `@opencode/plugin`，且必须是**运行时依赖**，否则安装后的副本解析不到它 |
| 事件订阅 | `event` hook → `ctx.event.subscribe()` |
| 任务完成 | `session.idle` 事件 → `ctx.session.hook('experimental.idle')`（v2 不再发布 idle 事件） |
| 事件数据 | `event.properties` → `event.data` |
| 自定义工具 | `tool()` + zod → `ctx.tool.transform()` + JSON Schema |
| 会话错误 | `session.error` → `session.execution.failed` |
| 配置键 | `plugin` → `plugins` |

本插件已完成 v2 适配；又因为只支持 v2 就等于放弃全部 1.x 用户，所以**在同一套代码之上又补了一层 v1 兼容**。一个包，两个入口：

```ts
export default {
  ...Plugin.define({ id: PLUGIN_ID, setup: setupPlugin }),  // OpenCode 2.x
  server: createV1Plugin,                                  // OpenCode 1.x
}
```

两条路径共用同一套通道实现、模板、格式化器与事件映射，因此在任何版本上收到的通知内容与行为完全一致。详见 [OpenCode 1.x / 2.x 双版本兼容](docs/opencode-v1-v2-compat.md) · [v2 迁移记录](docs/opencode-v2-migration.md)

## 为什么选择 ul-opencode-event？

- **多通道通知** -- 支持 SMTP 邮件、钉钉机器人、飞书机器人，后续将支持 Webhook、Telegram、Slack 等更多渠道。
- **Token 用量统计** -- 在消息 / 会话 / 总计 / 项目四个层级追踪 Token 消耗和 API 请求次数，随时掌握用量。
- **远程开发友好** -- 桌面通知在你离开时就失效了。本插件通过邮件、钉钉、飞书等渠道发送通知，让你随时掌握 AI 编程助手的任务进度。
- **实时提醒** -- 会话完成（`idle`）、出错（`error`）、AI 提问（`question`）、权限确认（`permission`）等关键事件即时通知。
- **一个包兼容两个 OpenCode 大版本** -- 采用 v2 插件 API 并内置 v1 回退，不会在版本升级后突然失效。
- **丰富模板变量** -- 74+ 个变量，涵盖 Token 统计、缓存命中率、系统信息等，支持中英文双语模板。
- **配置简单** -- JSON 配置文件，支持全局和项目级配置，按通道名称自动合并。

## 开发计划

| 渠道 | 状态 | 说明 |
|------|------|------|
| SMTP (邮件) | 已发布 | 通过任意 SMTP 服务器发送邮件通知 |
| 钉钉 | 已发布 | 钉钉群自定义机器人，支持 Markdown 格式和 @人 |
| 飞书 | 已发布 | 飞书群自定义机器人，支持交互式卡片格式 |
| 文件 (File) | 已发布（自动） | 本地 JSONL 文件，默认自动注入，无需配置 |
| Webhook | 计划中 | HTTP webhook，支持自定义集成 |
| Telegram | 计划中 | Telegram 机器人通知 |
| Slack | 计划中 | Slack incoming webhooks |
| 企业微信 | 计划中 | 企业微信机器人 |

**想要其他渠道？** 在 [GitHub 仓库](https://github.com/pihui-star/ul-opencode-event)（或 [Gitee 镜像](https://gitee.com/ulthon/ul-opencode-event)）提 issue 告诉我们！

## Token 用量统计

每条通知都自动包含详细的用量数据，无需额外配置。

| 指标 | 统计范围 | 示例变量 |
|------|---------|---------|
| Token 数量 | 会话 / 总计 / 项目 | `{{sessionTokens}}`、`{{totalTokens}}`、`{{projectTokens}}` |
| 缓存命中率 | 会话 / 总计 / 项目 | `{{sessionCacheHitRate}}`、`{{totalCacheHitRate}}`、`{{projectCacheHitRate}}` |
| API 请求次数 | 会话 / 总计 / 项目 | `{{sessionRequestCount}}`、`{{totalRequestCount}}`、`{{projectRequestCount}}` |
| 模型名称 | 每条消息 | `{{modelName}}` |
| 费用估算 | 每会话 | `{{sessionCost}}`、`{{totalCost}}` |

数据通过 `opencode.db`（OpenCode 数据库）与 JSONL 会话缓存实现跨重启持久化。

> 完整变量列表（74+ 个变量）：见[模板变量文档](docs/configuration.md#8-模板变量)

## 环境要求

同一份插件同时支持 **OpenCode 1.x（>= 1.18.29）与 2.x**：

| OpenCode | 使用的入口 | 配置键 |
|----------|------------|--------|
| 2.x | `Plugin.define({ id, setup })` | `plugins` |
| 1.x | `{ id, server }` | `plugin` |

## 快速开始

```bash
# 1. 启用插件（见下方安装方式）

# 2. 创建配置文件
# Windows: %USERPROFILE%\.config\opencode\ul-opencode-event.json
# macOS/Linux: ~/.config/opencode/ul-opencode-event.json

# 3. 编辑配置，填入 SMTP / 钉钉 / 飞书的相关信息

# 4. 测试连接（npx 会自动拉取已安装的版本）
npx @ulthon/ul-opencode-event test
```

## 安装

### 通过 OpenCode 插件配置安装（推荐）

插件由 OpenCode 自动管理安装和更新，无需手动安装：

```bash
opencode plugin add @ulthon/ul-opencode-event
```

然后在 `~/.config/opencode/opencode.json` 中添加（**注意两代 OpenCode 的配置键不同**）：

```json
// OpenCode 2.x
{
  "plugins": ["@ulthon/ul-opencode-event"]
}
// OpenCode 1.x
{
  "plugin": ["@ulthon/ul-opencode-event"]
}
```

后续版本由 OpenCode 的自动更新机制维护（`opencode plugin update`）。

### 从 GitHub 安装

```bash
opencode plugin add github:pihui-star/ul-opencode-event
```

安装时会自动 clone 并执行 `prepare` 脚本完成构建，配置写法同上：

```json
// OpenCode 2.x
{
  "plugins": ["github:pihui-star/ul-opencode-event"]
}
```

### 从本地源码安装

```bash
git clone https://github.com/pihui-star/ul-opencode-event
cd ul-opencode-event && npm install && npm run build
```

```json
// OpenCode 2.x
{
  "plugins": ["file:///absolute/path/to/ul-opencode-event"]
}
```

### 使用发布包（离线 / 内网）

```bash
npm install -g https://github.com/pihui-star/ul-opencode-event/releases/download/v0.3.0/ulthon-ul-opencode-event-0.3.0.tgz
```

> **不要全局安装**（`npm install -g`）。全局安装的副本不会被 OpenCode 加载，也不会被自动更新，纯属浪费。

### 启用插件

见上方，在 `~/.config/opencode/opencode.json` 的 `plugins` 数组中添加包名即可。

## 配置

插件按以下顺序查找配置文件（优先级从高到低）：

1. **项目级**: `.opencode/ul-opencode-event.json` 或 `./ul-opencode-event.json`
2. **全局级**: `~/.config/opencode/ul-opencode-event.json`

项目级配置会覆盖全局配置，通道按 `name` 字段合并。

### 最小配置示例

创建 `~/.config/opencode/ul-opencode-event.json`（全局）或 `./ul-opencode-event.json`（项目）：

```json
{
  "channels": [
    {
      "type": "smtp",
      "enabled": true,
      "name": "我的邮箱",
      "config": {
        "host": "smtp.qq.com",
        "port": 465,
        "secure": true,
        "auth": {
          "user": "your@qq.com",
          "pass": "授权码"
        }
      },
      "recipients": ["receiver@example.com"],
      "events": {
        "idle": true,
        "error": true
      }
    }
  ]
}
```

详细的配置说明（钉钉、飞书通道、自定义模板等），请参阅下方「更多文档」中的各通道配置指南。

### 常用 SMTP 服务器

| 服务商 | 主机 | 端口 | 认证方式 |
|--------|------|------|----------|
| QQ 邮箱 | smtp.qq.com | 465 | 授权码 |
| 163 邮箱 | smtp.163.com | 465 | 授权码 |
| Gmail | smtp.gmail.com | 587 | 应用专用密码 |
| Outlook | smtp.office365.com | 587 | 密码 |

> **注意**: QQ/163 邮箱请使用授权码（非登录密码），Gmail 需使用应用专用密码。

### 事件配置

| 事件 | 默认值 | 说明 |
|------|--------|------|
| `created` | false | 新会话创建时触发 |
| `idle` | true | 会话完成时触发（AI 完成响应） |
| `error` | true | 会话出错时触发 |
| `question` | true | AI 提问时触发 |
| `permission` | true | 需要权限确认时触发 |
| `status` | false | 会话状态变更时触发 |
| `command` | false | 命令执行时触发 |
| `fileEdited` | false | 文件编辑时触发 |
| `todo` | false | Todo 列表更新时触发 |

## CLI 工具

本包内置 CLI 工具，用于测试通知通道配置是否正确。

```bash
# 测试所有通道（验证配置 -> 测试连接 -> 发送测试消息）
npx @ulthon/ul-opencode-event test

# 测试指定通道
npx @ulthon/ul-opencode-event test --channel "我的邮箱"

# 仅验证连接，不发送消息
npx @ulthon/ul-opencode-event test --no-send
```

### 测试输出示例

```
[ul-opencode-event-cli] Starting channel test...
[ul-opencode-event-cli] Loaded config: ~/.config/opencode/ul-opencode-event.json

[ul-opencode-event-cli] Testing channel: "我的邮箱"
  [1/3] Validating configuration...
  [OK] Configuration is valid

  [2/3] Testing SMTP connection to smtp.qq.com:465...
  [OK] Connection successful

  [3/3] Sending test email...
  [OK] Test email sent successfully

  [SUCCESS] Channel "我的邮箱" passed all tests
```

## 更多文档

| 文档 | 说明 |
|------|------|
| [配置文件位置与合并规则](./docs/configuration.md) | 配置文件查找路径、合并逻辑、优先级说明 |
| [SMTP 邮箱通道配置](./docs/channels/smtp-channel.md) | SMTP 完整配置字段、IPv4/IPv6 控制 |
| [钉钉通道配置](./docs/channels/dingtalk-channel.md) | 钉钉机器人 Webhook、加签、@人功能 |
| [飞书通道配置](./docs/channels/feishu-channel.md) | 飞书机器人 Webhook、签名校验、卡片格式 |
| [文件通道配置](./docs/channels/file-channel.md) | JSONL 输出、自动注入、文件轮转 |
| [模板配置](./docs/configuration.md#4-模板系统概述) | 自定义消息模板、变量说明、多语言支持 |
| [通知渠道开发指南](./docs/channels/channel-development.md) | 如何开发自定义通知渠道 |

## 故障排除

- **SMTP 连接失败**: 检查密码（QQ/163 用授权码，Gmail 用应用专用密码）、端口（SSL 用 465，STARTTLS 用 587）、防火墙是否放行。
- **钉钉签名失败**: 确认 `secret` 值与钉钉后台一致（注意前后空格），服务器时间偏差不超过 1 小时。
- **飞书签名失败**: 同上，确认 `secret` 值正确，网络能正常访问 `open.feishu.cn`。
- **没有收到通知**: 检查 `enabled: true` 是否设置、事件类型是否启用、配置文件是否在正确位置。
- **开启调试模式**: 设置环境变量 `UL_OPENCODE_EVENT_DEBUG=1` 后运行测试命令，查看详细日志。

## 本地开发

```bash
# 构建
npm run build

# 本地测试 CLI
node dist/cli.js test
```

## 许可证

MIT
