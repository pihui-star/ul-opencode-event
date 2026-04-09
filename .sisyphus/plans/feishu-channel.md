# 飞书通道实现计划

## TL;DR

> **快速摘要**: 为 `@ulthon/ul-opencode-event` 插件添加飞书自定义机器人 Webhook 通知通道，完全参照钉钉通道的实现模式，同时生成用户配置文档。
> 
> **交付物**:
> - `src/feishu.ts` - 飞书发送器 + 格式化器
> - `tests/feishu.test.ts` - 完整单元测试
> - `docs/feishu-channel.md` - 用户配置 + 内部实现文档
> - 更新 types.ts、formatters.ts、handler.ts、config.ts、cli.ts、README.md
> 
> **预估工作量**: Medium
> **并行执行**: YES - 2 waves
> **关键路径**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> F1-F4

---

## Context

### Original Request
用户要求实现飞书通道功能开发，并生成飞书的配置文档。要求参考 docs 下的文档格式。

### Interview Summary
**Key Discussions**:
- 飞书有自定义机器人 Webhook，与钉钉几乎完全对等
- 无需创建应用、无需管理员审核，群设置里添加即可
- 签名算法与钉钉不同：飞书将 timestamp+sign 放在 JSON body 中（钉钉放在 URL 参数中）
- HMAC 的 key 和 message 参数位置也与钉钉不同

**Research Findings**:
- 飞书 Webhook URL: `https://open.feishu.cn/open-apis/bot/v2/hook/xxx`
- 签名算法：HMAC-SHA256，key = `timestamp + "\n" + secret`，message = 空字符串（与钉钉不同！钉钉的 key 是 secret，message 是 timestamp+"\n"+secret）
- 消息类型：text（纯文本）、post（富文本）、interactive（飞书卡片，支持 lark_md）
- 选用 interactive 卡片作为主要格式（功能类似钉钉 Markdown）
- 无需外部依赖（Web Crypto API + fetch 均为内置）

### Metis Review
**Identified Gaps** (addressed):
- 签名算法差异：飞书 HMAC key 是 `timestamp+"\n"+secret`（钉钉是 `secret`），message 是空字符串（钉钉是 `timestamp+"\n"+secret`）。已在 Task 2 中明确标注
- 飞书 API 错误码格式：返回 `{"code": 0, "msg": "success"}`（钉钉是 `{"errcode": 0, "errmsg": "ok"}`），已在 Task 2 中处理

---

## Work Objectives

### Core Objective
实现飞书自定义机器人 Webhook 通知通道，使插件能够通过飞书群机器人发送 OpenCode 事件通知，并附带完整的用户配置文档。

### Concrete Deliverables
- `src/feishu.ts` - 飞书通道发送器和格式化器实现
- `tests/feishu.test.ts` - 单元测试（签名、格式化、发送）
- `docs/feishu-channel.md` - 配置文档（用户指南 + 内部实现）
- 更新 6 个现有文件：types.ts、formatters.ts、handler.ts、config.ts、cli.ts、README.md

### Definition of Done
- [ ] `bun test` 全部通过（含新增 feishu 测试）
- [ ] `npm run typecheck` 无错误
- [ ] `npm run lint` 无错误
- [ ] `npm run build` 成功
- [ ] docs/feishu-channel.md 内容完整，结构与 dingtalk-channel.md 一致

### Must Have
- 飞书自定义机器人 Webhook 发送能力
- HMAC-SHA256 签名支持（可选 secret）
- Interactive 卡片消息格式（lark_md）
- CLI 测试工具支持（validate + testConnection + sendTestMessage）
- 完整单元测试
- 用户配置文档

### Must NOT Have (Guardrails)
- 不使用飞书 App Bot 或开放平台 API（仅 Webhook）
- 不添加外部依赖（仅使用 Web Crypto API + fetch）
- 不复制 DNS 预解析逻辑（HTTP 渠道不需要，参考 channel-development.md 陷阱 2）
- 不在库代码中静态 import feishu 模块（必须动态 import，参考 handler.ts 模式）
- 不实现 text/post 消息类型（仅 interactive 卡片）
- 不修改 locales.ts（飞书复用现有模板，formatter 负责格式转换）
- 不修改 template.ts 或 handler.ts 的核心逻辑（仅添加 else if 分支）
- 不引入任何 AI slop（过度抽象、冗余注释、不必要的工具函数）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test
- **Test pattern**: Follow `tests/dingtalk.test.ts` exactly

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun test) - Run tests, check pass/fail
- **CLI**: Use Bash - Run CLI commands, validate output
- **Docs**: Use Bash - Verify file exists and contains expected sections

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - types + core implementation):
+-- Task 1: Update FeishuConfig in types.ts [quick]
+-- Task 2: Create src/feishu.ts with sender + formatter [deep]

