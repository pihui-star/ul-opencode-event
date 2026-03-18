# @ulthon/ul-opencode-event

OpenCode 通知插件 - 当会话事件发生时发送邮件通知。

## 快速开始

```bash
# 1. 全局安装（推荐）
npm install -g @ulthon/ul-opencode-event

# 2. 创建全局配置文件
# Windows: %USERPROFILE%\.config\opencode\ul-opencode-event.json
# macOS/Linux: ~/.config/opencode/ul-opencode-event.json

# 3. 编辑配置，填入你的 SMTP 信息

# 4. 测试连接
ul-opencode-event test

# 5. 添加到 OpenCode 配置
# 在 .opencode/settings.json 中添加:
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

在 `.opencode/settings.json` 中添加：

```json
{
  "plugin": ["@ulthon/ul-opencode-event"]
}
```

## 配置

详细配置说明请参阅 [CONFIG_CN.md](./CONFIG_CN.md)。

### 快速配置

创建配置文件 `~/.config/opencode/ul-opencode-event.json`（全局）或 `./ul-opencode-event.json`（项目）：

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

### 常用 SMTP 服务器

| 服务商 | 主机 | 端口 | 认证方式 |
|--------|------|------|----------|
| QQ 邮箱 | smtp.qq.com | 465 | 授权码 |
| 163 邮箱 | smtp.163.com | 465 | 授权码 |
| Gmail | smtp.gmail.com | 587 | 应用专用密码 |
| Outlook | smtp.office365.com | 587 | 密码 |

> **注意**：QQ/163 邮箱请使用授权码，Gmail 需使用应用专用密码。

## CLI 工具

```bash
# 测试所有通道
ul-opencode-event test

# 测试指定通道
ul-opencode-event test --channel "我的邮箱"

# 仅验证连接，不发送邮件
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

## 故障排除

### SMTP 连接失败

**常见原因：**

1. **密码错误**：QQ/163 使用授权码，Gmail 使用应用专用密码
2. **端口错误**：SSL 用 465，STARTTLS 用 587
3. **防火墙**：确保允许出站连接到 SMTP 端口
4. **IPv6 问题**：如果网络 IPv6 不完整，可强制使用 IPv4

### 调试模式

```bash
UL_OPENCODE_EVENT_DEBUG=1 ul-opencode-event test
```

### 没有发送通知

1. 检查 `enabled: true` 是否设置
2. 检查 `events` 中相应事件是否启用
3. 检查 SMTP 凭据是否正确
4. 确保配置文件在正确位置

## 更多文档

- [配置说明](./CONFIG_CN.md) - 详细的配置选项和示例
- [English README](./README.md)

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
