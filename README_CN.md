# @ulthon/ul-opencode-event

**远程开发也能收到 OpenCode 通知，随时随地掌握任务状态。**

OpenCode 多通道通知插件，让你在任何地方都能收到 AI 编程助手的状态更新。特别适合远程开发场景 -- 即使不在电脑前，也能第一时间知道任务完成或出错。

## 为什么选择 ul-opencode-event？

- **远程开发友好** -- 桌面通知在你离开时就失效了。本插件通过邮件、钉钉、飞书等渠道发送通知，让你随时掌握 AI 编程助手的任务进度。
- **多渠道支持** -- 目前已支持 SMTP 邮件、钉钉机器人、飞书机器人，后续还将支持 Webhook、Telegram、Slack 等更多渠道。
- **实时提醒** -- 会话完成（`idle`）或出错（`error`）时立即通知，不错过任何关键事件。
- **配置简单** -- JSON 配置文件，支持全局和项目级配置，按通道名称自动合并。

## 开发计划

| 渠道 | 状态 | 说明 |
|------|------|------|
| SMTP (邮件) | 已发布 | 通过任意 SMTP 服务器发送邮件通知 |
| 钉钉 | 已发布 | 钉钉群自定义机器人，支持 Markdown 格式和 @人 |
| 飞书 | 已发布 | 飞书群自定义机器人，支持交互式卡片格式 |
| Webhook | 计划中 | HTTP webhook，支持自定义集成 |
| Telegram | 计划中 | Telegram 机器人通知 |
| Slack | 计划中 | Slack incoming webhooks |
| 企业微信 | 计划中 | 企业微信机器人 |

**想要其他渠道？** 在 [Gitee 仓库](https://gitee.com/augushong/ul-opencode-event) 提 issue 告诉我们！

## 快速开始

```bash
# 1. 全局安装（推荐）
npm install -g @ulthon/ul-opencode-event

# 2. 创建全局配置文件
# Windows: %USERPROFILE%\.config\opencode\ul-opencode-event.json
# macOS/Linux: ~/.config/opencode/ul-opencode-event.json

# 3. 编辑配置，填入 SMTP / 钉钉 / 飞书的相关信息

# 4. 测试连接
ul-opencode-event test

# 5. 启用插件 -- 在 ~/.config/opencode/opencode.json 中添加:
# { "plugin": ["@ulthon/ul-opencode-event"] }
```

## 安装

### 全局安装（推荐）

```bash
npm install -g @ulthon/ul-opencode-event
```

全局安装后，可在任意项目中使用，配置文件统一放在 `~/.config/opencode/ul-opencode-event.json`。

### 项目安装

```bash
npm install @ulthon/ul-opencode-event
```

项目安装后，配置文件放在项目根目录或 `.opencode/` 目录下。

### 启用插件

在 `~/.config/opencode/opencode.json` 中添加：

```json
{
  "plugin": ["@ulthon/ul-opencode-event"]
}
```

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

## CLI 工具

本包内置 CLI 工具，用于测试通知通道配置是否正确。

```bash
# 测试所有通道（验证配置 -> 测试连接 -> 发送测试消息）
ul-opencode-event test

# 测试指定通道
ul-opencode-event test --channel "我的邮箱"

# 仅验证连接，不发送消息
ul-opencode-event test --no-send
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
| [模板配置](./docs/template-configuration.md) | 自定义消息模板、变量说明、多语言支持 |
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

# 本地测试
node dist/cli.js test

# 使用 npm link
npm link
ul-opencode-event test

# 取消链接
npm unlink -g @ulthon/ul-opencode-event
```

## 许可证

MIT