Wave 2 (After Wave 1 - integration + tests + docs):
+-- Task 3: Register feishu in formatters.ts + handler.ts + config.ts (depends: 1, 2) [quick]
+-- Task 4: CLI support for feishu in cli.ts (depends: 2) [unspecified-high]
+-- Task 5: Unit tests tests/feishu.test.ts (depends: 2) [unspecified-high]
+-- Task 6: Update README.md with Feishu section (depends: 1) [quick]

Wave 3 (After Wave 2 - documentation):
+-- Task 7: Create docs/feishu-channel.md (depends: 1, 2, 3, 4) [writing]
+-- Task 8: Update docs/channel-development.md and docs/template-configuration.md (depends: 7) [quick]

Wave FINAL (After ALL tasks - 4 parallel reviews, then user okay):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 -> Task 2 -> Task 3 -> Task 5 -> Task 7 -> F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2, 3, 6, 7 | 1 |
| 2 | 1 | 3, 4, 5, 7 | 1 |
| 3 | 1, 2 | 7 | 2 |
| 4 | 2 | 7 | 2 |
| 5 | 2 | F1-F4 | 2 |
| 6 | 1 | - | 2 |
| 7 | 1, 2, 3, 4 | 8 | 3 |
| 8 | 7 | F1-F4 | 3 |
| F1-F4 | 5, 8 | user okay | FINAL |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks - T1 -> `quick`, T2 -> `deep`
- **Wave 2**: 4 tasks - T3 -> `quick`, T4 -> `unspecified-high`, T5 -> `unspecified-high`, T6 -> `quick`
- **Wave 3**: 2 tasks - T7 -> `writing`, T8 -> `quick`
- **FINAL**: 4 tasks - F1 -> `oracle`, F2 -> `unspecified-high`, F3 -> `unspecified-high`, F4 -> `deep`

---

## TODOs

- [x] 1. 更新 FeishuConfig 类型定义

  **What to do**:
  - 在 `src/types.ts` 中更新 `FeishuConfig` 接口，添加 `secret?: string` 字段
  - 当前 `FeishuConfig` 只有 `webhook: string`，需要补充签名字段
  - 确保 `FeishuConfig` 与 `DingtalkConfig` 保持平级结构

  **Must NOT do**:
  - 不修改 ChannelType 联合类型（已有 'feishu'）
  - 不修改 ChannelConfig 联合类型（已有 FeishuConfig）
  - 不添加 at、recipients 等飞书不支持的字段（飞书自定义机器人无 @人功能）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件简单类型修改，2-3 行代码
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 1 基础)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 2, 3, 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/types.ts:82-86` - 现有 FeishuConfig 接口（只有 webhook 字段）
  - `src/types.ts:88-100` - DingtalkConfig 接口结构作为参考

  **WHY Each Reference Matters**:
  - `FeishuConfig` 当前只有一个 webhook 字段，需要参照 DingtalkConfig 添加 secret 可选字段
  - DingtalkConfig 展示了完整的通道配置接口模式（webhook + secret + 特有字段）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: FeishuConfig 类型检查通过
    Tool: Bash
    Preconditions: types.ts 已修改
    Steps:
      1. 运行 `npm run typecheck`
      2. 检查输出无错误
    Expected Result: tsc --noEmit 退出码 0，无类型错误
    Failure Indicators: 退出码非 0，或输出包含 "error TS"
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: FeishuConfig 包含 secret 可选字段
    Tool: Bash
    Preconditions: types.ts 已修改
    Steps:
      1. 运行 `grep -n "secret" src/types.ts` 检查 FeishuConfig 中有 secret 字段
      2. 确认字段类型为 `string` 且可选（`?`）
    Expected Result: FeishuConfig 接口中包含 `secret?: string` 行
    Failure Indicators: FeishuConfig 中无 secret 字段，或字段类型不正确
    Evidence: .sisyphus/evidence/task-1-feishuconfig-check.txt
  ```

  **Commit**: YES
  - Message: `feat(types): 添加飞书通道配置字段 secret`
  - Files: `src/types.ts`
  - Pre-commit: `npm run typecheck`

- [x] 2. 创建 src/feishu.ts 发送器和格式化器

  **What to do**:
  - 创建 `src/feishu.ts`，实现 `generateFeishuSign()`、`createFeishuFormatter()`、`createFeishuSender()`
  - 导入 `Channel, ChannelSender, ChannelFormatter, FormattedMessage, FeishuConfig` from `./types.js`
  - 导入 `logger, DEBUG_ENABLED` from `./logger.js`

  **签名函数 `generateFeishuSign(secret, timestamp)`**:
  - 注意：飞书签名算法与钉钉不同！
    - 钉钉：HMAC-SHA256(key=secret, message=timestamp+"\n"+secret)
    - 飞书：HMAC-SHA256(key=timestamp+"\n"+secret, message=空字符串)
  - 使用 Web Crypto API（与 dingtalk.ts 相同的 crypto.subtle 模式）
  - 返回 Base64 编码的签名

  **格式化器 `createFeishuFormatter(config: FeishuConfig)`**:
  - 返回 interactive 卡片消息格式：
    ```json
    {
      "msg_type": "interactive",
      "card": {
        "config": { "wide_screen_mode": true },
        "header": {
          "title": { "tag": "plain_text", "content": "subject内容" },
          "template": "blue"  // 默认蓝色，error 事件用 red
        },
        "elements": [
          {
            "tag": "div",
            "text": { "tag": "lark_md", "content": "格式化后的body内容" }
          }
        ]
      }
    }
    ```
  - Subject 处理：截断至 100 字符，作为 card header title
  - Body 处理：使用 lark_md 格式（飞书 Markdown），key:value 行自动加粗（**key**: value）
  - 不需要钉钉的 17 字符转义（飞书 lark_md 是标准 Markdown 子集，支持更好）
  - 错误内容行用 ``` 代码块包裹（参考钉钉的 ERROR_INDICATORS 模式）
  - 截断：text 内容最大 4000 字符

  **发送器 `createFeishuSender(channel: Channel)`**:
  - 校验 channel.type === 'feishu'、enabled !== false、webhook 存在且为 http/https
  - `send(message)`: POST JSON 到 webhook URL
    - 如果有 secret，在 JSON body 中添加 timestamp 和 sign 字段（注意：飞书放在 body 中，钉钉放在 URL 中！）
    - timestamp 使用秒级时间戳（Math.floor(Date.now() / 1000)），钉钉使用毫秒级
    - 使用 AbortController 10 秒超时
  - 错误处理：静默失败，使用 logger.error 记录
  - `close()`: 空操作（HTTP 无持久连接）
  - 响应解析：飞书返回 `{"code": 0, "msg": "success"}`（注意不是钉钉的 errcode/errmsg）

  **Must NOT do**:
  - 不添加外部依赖（不 import node:crypto，使用 Web Crypto API）
  - 不实现 DNS 预解析
  - 不在顶层 import 重模块
  - 不实现 text 或 post 消息类型（仅 interactive）
  - 不复制钉钉的 17 字符转义逻辑（飞书 lark_md 不需要）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心业务逻辑实现，签名算法有关键差异需要正确处理
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (依赖 Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3, 4, 5, 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/dingtalk.ts:1-262` - 完整的钉钉实现，作为代码结构模板（签名函数、格式化器工厂、发送器工厂）
  - `src/dingtalk.ts:25-48` - generateSign 函数的 Web Crypto API 用法
  - `src/dingtalk.ts:90-149` - createDingTalkFormatter 的 Markdown 格式化逻辑（key:value 加粗、错误代码块、截断）
  - `src/dingtalk.ts:167-262` - createDingTalkSender 的完整发送器模式（校验、签名、HTTP POST、错误处理）
  - `src/dingtalk.ts:53-60` - ESCAPE_CHARS_REGEX 和 escapeMarkdown 函数（飞书不需要这个）
  - `src/dingtalk.ts:192-261` - send 方法的完整实现（AbortController 超时、响应解析、静默失败模式）

  **API/Type References**:
  - `src/types.ts:83-86` - FeishuConfig 接口（Task 1 更新后包含 secret 字段）
  - `src/types.ts:176-180` - ChannelSender 接口定义
  - `src/types.ts:192-194` - ChannelFormatter 接口定义

  **Test References**:
  - `tests/dingtalk.test.ts:1-573` - 完整的钉钉测试用例结构（签名测试、格式化测试、发送器测试、mock fetch 模式）

  **External References**:
  - 飞书自定义机器人文档: `https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot`
  - 飞书签名算法: key = timestamp + "\n" + secret, message = "" (空字符串), HMAC-SHA256, Base64 编码
  - 飞书响应格式: `{"code": 0, "msg": "success"}` (不是 errcode/errmsg)
  - 飞书 timestamp 单位: 秒（Math.floor(Date.now() / 1000)），不是毫秒

  **WHY Each Reference Matters**:
  - `dingtalk.ts` 全文是代码模板，复制结构，替换飞书特有逻辑
  - 签名函数参考 Web Crypto API 用法，但 key/message 参数完全不同
  - 格式化器参考 key:value 加粗和错误代码块模式，但飞书用 lark_md 不需要字符转义
  - 发送器参考完整 HTTP POST 模式（AbortController、静默失败、logger 调用）
  - 测试参考 mock fetch 模式和 beforeAll 动态导入模式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: feishu.ts 类型检查通过
    Tool: Bash
    Preconditions: feishu.ts 已创建
    Steps:
      1. 运行 `npm run typecheck`
      2. 检查输出无错误
    Expected Result: tsc --noEmit 退出码 0
    Failure Indicators: 退出码非 0，类型错误
    Evidence: .sisyphus/evidence/task-2-typecheck.txt

  Scenario: generateFeishuSign 签名输出验证
    Tool: Bash
    Preconditions: feishu.ts 已创建
    Steps:
      1. 运行 `bun -e "import('./src/feishu.js').then(m => m.generateFeishuSign('test_secret', '1704067200').then(s => console.log(s)))"`
      2. 检查输出是非空 Base64 字符串
    Expected Result: 输出匹配 /^[A-Za-z0-9+/=]+$/
    Failure Indicators: 空输出或非 Base64 字符
    Evidence: .sisyphus/evidence/task-2-sign-output.txt

  Scenario: 飞书签名算法正确性（与钉钉对比）
    Tool: Bash
    Preconditions: feishu.ts 已创建
    Steps:
      1. 使用相同参数调用飞书签名和钉钉签名
      2. 验证输出不同（因为 key/message 参数位置不同）
    Expected Result: 两个签名函数对相同输入产生不同输出
    Failure Indicators: 输出相同（说明飞书签名实现错误地复制了钉钉逻辑）
    Evidence: .sisyphus/evidence/task-2-sign-diff.txt

  Scenario: createFeishuSender 对无效配置返回 null
    Tool: Bash
    Preconditions: feishu.ts 已创建
    Steps:
      1. 运行 `bun -e "import('./src/feishu.js').then(m => m.createFeishuSender({type:'smtp',enabled:true,config:{host:'x',port:465,secure:true,auth:{user:'x',pass:'x'}},events:{}}).then(s => console.log(s)))"`
      2. 检查输出为 null
    Expected Result: 输出 "null"
    Failure Indicators: 非 null 返回值
    Evidence: .sisyphus/evidence/task-2-sender-null.txt

  Scenario: 飞书 formatter 输出 interactive 卡片格式
    Tool: Bash
    Preconditions: feishu.ts 已创建
    Steps:
      1. 运行 bun -e 调用 createFeishuFormatter().format("Test Subject", "Key: Value", payload)
      2. 检查输出 JSON 包含 msg_type: "interactive", card.header, card.elements
    Expected Result: JSON 包含 msg_type="interactive" 和 card 结构
    Failure Indicators: 缺少 msg_type 或 card 字段
    Evidence: .sisyphus/evidence/task-2-formatter-output.txt
  ```

  **Commit**: YES
  - Message: `feat(feishu): 实现飞书 Webhook 发送器和格式化器`
  - Files: `src/feishu.ts`
  - Pre-commit: `npm run typecheck`

- [x] 3. 注册飞书通道到分发器和配置系统

  **What to do**:
  - **formatters.ts**: 添加 `import { createFeishuFormatter } from './feishu.js'`，在 `getFormatter()` 中添加 feishu 分支，添加 re-export
  - **handler.ts**: 在延迟初始化块中添加 `else if (channel.type === 'feishu' && channel.enabled !== false)` 分支，使用 `await import('./feishu.js')` 动态导入
  - **config.ts**: 在 `SUPPORTED_CHANNEL_TYPES` 数组中添加 `'feishu'`（当前只有 `['smtp', 'dingtalk']`）

  **Must NOT do**:
  - 不使用静态 import（handler.ts 中必须动态 import）
  - 不修改 handler.ts 的核心逻辑（仅添加 else if 分支）
  - 不修改 config.ts 的合并逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 3 个文件各加 2-5 行代码，简单的注册操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (依赖 Task 1 和 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Task 1, Task 2

  **References**:

  **Pattern References**:
  - `src/formatters.ts:46-52` - getFormatter() 中 dingtalk 分支的注册模式
  - `src/formatters.ts:54-56` - re-export 行
  - `src/handler.ts:53-79` - 延迟初始化块中 smtp 和 dingtalk 的分支模式
  - `src/config.ts:8` - SUPPORTED_CHANNEL_TYPES 数组

  **API/Type References**:
  - `src/types.ts:53` - ChannelType 联合类型（已包含 'feishu'）

  **Test References**:
  - `tests/handler.test.ts` - handler 集成测试

  **WHY Each Reference Matters**:
  - formatters.ts 展示了注册 formatter 的完整模式（import + if 分支 + re-export）
  - handler.ts 展示了动态 import 的延迟初始化模式，必须复制此模式
  - config.ts 的 SUPPORTED_CHANNEL_TYPES 控制哪些通道类型被允许，必须添加

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 飞书通道类型通过配置校验
    Tool: Bash
    Preconditions: config.ts 已更新
    Steps:
      1. 运行 `grep "feishu" src/config.ts`
      2. 确认 SUPPORTED_CHANNEL_TYPES 包含 'feishu'
    Expected Result: grep 输出包含 "feishu"
    Failure Indicators: 未找到 feishu
    Evidence: .sisyphus/evidence/task-3-config-check.txt

  Scenario: formatter 注册成功
    Tool: Bash
    Preconditions: formatters.ts 已更新
    Steps:
      1. 运行 `npm run typecheck`
      2. 运行 `bun -e "import('./src/formatters.js').then(m => console.log(m.getFormatter('feishu', {type:'feishu',config:{webhook:'https://open.feishu.cn/open-apis/bot/v2/hook/test'},events:{}})))"`
    Expected Result: getFormatter('feishu', ...) 返回非 null 的 formatter 对象
    Failure Indicators: 返回 null 或类型错误
    Evidence: .sisyphus/evidence/task-3-formatter-check.txt

  Scenario: 类型检查通过
    Tool: Bash
    Preconditions: 所有文件已更新
    Steps:
      1. 运行 `npm run typecheck`
    Expected Result: 退出码 0
    Failure Indicators: 类型错误
    Evidence: .sisyphus/evidence/task-3-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(feishu): 注册飞书通道到分发器和配置系统`
  - Files: `src/formatters.ts`, `src/handler.ts`, `src/config.ts`
  - Pre-commit: `npm run typecheck`

- [x] 4. CLI 测试工具添加飞书支持

  **What to do**:
  - 在 `src/cli.ts` 中添加飞书通道的 CLI 测试支持
  - **validateChannel()**: 添加 feishu 分支（校验 webhook URL 格式、secret 可选但非空）
  - **testConnection()**: 添加 testFeishuConnection() 函数（POST 简单消息到 webhook 测试连通性）
  - **sendTestMessage()**: 添加 sendTestFeishuMessage() 函数（使用 createFeishuFormatter 格式化测试消息后发送）
  - **testChannel()**: 添加 feishu 分支的输出格式（类似 dingtalk 分支）
  - 添加 `import { generateFeishuSign, createFeishuFormatter } from './feishu.js'`（CLI 可以静态 import）

  **Must NOT do**:
  - 不修改 SMTP 或 DingTalk 的 CLI 逻辑
  - 不使用动态 import（CLI 文件允许静态 import）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 多个函数需要添加，逻辑参照钉钉但需要适配飞书 API 差异
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (仅依赖 Task 2)
  - **Parallel Group**: Wave 2 (with Tasks 3, 5, 6)
  - **Blocks**: Task 7
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/cli.ts:88-160` - validateDingtalkChannel 完整实现（校验 webhook、secret、at 结构）
  - `src/cli.ts:308-353` - testDingtalkConnection 完整实现（带签名的 POST 请求）
  - `src/cli.ts:447-509` - sendTestDingTalkMessage 完整实现（使用 formatter 格式化后发送）
  - `src/cli.ts:531-571` - testChannel 中 dingtalk 分支的输出格式

  **API/Type References**:
  - `src/types.ts:83-86` - FeishuConfig 接口
  - `src/feishu.ts` - Task 2 创建的 generateFeishuSign 和 createFeishuFormatter

  **WHY Each Reference Matters**:
  - DingTalk CLI 函数是直接模板，替换飞书的 API 差异即可
  - 飞书连接测试要注意：timestamp+sign 在 body 中（非 URL），timestamp 用秒级
  - 飞书响应是 code/msg（非 errcode/errmsg）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CLI 飞书通道校验逻辑正确
    Tool: Bash
    Preconditions: cli.ts 已更新
    Steps:
      1. 运行 `npm run typecheck`
      2. 运行 `grep "validateFeishuChannel\|feishu" src/cli.ts | head -10`
    Expected Result: grep 输出包含 feishu 相关校验逻辑
    Failure Indicators: 未找到飞书相关代码
    Evidence: .sisyphus/evidence/task-4-cli-check.txt

  Scenario: CLI 构建通过
    Tool: Bash
    Preconditions: cli.ts 已更新
    Steps:
      1. 运行 `npm run build`
      2. 检查 dist/cli.js 生成成功
    Expected Result: 构建成功，dist/cli.js 存在
    Failure Indicators: 构建失败
    Evidence: .sisyphus/evidence/task-4-build.txt
  ```

  **Commit**: YES
  - Message: `feat(cli): 添加飞书通道 CLI 测试支持`
  - Files: `src/cli.ts`
  - Pre-commit: `npm run typecheck`

- [x] 5. 编写飞书通道单元测试

  **What to do**:
  - 创建 `tests/feishu.test.ts`，参照 `tests/dingtalk.test.ts` 的完整结构
  - **签名测试** (generateFeishuSign):
    - 有效输入生成非空 Base64 输出
    - 相同输入确定性（两次调用结果相同）
    - 空 secret 返回空字符串
    - 输出长度为 43-44 字符（SHA-256 Base64）
    - **关键测试**: 飞书签名与钉钉签名的 key/message 参数不同，使用相同参数调用两者结果不同
  - **格式化器测试** (createFeishuFormatter):
    - Subject 成为 card header title，截断至 100 字符
    - Body 中 key:value 行自动加粗（**key**: value）
    - 错误内容行用代码块包裹
    - 超长内容截断至 4000 字符
    - 输出 msg_type 为 "interactive"
    - 输出包含 card.header 和 card.elements 结构
  - **发送器测试** (createFeishuSender):
    - 非 feishu 类型返回 null
    - disabled 返回 null
    - 缺少 webhook 返回 null
    - 无效 webhook URL 返回 null
    - 有效配置返回 sender 对象
    - send() 调用 fetch POST
    - 有 secret 时 body 包含 timestamp 和 sign
    - 无 secret 时 body 不含 timestamp 和 sign
    - 网络错误静默失败（不 throw）
    - API 错误码处理（code != 0 时静默）
    - close() 正常返回
    - 非 interactive 消息被忽略

  **Must NOT do**:
  - 不测试 locales 或 template（飞书复用通用模板）
  - 不引入额外测试依赖

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 大量测试用例（20+），需要仔细构造断言
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (仅依赖 Task 2)
  - **Parallel Group**: Wave 2 (with Tasks 3, 4, 6)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `tests/dingtalk.test.ts:1-573` - 完整的钉钉测试文件结构（helper factories、fetch mock setup、签名测试、格式化器测试、发送器测试）
  - `tests/dingtalk.test.ts:6-27` - createMockDingtalkChannel 和 createMockDingtalkConfig helper 工厂
  - `tests/dingtalk.test.ts:44-89` - setupMockFetch 和 restoreFetch mock 模式
  - `tests/dingtalk.test.ts:98-148` - generateSign 测试套件
  - `tests/dingtalk.test.ts:154-293` - createDingTalkFormatter 测试套件
  - `tests/dingtalk.test.ts:299-573` - createDingTalkSender 测试套件

  **API/Type References**:
  - `src/feishu.ts` - Task 2 创建的模块（generateFeishuSign, createFeishuFormatter, createFeishuSender）
  - `src/types.ts:83-86` - FeishuConfig 接口

  **WHY Each Reference Matters**:
  - dingtalk.test.ts 是完整的测试模板，直接替换飞书特有逻辑
  - mock fetch 模式可以直接复用
  - 关键是添加飞书签名与钉钉签名的对比测试（验证 key/message 差异正确实现）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 飞书测试全部通过
    Tool: Bash
    Preconditions: feishu.test.ts 已创建
    Steps:
      1. 运行 `bun test tests/feishu.test.ts`
      2. 检查所有测试通过
    Expected Result: 全部通过，0 failures
    Failure Indicators: 任何测试失败
    Evidence: .sisyphus/evidence/task-5-test-results.txt

  Scenario: 全量测试通过（不影响现有测试）
    Tool: Bash
    Preconditions: 所有测试文件就绪
    Steps:
      1. 运行 `bun test`
      2. 检查所有测试通过（包括新的 feishu 测试和旧的 dingtalk/smtp 测试）
    Expected Result: 全部通过，0 failures
    Failure Indicators: 任何测试失败（特别是现有测试 regression）
    Evidence: .sisyphus/evidence/task-5-full-test-results.txt
  ```

  **Commit**: YES
  - Message: `test(feishu): 添加飞书通道单元测试`
  - Files: `tests/feishu.test.ts`
  - Pre-commit: `bun test`

- [x] 6. 更新 README.md 飞书章节

  **What to do**:
  - 在 README.md 中添加飞书通道配置章节，结构与钉钉章节一致
  - 更新 Roadmap 表格：飞书状态从 "Planned" 改为 "Available"
  - 包含：获取 Webhook 和 Secret 步骤、最小配置、完整配置示例、配置字段说明表、常见问题

  **Must NOT do**:
  - 不修改现有 SMTP 或 DingTalk 章节
  - 不删除或移动现有内容

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 文档更新，参照现有钉钉章节格式
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (仅依赖 Task 1)
  - **Parallel Group**: Wave 2 (with Tasks 3, 4, 5)
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `README.md` (DingTalk 章节) - 钉钉配置文档在 README 中的结构和格式
  - `docs/dingtalk-channel.md` - 详细的钉钉通道文档（作为飞书文档的模板）

  **WHY Each Reference Matters**:
  - README 中钉钉章节的格式和深度是飞书章节的直接参考

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: README 包含飞书章节
    Tool: Bash
    Preconditions: README.md 已更新
    Steps:
      1. 运行 `grep -n "Feishu\|飞书" README.md`
      2. 确认找到多个匹配（章节标题、配置示例等）
    Expected Result: 至少 5 处匹配
    Failure Indicators: 未找到飞书相关内容
    Evidence: .sisyphus/evidence/task-6-readme-check.txt

  Scenario: Roadmap 表格已更新
    Tool: Bash
    Preconditions: README.md 已更新
    Steps:
      1. 运行 `grep -A2 "Feishu" README.md | head -5`
      2. 确认飞书状态不是 "Planned"
    Expected Result: 显示飞书为 Available 状态
    Failure Indicators: 仍显示 "Planned"
    Evidence: .sisyphus/evidence/task-6-roadmap-check.txt
  ```

  **Commit**: YES (与 Task 7, 8 合并到文档 commit)
  - Message: `docs(feishu): 添加飞书通道配置文档和更新 README`
  - Files: `README.md`
  - Pre-commit: none

- [x] 7. 创建 docs/feishu-channel.md 文档

  **What to do**:
  - 创建 `docs/feishu-channel.md`，结构与 `docs/dingtalk-channel.md` 完全一致
  - 包含两大部分：用户配置指南 + 内部实现细节
  - **用户配置指南**: 获取 Webhook/Secret、最小配置、完整配置、字段说明表、常见问题
  - **内部实现细节**: 签名算法（重点标注与钉钉的差异）、卡片消息格式化规则、HTTP 请求规格、错误码处理、FeishuConfig JSON Schema、Channel 接口字段映射、与 SMTP/DingTalk 对比表

  **Must NOT do**:
  - 不修改 dingtalk-channel.md
  - 不添加 text/post 消息类型的文档（仅 interactive）

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 大篇幅文档编写，需要详尽准确
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (依赖所有实现任务)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 8
  - **Blocked By**: Task 1, 2, 3, 4

  **References**:

  **Pattern References**:
  - `docs/dingtalk-channel.md:1-333` - 完整的钉钉文档结构（用户指南 + 内部实现两大部分）
  - `docs/dingtalk-channel.md:9-130` - 用户配置指南部分（获取 Webhook、最小配置、完整配置、字段说明、@人、常见问题）
  - `docs/dingtalk-channel.md:132-333` - 内部实现细节部分（签名算法、Markdown 规则、HTTP 规格、错误码、Schema、字段映射、对比表）

  **API/Type References**:
  - `src/feishu.ts` - Task 2 创建的实现文件（签名算法、消息格式、HTTP 请求细节）
  - `src/types.ts:83-86` - FeishuConfig 接口

  **WHY Each Reference Matters**:
  - dingtalk-channel.md 是飞书文档的结构模板，每个章节一一对应
  - feishu.ts 中的实际实现细节需要准确反映到文档中

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 文档结构完整
    Tool: Bash
    Preconditions: feishu-channel.md 已创建
    Steps:
      1. 运行 `grep -n "^## " docs/feishu-channel.md`
      2. 检查包含：用户配置指南、内部实现细节两大章节
    Expected Result: 包含至少 10 个 ## 级别标题，覆盖用户指南和实现细节
    Failure Indicators: 缺少关键章节
    Evidence: .sisyphus/evidence/task-7-doc-structure.txt

  Scenario: 文档内容准确性（签名算法描述）
    Tool: Bash
    Preconditions: feishu-channel.md 已创建
    Steps:
      1. 运行 `grep -A5 "签名算法\|sign" docs/feishu-channel.md | head -20`
      2. 确认描述了飞书的签名差异（key = timestamp + "\n" + secret, message = 空）
    Expected Result: 文档明确描述了与钉钉的签名算法差异
    Failure Indicators: 签名描述与钉钉相同（错误）
    Evidence: .sisyphus/evidence/task-7-doc-sign.txt

  Scenario: 文档包含配置示例
    Tool: Bash
    Preconditions: feishu-channel.md 已创建
    Steps:
      1. 运行 `grep "webhook\|secret\|feishu" docs/feishu-channel.md | head -10`
    Expected Result: 包含最小配置和完整配置的 JSON 示例
    Failure Indicators: 缺少配置示例
    Evidence: .sisyphus/evidence/task-7-doc-config.txt
  ```

  **Commit**: YES (与 Task 6, 8 合并)
  - Message: `docs(feishu): 添加飞书通道配置文档和更新 README`
  - Files: `docs/feishu-channel.md`
  - Pre-commit: none

- [x] 8. 更新 docs/channel-development.md 和 docs/template-configuration.md

  **What to do**:
  - **channel-development.md**:
    - 更新架构图中的 feishu.ts 描述（从 "未实现" 改为 "Webhook"）
    - 在 FormattedMessage 类型表格中补充飞书的消息结构：`{ msg_type: "interactive", card: { header, elements } }`
  - **template-configuration.md**:
    - 在"通道差异说明"章节添加飞书列
    - 补充飞书 lark_md 模板注意事项
    - 添加飞书配置示例到第六节

  **Must NOT do**:
  - 不修改 SMTP 或 DingTalk 的现有文档内容
  - 不添加新章节（仅更新现有章节中的飞书相关内容）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 小幅更新现有文档，2-3 处修改
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (依赖 Task 7)
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F4
  - **Blocked By**: Task 7

  **References**:

  **Pattern References**:
  - `docs/channel-development.md:39-41` - 架构图中 feishu.ts 的描述（当前标注 "未实现"）
  - `docs/channel-development.md:164-172` - FormattedMessage 类型表格
  - `docs/template-configuration.md:475-493` - 通道差异说明章节

  **WHY Each Reference Matters**:
  - 这两处是飞书信息缺失的关键位置，需要补充以保持文档一致性

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: channel-development.md 包含飞书信息
    Tool: Bash
    Preconditions: 文件已更新
    Steps:
      1. 运行 `grep -n "feishu\|飞书\|Feishu" docs/channel-development.md`
    Expected Result: 包含飞书相关条目（不再是 "未实现"）
    Failure Indicators: 仍然显示 "未实现"
    Evidence: .sisyphus/evidence/task-8-channel-dev-check.txt

  Scenario: template-configuration.md 包含飞书差异说明
    Tool: Bash
    Preconditions: 文件已更新
    Steps:
      1. 运行 `grep -n "Feishu\|飞书\|lark_md" docs/template-configuration.md`
    Expected Result: 包含飞书/lark_md 相关内容
    Failure Indicators: 未找到飞书相关内容
    Evidence: .sisyphus/evidence/task-8-template-check.txt
  ```

  **Commit**: YES (与 Task 6, 7 合并)
  - Message: `docs(feishu): 添加飞书通道配置文档和更新 README`
  - Files: `docs/channel-development.md`, `docs/template-configuration.md`
  - Pre-commit: none

---

## Final Verification Wave (MANDATORY - after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** - `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns -- reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** - `unspecified-high`
  Run `tsc --noEmit` + `npm run lint` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** - `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** - `deep`
  For each task: read "What to do", read actual diff. Verify 1:1. Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit 1**: `feat(types): 添加飞书通道配置字段 secret` - src/types.ts
  - Pre-commit: `npm run typecheck`
- **Commit 2**: `feat(feishu): 实现飞书 Webhook 发送器和格式化器` - src/feishu.ts
  - Pre-commit: `npm run typecheck`
- **Commit 3**: `feat(feishu): 注册飞书通道到分发器和配置系统` - src/formatters.ts, src/handler.ts, src/config.ts
  - Pre-commit: `npm run typecheck`
- **Commit 4**: `feat(cli): 添加飞书通道 CLI 测试支持` - src/cli.ts
  - Pre-commit: `npm run typecheck`
- **Commit 5**: `test(feishu): 添加飞书通道单元测试` - tests/feishu.test.ts
  - Pre-commit: `bun test`
- **Commit 6**: `docs(feishu): 添加飞书通道配置文档和更新 README` - docs/feishu-channel.md, docs/channel-development.md, docs/template-configuration.md, README.md
  - Pre-commit: none

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all tests pass (including new feishu tests)
npm run typecheck           # Expected: no errors
npm run lint                # Expected: no errors
npm run build               # Expected: successful build to dist/
```

### Final Checklist
- [ ] All "Must Have" present (feishu.ts, tests, docs, CLI, integration)
- [ ] All "Must NOT Have" absent (no external deps, no static imports, no DNS pre-resolve)
- [ ] All tests pass
- [ ] docs/feishu-channel.md 结构与 docs/dingtalk-channel.md 一致
- [ ] README.md Roadmap 表格中 Feishu 状态更新
