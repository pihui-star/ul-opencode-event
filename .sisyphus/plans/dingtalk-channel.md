# 钉钉机器人通知通道 + 多通道架构重构

## TL;DR

> **Quick Summary**: 为 OpenCode 通知插件增加钉钉机器人 Webhook 通知通道，同时将 handler 层从邮件专用接口重构为通用的多通道架构（ChannelSender + ChannelFormatter），为未来扩展飞书/Telegram 等渠道奠定基础。
> 
> **Deliverables**:
> - `src/dingtalk.ts` -- 钉钉发送器（签名、HTTP POST、Markdown 格式化、@人、截断）
> - `src/handler.ts` -- 重构为通用多通道分发器
> - `src/types.ts` -- 新增 ChannelSender/ChannelFormatter 接口，扩展 DingtalkConfig
> - `src/email.ts` -- 适配新 ChannelSender 接口
> - `src/formatters.ts` -- 通道格式化器注册表
> - `src/config.ts` -- 支持 dingtalk 通道类型校验
> - `src/cli.ts` -- 支持钉钉通道测试
> - `tests/dingtalk.test.ts` -- 钉钉完整测试套件（TDD）
> - 更新现有测试以适配重构后的 handler 接口
> - README 钉钉用户配置文档
> - `docs/dingtalk-channel.md` -- 多通道架构开发参考文档
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 -> Task 4 -> Task 5 -> Task 8-12 -> Final Wave

---

## Context

### Original Request
在现有仅支持 SMTP 邮件的 OpenCode 通知插件中，增加钉钉机器人 Webhook 通知通道。要求从功能设计角度考虑未来可扩展性（飞书、Telegram 等）。

### Interview Summary
**Key Discussions**:
- **消息格式**: 统一使用钉钉 Markdown 类型（用户确认），不实现 text/actionCard 变体
- **架构路线**: 经过业界 4 个开源项目研究（nikoksr/notify 3k+ stars, Novu 35k+ stars, guanguans/notify 1k+ stars, AlertManager 55k+ stars），选择 **ChannelFormatter 格式化管道**方案 -- 在模板渲染和 sender 之间插入格式化层，各渠道注册自己的 formatter
- **模板策略**: 全局模板自动适配所有渠道 + 可选的渠道级 templates 覆盖。一份模板管所有渠道，需要时可针对特定渠道微调
- **改造范围**: 用户明确选择"完整重构"而非"最小改动"-- 一次性将 handler 泛化为多通道架构
- **@人功能**: 配置级 atMobiles/atAll，不做自动规则
- **截断策略**: 智能 4000 字符截断（保留头部信息，截断尾部）
- **错误处理**: 静默失败 + DEBUG 日志（与 email.ts 一致）
- **签名机制**: secret 可选，HmacSHA256 自动加签
- **CLI 测试**: 三步验证（配置校验 → 连通性 → 发送测试消息）
- **测试策略**: TDD（Bun test）

**Research Findings**:
- 钉钉 API: POST JSON 到 `https://oapi.dingtalk.com/robot/send?access_token=xxx&timestamp=xxx&sign=xxx`
- 签名算法: `HmacSHA256(timestamp + "\n" + secret)` → base64 → URL encode
- 频率限制: 20 条/分钟/机器人，4xx 需重试
- Markdown 子集: 不支持图片/表格，需内容转义（特殊字符）
- 业界模式: Novu 的 per-channel Option 类型最接近我们的需求，但我们的 ChannelFormatter 是其轻量版

### Metis Review
**Identified Gaps** (addressed in plan):
- 测试必须遵循 `mock.module()` 预导入模式（非negotiable，与现有测试一致）
- Helper factories 应定义在每个测试文件内（不共享），参考现有 handler.test.ts / email.test.ts 模式
- Console mock/restore 模式需用 try/finally 包裹（标准模式）
- DingTalk Markdown 子集需转义处理：`_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`
- 需考虑 webhook URL 中已有 query 参数时签名参数的拼接方式
- `DingtalkConfig.at` 字段的结构需明确（扁平 vs 嵌套对象）

---

## Work Objectives

### Core Objective
实现钉钉机器人通知通道，并将插件架构从单通道（SMTP）升级为可扩展的多通道系统。

### Concrete Deliverables
- `src/dingtalk.ts`: 钉钉 Webhook 发送器（~120 行）
- 重构后的 `src/handler.ts`: 通用多通道事件分发器
- 更新后的 `src/types.ts`: ChannelSender + ChannelFormatter 接口定义
- 适配后的 `src/email.ts`: 实现 ChannelSender 接口
- 更新后的 `src/config.ts` + `src/cli.ts`: dingtalk 类型支持
- `tests/dingtalk.test.ts`: 完整 TDD 测试套件
- 更新后的现有测试（handler.test.ts 等）：适配新接口
- README 中钉钉配置文档

### Definition of Done
- [ ] `npm run build` 通过（tsc 编译零错误）
- [ ] `npm run typecheck` 通过
- [ ] `npm run test` 全部通过（含新增钉钉测试和更新的旧测试）
- [ ] `npx @ulthon/ul-opencode-event test` 能正确测试钉钉通道
- [ ] 现有 SMTP 功能完全不受影响（向后兼容）

### Must Have
- 钉钉 Markdown 消息发送（含签名）
- @人功能（atMobiles / atAll）
- 内容智能截断（4000 字符）
- ChannelSender + ChannelFormatter 抽象接口
- handler.ts 完整泛化重构
- TDD 测试覆盖
- CLI 测试支持
- 向后兼容（现有 SMTP 配置零改动）

### Must NOT Have (Guardrails)
- 不引入新的 npm 运行时依赖（用 Node.js 内置 fetch/https）
- 不修改 template.ts 或 locales.ts 的默认模板内容（formatter 层负责转换）
- 不在库代码中静态 import nodemailer（保持延迟导入约定）
- 不实现 actionCard / feedCard / text 等其他钉钉消息类型
- 不做自动 @人规则（如 error 自动 @all）
- 不改动 EventPayload 类型或 eventToPayload 逻辑（index.ts 不动）
- 不破坏现有的 DNS 预解析机制

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Bun test framework)
- **Automated tests**: TDD (RED-GREEN-REFACTOR per task)
- **Framework**: bun test
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun/node REPL) - Import, call functions, compare output
- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **CLI/TUI**: Use interactive_bash (tmux) - Run command, send keystrokes, validate output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - types + interfaces + core modules):
├── Task 1:  Type definitions & interfaces (types.ts) [quick]
├── Task 2:  Email sender adapter (email.ts) [quick]
├── Task 3:  DingTalk sender core (dingtalk.ts) [deep]
└── Task 4:  ChannelFormatters (handler.ts or new module) [unspecified-high]

Wave 2 (After Wave 1 - integration layer):
├── Task 5:  Handler refactoring (handler.ts) [deep]
├── Task 6:  Config validation update (config.ts) [quick]
├── Task 7:  CLI dingtalk support (cli.ts) [unspecified-high]
└── Task 8:  DingTalk unit tests (tests/dingtalk.test.ts) [unspecified-high]

Wave 3 (After Wave 2 - test updates + polish):
├── Task 9:  Handler refactoring tests update (tests/handler.test.ts) [unspecified-high]
├── Task 10: Config dingtalk tests (tests/config.test.ts additions) [quick]
├── Task 11: CLI dingtalk tests (new or extend existing cli tests) [unspecified-high]
└── Task 12: README dingtalk documentation [writing]

Wave FINAL (After ALL tasks - 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 2 → Task 5 → Task 8 → Tasks 9-11 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

- **1**: - - 2, 3, 4, 1
- **2**: 1 - 5, 2
- **3**: 1 - 5, 6, 7, 8, 2
- **4**: 1 - 5, 2
- **5**: 1, 2, 3, 4 - 6, 7, 8, 9, 3
- **6**: 1 - 7, 10, 1
- **7**: 1, 3, 6 - 8, 11, 2
- **8**: 1, 3, 5 - 9, 3
- **9**: 5, 8 - F1, 3
- **10**: 6 - F1, 1
- **11**: 7 - F1, 2
- **12**: all above - F1, 2

### Agent Dispatch Summary

- **1**: **4** - T1 → `quick`, T2 → `quick`, T3 → `deep`, T4 → `unspecified-high`
- **2**: **4** - T5 → `deep`, T6 → `quick`, T7 → `unspecified-high`, T8 → `unspecified-high`
- **3**: **4** - T9 → `unspecified-high`, T10 → `quick`, T11 → `unspecified-high`, T12 → `writing`
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.

- [x] 1. **类型定义与接口设计** (`src/types.ts`)

  **What to do**:
  - 新增 `ChannelSender` 接口（泛化发送接口，替代当前 EmailSender）:
    ```typescript
    export interface ChannelSender {
      send(message: unknown): Promise<void>;
      close(): Promise<void>;
    }
    ```
  - 新增 `ChannelFormatter` 接口（格式化层抽象）:
    ```typescript
    export interface FormattedMessage {
      // 渠道原生消息体，由各 formatter 自行定义结构
      [key: string]: unknown;
    }
    
    export interface ChannelFormatter {
      format(subject: string, body: string, payload: EventPayload): FormattedMessage;
    }
    ```
  - 扩展 `DingtalkConfig` 接口，增加 @人配置:
    ```typescript
    export interface DingtalkConfig {
      webhook: string;
      secret?: string;
      at?: {
        atMobiles?: string[];
        atAll?: boolean;
      };
    }
    ```
  - **保留** `EmailSender` 接口作为向后兼容别名（标记 `@deprecated`，内部使用 ChannelSender）
  - 不修改 `EventPayload`、`ChannelType`、`Channel` 等现有类型

  **Must NOT do**:
  - 不修改 EventPayload 或事件相关类型（index.ts 不受影响）
  - 不删除 EmailSender 接口（渐进式迁移，email.ts 先适配新接口同时保留旧接口导出）
  - 不在 types.ts 中引入任何新的 import 依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 类型定义改动明确，无复杂逻辑，纯接口/类型声明
  - **Skills**: []
    - 无需特殊技能

  **Parallelization**:
  - **Can Run In Parallel**: NO (Wave 1 基础任务)
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/types.ts:35-44` -- 当前 Channel 接口定义，理解字段结构
  - `src/types.ts:86-89` -- 当前 DingtalkConfig 占位定义，需扩展
  - `src/email.ts:30-33` -- 当前 EmailSender 接口，需要对其做向后兼容处理

  **API/Type References** (contracts to implement against):
  - `src/handler.ts:29-32` -- 当前 EventHandler 接口引用了 EmailSender
  - `src/handler.ts:40` -- 当前 senders Map 类型为 `Map<string, EmailSender>`

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] `npm run typecheck` 通过 -- 新接口编译无误
  - [ ] `npm run build` 通过 -- 构建产物包含新类型声明
  - [ ] 现有 `EmailSender` 导出仍可用（向后兼容）

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Type definitions compile without errors
    Tool: Bash (npm run typecheck + npm run build)
    Preconditions: Project dependencies installed
    Steps:
      1. Run npm run typecheck
      2. Verify exit code is 0
      3. Run npm run build
      4. Verify dist/ directory contains updated .d.ts files
      5. Check dist/types.d.ts contains ChannelSender and ChannelFormatter interfaces
    Expected Result: tsc --noEmit passes with zero errors; build succeeds
    Failure Indicators: tsc reports type errors in types.ts; build fails
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Backward compatibility - EmailSender still exported
    Tool: Bash (grep on built output)
    Steps:
      1. Run npm run build
      2. Grep dist/index.d.ts for "EmailSender"
      3. Verify EmailSender is present (may be deprecated but must exist)
    Expected Result: EmailSender found in type declarations
    Failure Indicators: EmailSender completely removed from exports
    Evidence: .sisyphus/evidence/task-1-compat.txt
  ```

  **Commit**: YES (group with Task 2)
  - Message: `feat(types): add ChannelSender/ChannelFormatter interfaces and extend DingtalkConfig`
  - Files: `src/types.ts`

- [x] 2. **邮件发送器适配新接口** (`src/email.ts`)

  **What to do**:
  - 让现有的 `createEmailSender()` 返回值同时满足 `ChannelSender` 接口
  - **确定方案: EmailSender 内部做类型收窄适配**
    - `EmailSender.send(message: unknown)` 内部检测 message 结构
    - 如果 message 是 `{ subject?: string, text?: string }` 格式（emailFormatter 的输出），提取 subject 和 text，走原有发送逻辑
    - 这保持了 `send(subject, body)` 原有签名作为内部实现不变
    - 返回类型从 `Promise<EmailSender | null>` 改为 `Promise<ChannelSender | null>`
  - 保持所有现有行为不变：DNS 预解析、重试链路、静默失败

  **Must NOT do**:
  - 不修改 DNS 预解析逻辑
  - 不修改重试/回退链路
  - 不增加静态 nodemailer import
  - 不改变错误处理行为

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 主要是接口适配，核心发送逻辑不动
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (needs ChannelSender interface definition)

  **References**:

  **Pattern References**:
  - `src/email.ts:30-33` -- EmailSender 接口定义
  - `src/email.ts:144-247` -- createEmailSender 完整实现
  - `src/email.ts:171-241` -- send 方法的完整逻辑（DNS 重试链路）

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] 测试文件: `tests/email-adapter.test.ts`（或扩展现有 `tests/email.test.ts`）
  - [ ] `bun test tests/email*.test.ts` → PASS
  - [ ] EmailSender 可作为 ChannelSender 使用（类型检查通过）
  - [ ] 调用 `sender.send({ subject: 'test', body: 'hello' })` 行为等价于原 `sender.send('test', 'hello')`

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Email sender accepts new ChannelSender message format
    Tool: Bun test runner
    Preconditions: Task 1 complete (types defined), Task 2 code implemented
    Steps:
      1. Create mock SMTP channel config
      2. Call createEmailSender(channel) 
      3. Call sender.send({ subject: 'Test Subject', body: 'Test Body' })
      4. Assert the underlying transport received correct mailOptions (subject='Test Subject', text='Test Body')
    Expected Result: Mail sent with correct subject and body
    Failure Indicators: Type error; send() rejects new format; mailOptions incorrect
    Evidence: .sisyphus/evidence/task-2-adapter.txt

  Scenario: Email sender backward compatibility - old API still works
    Tool: Bun test runner
    Steps:
      1. Create EmailSender via createEmailSender()
      2. Call sender.send('Old Subject', 'Old Body') -- old signature
      3. Assert no error thrown, transport receives correct data
    Expected Result: Old calling pattern still works
    Failure Indicators: Old signature broken or removed
    Evidence: .sisyphus/evidence/task-2-backward.txt
  ```

  **Commit**: YES (group with Task 1)
  - Message: `feat(email): adapt EmailSender to ChannelSender interface`
  - Files: `src/email.ts`

- [x] 3. **钉钉发送器核心实现** (`src/dingtalk.ts`) -- 新文件

  **What to do**:
  创建 `src/dingtalk.ts`，实现完整的钉钉机器人 Webhook 发送功能：

  **a) 签名模块** (~30 行):
  ```typescript
  async function generateSign(secret: string, timestamp: number): Promise<string> {
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(stringToSign));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }
  ```
  注意：使用 Web Crypto API（Node.js 内置），不引入额外依赖。

  **b) Markdown 格式化器** (~40 行):
  - 将 subject + body 转为钉钉 Markdown 格式
  - subject → `# {subject}` （一级标题，截断到 100 字符）
  - body 的每行智能格式化：
    - 识别 `key: value` 模式 → `**key**: value`
    - 识别多行内容 → 用 `>` 引用块包裹
    - 错误信息 → 用 ``` 代码块包裹
  - 钉钉 Markdown 特殊字符转义：`\`, `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`

  **c) 内容截断** (~15 行):
  - 安全阈值 4000 字符（钉钉限制 4096，留余量）
  - 截断策略：保留前 3800 字符 + `\n... (truncated)`
  - 如果标题超过 100 字符，截断并加 `...`

  **d) HTTP 发送模块** (~35 行):
  - 使用 Node.js 内置 `fetch`（Node 18+）或 fallback 到 `https.request`
  - POST JSON 到 webhook URL
  - 有 secret 时拼接 timestamp + sign query 参数
  - 解析响应：errcode === 0 为成功
  - 错误处理：频率限制(4xx)加重试间隔；网络错误静默失败 + DEBUG 日志
  - 超时设置: 10 秒

  **e) Sender 工厂函数** (~20 行):
  ```typescript
  export async function createDingTalkSender(channel: Channel): Promise<ChannelSender | null>
  ```
  - 校验 webhook URL 格式
  - 返回实现 ChannelSender 接口的对象
  - close(): Promise<void> -- 清理资源（如有）

  **f) Formatter 工厂函数** (~15 行):
  ```typescript
  export function createDingTalkFormatter(config: DingtalkConfig): ChannelFormatter
  ```

  **Must NOT do**:
  - 不引入任何新的 npm 依赖
  - 不静态 import 外部模块（除 node 内置）
  - 不实现 actionCard / feedCard / text 消息类型
  - 不做自动 @人规则

  **@人功能默认行为说明**:
  - `at` 字段完全可选（`DingtalkConfig.at` 为 `undefined` 时）
  - **不配置 `at` = 不在 payload 中包含 `at` 字段 = 普通群消息，无人收到特别提醒**
  - 这是默认且最安全的行为：通知静默送达群，不打扰任何人
  - 仅当用户显式配置 `atAll: true` 或 `atMobiles: [...]` 时，才在 webhook payload 中携带 `at` 字段
  - formatter 在构建 payload 时判断：`config.at ? { at: config.at } : {}` （条件性包含）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 核心业务逻辑最密集的模块 -- 签名算法、Markdown 格式化、HTTP 发送、错误处理都需要仔细实现
  - **Skills**: []
    - 无需特殊技能，但需要仔细阅读钉钉 API 文档中的签名算法

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 5, 6, 7, 8
  - **Blocked By**: Task 1 (needs ChannelSender, ChannelFormatter, DingtalkConfig types)

  **References**:

  **External References**:
  - 钉钉官方文档: Webhook 签名算法 -- HmacSHA256(timestamp + "\n" + secret)
  - 钉钉官方文档: markdown 消息格式 -- { msgtype: "markdown", markdown: { title, text }, at: {...} }
  - 钉钉官方文档: 错误码表 -- errcode 0=成功, 310000=参数错误, 400001=频率限制
  - Node.js Web Crypto API: crypto.subtle for HmacSHA256 (no external deps needed)
  - MDN: URL encoding for sign parameter in query string

  **Pattern References**:
  - `src/email.ts:144-247` -- 参考其 sender 工厂模式（校验→创建→返回接口）
  - `src/email.ts:239-241` -- 参考其静默失败 + 日志记录模式
  - `src/template.ts:5-11` -- 参考 renderTemplate 实现（dingtalk formatter 会调用它）

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] 测试文件: `tests/dingtalk.test.ts`（TDD: 先写测试再实现）
  - [ ] `bun test tests/dingtalk.test.ts` → PASS (all tests green)
  - [ ] 签名算法正确（可对比已知测试向量）
  - [ ] Markdown 格式化输出符合钉钉要求（title ≤ 100字符, text ≤ 4000字符, 特殊字符已转义）
  - [ ] 截断逻辑正确（超长内容被正确截断，保留头部）
  - [ ] HTTP 发送成功时 errcode=0，失败时静默记录日志
  - [ ] 有 secret 时自动加签，无 secret 时直接发送

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: DingTalk signature generation correctness
    Tool: Bun test runner (unit test)
    Preconditions: dingtalk.ts implemented
    Steps:
      1. Call generateSign with known secret="SECxxx" and timestamp=1700000000000
      2. Compare output against pre-calculated expected value (or verify it's valid base64 of correct length)
      3. Call with empty secret → should not throw (secret is optional)
    Expected Result: Signature is non-empty base64 string; empty secret handled gracefully
    Failure Indicators: Throws error; empty string returned; wrong encoding
    Evidence: .sisyphus/evidence/task-3-signature.txt

  Scenario: DingTalk Markdown formatting - basic conversion
    Tool: Bun test runner
    Steps:
      1. Call format with subject="[OpenCode] Test" and body="Project: my-proj\nTime: 2024-01-01"
      2. Assert result.msgtype === "markdown"
      3. Assert result.markdown.title starts with "[OpenCode] Test"
      4. Assert result.markdown.text contains "**Project**: my-proj"
      5. Assert result.markdown.text contains "**Time**: 2024-01-01"
    Expected Result: Properly formatted markdown with bold labels
    Failure Indicators: Plain text without formatting; special chars not escaped
    Evidence: .sisyphus/evidence/task-3-format-basic.txt

  Scenario: DingTalk Markdown formatting - special character escaping
    Tool: Bun test runner
    Steps:
      1. Call format with body containing "_italic_ *bold* `code` > quote # header"
      2. Assert all special characters are escaped with backslash prefix
      3. Verify rendered content won't trigger unintended markdown rendering
    Expected Result: All MD-special characters properly escaped
    Failure Indicators: Unescaped special chars cause wrong rendering in DingTalk
    Evidence: .sisyphus/evidence/task-3-format-escape.txt

  Scenario: Content truncation for long messages
    Tool: Bun test runner
    Steps:
      1. Generate body text > 5000 characters (e.g., long error stack trace)
      2. Call formatter.format()
      3. Assert result.markdown.text.length <= 4000
      4. Assert text ends with "... (truncated)"
      5. Assert header info (project name, timestamp) is preserved in output
    Expected Result: Long content truncated safely, critical info preserved
    Failure Indicators: Exceeds 4000 chars; header info lost; no truncation marker
    Evidence: .sisyphus/evidence/task-3-truncation.txt

  Scenario: DingTalk HTTP send - success path (mocked fetch)
    Tool: Bun test runner
    Steps:
      1. Mock global fetch to return { errcode: 0, errmsg: "ok" }
      2. Create DingTalkSender with valid webhook URL
      3. Call sender.send(formattedMessage)
      4. Assert fetch was called with correct URL and JSON body
      5. Assert no error thrown
    Expected Result: Fetch called once with proper payload; send resolves successfully
    Failure Indicators: Fetch not called; wrong URL/body; throws error
    Evidence: .sisyphus/evidence/task-3-send-success.txt

  Scenario: DingTalk HTTP send - failure silent logging
    Tool: Bun test runner
    Steps:
      1. Mock global fetch to throw network error (or return errcode !== 0)
      2. Set UL_OPENCODE_EVENT_DEBUG=1
      3. Capture console.error output
      4. Call sender.send(formattedMessage)
      5. Assert does NOT throw (silent failure)
      6. Assert console.error was called with error details
    Expected Result: No exception; error logged to console when DEBUG enabled
    Failure Indicators: Exception propagates up; no log output
    Evidence: .sisyphus/evidence/task-3-send-failure.txt

  Scenario: DingTalk @mention integration
    Tool: Bun test runner
    Steps:
      1. Create channel config with at: { atMobiles: ["13800138000"], atAll: false }
      2. Format and send a message
      3. Assert request body contains at.atMobiles = ["13800138000"]
      4. Assert request body contains at.atAll = false
      5. Repeat with atAll: true → assert atAll = true in body
    Expected Result: At-mention params correctly included in webhook payload
    Failure Indicators: at field missing; wrong structure
    Evidence: .sisyphus/evidence/task-3-atmention.txt
  ```

  **Commit**: YES (standalone or group with Task 4)
  - Message: `feat(dingtalk): add DingTalk robot webhook sender with signing, markdown formatting, and truncation`
  - Files: `src/dingtalk.ts`

- [x] 4. **通道格式化器注册表** (`src/formatters.ts` 或内联在 `src/handler.ts`)

  **What to do**:
  创建格式化器的注册和分发机制：

  **a) Email Formatter** (~15 行):
  ```typescript
  export const emailFormatter: ChannelFormatter = {
    format(subject, body) {
      return { subject, text: body };  // 基本透传，email sender 期望此结构
    },
  };
  ```

  **b) DingTalk Formatter 入口** (~10 行):
  ```typescript
  // 从 dingtalk.ts 导入实际实现
  export { createDingTalkFormatter };
  ```

  **c) Formatter Registry** (~25 行):
  ```typescript
  const FORMATTER_REGISTRY: Record<ChannelType, ChannelFormatter | undefined> = {
    smtp: emailFormatter,
    // dingtalk: 由 createDingTalkFormatter() 动态创建（需要 config）
  };

  export function getFormatter(channelType: ChannelType, channel: Channel): ChannelFormatter | null {
    if (channelType === 'dingtalk') {
      return createDingTalkFormatter(channel.config as DingtalkConfig);
    }
    return FORMATTER_REGISTRY[channelType] ?? null;
  }
  ```

  **Must NOT do**:
  - 不在 formatter 中触发副作用（如网络请求）
  - 不修改传入的 subject/body/payload（纯函数）
  - 不引入循环依赖（formatters → dingtalk 是单向的）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要仔细设计 registry 和 formatter 分发逻辑，确保类型安全和零副作用
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 1 (interfaces), 3 (dingtalk formatter factory)

  **References**:

  **Pattern References**:
  - `src/locales.ts:134-137` -- getDefaultTemplates 的 registry 模式（参考其按 key 查找的模式）
  - `src/handler.ts:82-110` -- 当前的模板渲染逻辑（formatter 在此之后被调用）

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] 测试文件: `tests/formatters.test.ts`（或合入 dingtalk.test.ts）
  - [ ] `bun test tests/formatters*.test.ts` → PASS
  - [ ] emailFormatter.format() 返回 `{ subject, text }` 结构
  - [ ] getFormatter('smtp', channel) 返回 emailFormatter
  - [ ] getFormatter('dingtalk', channel) 返回有效的 DingTalk formatter
  - [ ] getFormatter('feishu', channel) 返回 null（未实现的渠道）

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Formatter registry returns correct formatters per channel type
    Tool: Bun test runner
    Steps:
      1. Call getFormatter('smtp', mockSmtpChannel)
      2. Assert returned formatter is emailFormatter instance
      3. Call getFormatter('dingtalk', mockDingtalkChannel)
      4. Assert returned formatter has .format() method
      5. Call getFormatter('feishu' as any, mockChannel)
      6. Assert returns null
    Expected Result: Correct formatter per type; null for unimplemented
    Failure Indicators: Wrong formatter returned; crash on unknown type
    Evidence: .sisyphus/evidence/task-4-registry.txt

  Scenario: Email formatter pass-through behavior
    Tool: Bun test runner
    Steps:
      1. Call emailFormatter.format('My Subject', 'Line 1\nLine 2', mockPayload)
      2. Assert result.subject === 'My Subject'
      3. Assert result.text === 'Line 1\nLine 2'
    Expected Result: Pure pass-through, no transformation
    Failure Indicators: Subject or body modified unexpectedly
    Evidence: .sisyphus/evidence/task-4-email-fmt.txt
  ```

  **Commit**: YES (group with Task 3)
  - Message: `feat(handler): add ChannelFormatter registry with email and dingtalk formatters`
  - Files: `src/formatters.ts` (new) or updates to `src/handler.ts`

- [x] 5. **Handler 多通道重构** (`src/handler.ts`) -- 核心改造

  **What to do**:
  这是本次实现中**改动最大、风险最高**的任务。将 handler 从邮件专用分发器重构为通用多通道分发器。

  **a) Sender Map 泛化**:
  ```typescript
  // Before
  const senders: Map<string, EmailSender> = new Map();
  // After
  const senders: Map<string, ChannelSender> = new Map();
  ```

  **b) Lazy 初始化逻辑扩展** -- 在 sendersInitialized 分支中增加 dingtalk case:
  ```typescript
  if (channel.type === 'dingtalk' && channel.enabled !== false) {
    try {
      const dingtalkModule = await import('./dingtalk.js');
      const sender = await dingtalkModule.createDingTalkSender(channel);
      if (sender) {
        senders.set(key, sender);
      }
    } catch {
      // Silently skip (same pattern as smtp)
    }
  }
  ```

  **c) Dispatch 逻辑改造** -- 在发送循环中引入 formatter:
  ```typescript
  // 在模板渲染之后、sender.send() 之前：
  const formatter = getFormatter(channel.type, channel);
  if (formatter) {
    const formatted = formatter.format(subject, body, payload);
    await sender.send(formatted);  // ChannelSender.send(unknown)
  } else {
    // Fallback: for channels without formatter
    await (sender as EmailSender).send(subject, body);
  }
  ```

  **d) close() 方法** -- 无需改动（已经是遍历 senders 调用 close()）

  **Must NOT do**:
  - 不修改事件过滤逻辑（EVENT_DEFAULTS、eventEnabled 检查）
  - 不修改模板渲染逻辑（renderTemplate 调用）
  - 不修改变量构建逻辑（variables 对象）
  - 不破坏现有的 SMTP 通道行为

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8)
  - **Blocks**: Tasks 8, 9
  - **Blocked By**: Tasks 1, 2, 3, 4

  **References**:

  **Pattern References** (CRITICAL):
  - `src/handler.ts:38-67` -- 当前 sender 懒初始化逻辑
  - `src/handler.ts:69-118` -- 当前 dispatch 循环（formatter 插入点）
  - `src/handler.ts:121-127` -- close() 方法

  **Test References**:
  - `tests/handler.test.ts` -- 现有 handler 测试（Task 9 会更新）
  - `tests/integration/full-flow.test.ts` -- 集成测试

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] SMTP 通道行为完全不变（现有测试全部通过）
  - [ ] DingTalk 通道正确初始化和发送
  - [ ] 无 formatter 的渠道走 fallback 路径不报错
  - [ ] close() 正确清理所有类型 sender
  - [ ] `bun test tests/handler.test.ts` → PASS

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Handler initializes both SMTP and DingTalk senders lazily
    Tool: Bun test runner
    Steps:
      1. Create config with 1 smtp + 1 dingtalk channel
      2. Call createEventHandler(config), trigger handle()
      3. Assert senders map has 2 entries
      4. Assert both are ChannelSender instances
    Expected Result: Both channel types initialized on first handle()
    Failure Indicators: Only smtp initialized; type error
    Evidence: .sisyphus/evidence/task-5-init-both.txt

  Scenario: Handler dispatches through formatter layer
    Tool: Bun test runner
    Steps:
      1. Mock createDingTalkSender + createDingTalkFormatter as spies
      2. Call handle('idle', payload)
      3. Assert spyFormatter.format() called with (subject, body, payload)
      4. Assert spySender.send() called with formatter output (not raw subject/body)
    Expected Result: Formatter transforms before sender sends
    Failure Indicators: Sender receives raw data; formatter not called
    Evidence: .sisyphus/evidence/task-5-dispatch-formatter.txt

  Scenario: Handler SMTP backward compatibility - no regression
    Tool: Bun test runner
    Steps:
      1. Create config with only SMTP channel
      2. Call handle('idle', payload)
      3. Assert email sender received { subject, text } from emailFormatter
      4. Compare behavior against pre-refactoring snapshot
    Expected Result: SMTP path identical to pre-refactoring behavior
    Failure Indicators: Any difference in SMTP sending behavior
    Evidence: .sisyphus/evidence/task-5-smtp-compat.txt

  Scenario: Handler gracefully handles disabled/invalid channels
    Tool: Bun test runner
    Steps:
      1. Test enabled:false dingtalk channel → no error, no sender created
      2. Test invalid webhook URL → silent skip in catch block
    Expected Result: Invalid/disabled channels silently skipped
    Failure Indicators: Throws error; crashes handler
    Evidence: .sisyphus/evidence/task-5-error-handling.txt
  ```

  **Commit**: YES (major commit)
  - Message: `feat(handler): refactor to multi-channel architecture with ChannelSender/ChannelFormatter`
  - Files: `src/handler.ts`

- [x] 6. **配置校验更新** (`src/config.ts`)

  **What to do**:
  - 将 `'dingtalk'` 加入 `SUPPORTED_CHANNEL_TYPES`: `const SUPPORTED_CHANNEL_TYPES = ['smtp', 'dingtalk'] as const;`
  - 更新 validateChannelTypes() 错误消息中的支持列表
  - 更新文件头注释

  **Must NOT do**:
  - 不修改 mergeChannels / filterEnabledChannels / loadConfig 等函数
  - 不加入 'feishu'（尚未实现）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 2 (with Tasks 5, 7, 8)
  - **Blocks**: Task 7
  - **Blocked By**: Task 1

  **References**:
  - `src/config.ts:7` -- SUPPORTED_CHANNEL_TYPES 定义（唯一改动点）
  - `src/config.ts:46-54` -- validateChannelTypes 函数

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] 包含 `type: "dingtalk"` 的配置不再抛出 "Unsupported channel type" 错误
  - [ ] 包含 `type: "feishu"` 的配置仍然抛出错误
  - [ ] `bun test tests/config.test.ts` → PASS

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Config validation accepts dingtalk, rejects feishu
    Tool: Bun test runner
    Steps:
      1. Validate config with { type: "dingtalk", ... } → assert no error
      2. Validate config with { type: "feishu", ... } → assert throws Error
      3. Error message lists "smtp, dingtalk"
    Expected Result: DingTalk accepted, Feishu rejected with correct message
    Failure Indicators: Wrong acceptance/rejection; wrong error message
    Evidence: .sisyphus/evidence/task-6-config-validation.txt
  ```

  **Commit**: YES (group with Task 7)
  - Message: `feat(config): add dingtalk to supported channel types`
  - Files: `src/config.ts`

- [x] 7. **CLI 钉钉支持** (`src/cli.ts`)

  **What to do**:

  **a) validateChannel() 扩展** (~20 行):
  - 增加 `dingtalk` 分支：检查 webhook URL 有效、secret 合法（如提供）、at 结构合法

  **b) testConnection() 新增** (~30 行):
  - 发送最小测试请求到 webhook，检查 HTTP 响应和 errcode

  **c) sendTestMessage() 新增** (~30 行):
  - 发送格式化的 Markdown 测试消息

  **d) testChannel() 主流程更新** (~15 行):
  - 增加 dingtalk 分支，三步验证流程与 SMTP 一致

  **e) 签名辅助函数** (~20 行):
  - CLI 可直接 import dingtalk 模块或内联签名逻辑

  **Must NOT do**:
  - 不修改 parseArgs / printUsage / main 入口
  - 不移除或修改现有 SMTP 测试功能

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8)
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 1, 3, 6

  **References**:
  - `src/cli.ts:77-114` -- validateChannel() （需扩展的类型判断）
  - `src/cli.ts:197-251` -- testConnection() SMTP 实现
  - `src/cli.ts:256-340` -- sendTestEmail() SMTP 实现
  - `src/cli.ts:345-396` -- testChannel() 主流程

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] `npx @ulthon/ul-opencode-event test` 对纯钉钉配置通过三步验证
  - [ ] `--channel "DingTalk"` 能筛选钉钉通道
  - [ ] `--no-send` 对钉钉只做前两步

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: CLI validates and tests DingTalk channel end-to-end
    Tool: Bash (npx command)
    Preconditions: Valid dingtalk config file in project
    Steps:
      1. Run npx @ulthon/ul-opencode-event test
      2. Verify [1/3] Configuration is valid
      3. Verify [2/3] Connection successful (or appropriate status)
      4. If not --no-send: verify [3/3] Test message sent successfully
    Expected Result: Three-step validation passes for well-formed dingtalk config
    Failure Indicators: Validation fails; connection fails with cryptic error
    Evidence: .sisyphus/evidence/task-7-cli-e2e.txt
  ```

  **Commit**: YES (group with Task 6)
  - Message: `feat(cli): add DingTalk channel testing support`
  - Files: `src/cli.ts`

- [x] 8. **钉钉单元测试完整套件** (`tests/dingtalk.test.ts`) -- TDD 核心

  **What to do**:
  编写完整 TDD 测试套件，覆盖 dingtalk.ts 所有公开函数：
  - 使用 bun:test + mock.module() 预导入模式
  - Helper factories 定义在文件内
  - Console mock 用 try/finally 包裹

  **测试结构**:
  ```
  describe("createDingTalkSender")
    - returns null for non-dingtalk / disabled / missing webhook
    - returns sender for valid config
    - sender.send() calls fetch with correct URL/body
    - sender.send() adds sign params when secret provided
    - sender.close() resolves

  describe("generateSign")
    - produces valid base64 string
    - deterministic for same inputs

  describe("createDingTalkFormatter")
    - subject -> markdown title (truncated at 100)
    - body key:value -> bold labels
    - special char escaping
    - truncation at 4000 chars
    - atMobiles/atAll inclusion
  ```

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 1, 3

  **References**:
  - `tests/email.test.ts` -- mock.module() 预导入模式参考
  - `tests/handler.test.ts` -- helper factory 模式参考

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] `bun test tests/dingtalk.test.ts` → PASS (minimum 15 test cases)
  - [ ] 全 mock（无真实网络调用）

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full test suite passes with zero failures
    Tool: Bash (bun test)
    Steps:
      1. Run bun test tests/dingtalk.test.ts
      2. Exit code 0, all tests green, count >= 15
    Expected Result: All pass, good coverage
    Failure Indicators: Any failure; count < 10
    Evidence: .sisyphus/evidence/task-8-tests-pass.txt
  ```

  **Commit**: YES (group with Task 3)
  - Message: `test(dingtalk): add comprehensive TDD test suite`
  - Files: `tests/dingtalk.test.ts`

- [x] 9. **Handler 重构测试更新** (`tests/handler.test.ts`)

  **What to do**:
  更新现有 handler 测试以适配重构后的多通道接口：
  - 现有 SMTP 测试应继续通过（向后兼容）
  - 新增测试用例覆盖：
    - SMTP + DingTalk 混合配置的初始化
    - Formatter 层被正确调用
    - DingTalk sender 的 send/close 生命周期
    - 无 formatter 渠道的 fallback 路径
    - 多通道并发发送无互相干扰
  - 如果现有测试因接口变更而失败，修复断言（不改行为）

  **Must NOT do**:
  - 不删除或简化现有的 SMTP 测试用例
  - 不改变 mock 策略（保持 mock.module() 预导入模式）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 3 (with Tasks 10, 11, 12)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 5, 8

  **References**:
  - `tests/handler.test.ts` -- 现有测试文件（需在其上扩展）
  - Task 5 的 QA 场景 -- 作为新测试用例的基础

  **Acceptance Criteria**:

  **If TDD**:
  - [ ] 所有原有 SMTP 测试仍然通过
  - [ ] 新增 >= 5 个多通道相关测试用例
  - [ ] `bun test tests/handler.test.ts` → PASS

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: All existing handler tests still pass after refactoring
    Tool: Bash (bun test)
    Steps:
      1. Run bun test tests/handler.test.ts
      2. Verify exit code 0
      3. Count total tests (should be original count + new tests)
    Expected Result: Zero failures; all original tests still green
    Failure Indicators: Any original test broken by refactoring
    Evidence: .sisyphus/evidence/task-9-handler-tests.txt
  ```

  **Commit**: YES (group with Task 8 or standalone)
  - Message: `test(handler): update tests for multi-channel architecture`
  - Files: `tests/handler.test.ts`

- [x] 10. **配置校验钉钉测试** (`tests/config.test.ts` 扩展或新增)

  **What to do**:
  在现有 config 测试中增加钉钉相关的配置校验测试：
  - 有效 dingtalk 配置通过校验
  - 缺少 webhook 的 dingtalk 配置被拒绝
  - 无效 URL 格式被检测
  - at 字段的可选性验证
  - 全局 + 项目级 dingtalk 配置合并正确

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 3 (with Tasks 9, 11, 12)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 6

  **References**:
  - `tests/config.test.ts` -- 现有配置测试文件

  **Acceptance Criteria**:
  - [ ] `bun test tests/config.test.ts` → PASS (含新增钉钉测试)
  - [ ] 新增 >= 4 个钉钉配置测试用例

  **Commit**: YES (group with Task 6)
  - Message: `test(config): add DingTalk configuration validation tests`
  - Files: `tests/config.test.ts`

- [ ] 11. **CLI 钉钉测试** (`tests/` 或集成到现有 CLI 测试)

  **What to do**:
  为 CLI 的钉钉功能编写测试：
  - validateChannel 对 dingtalk 类型的校验逻辑
  - testConnection / sendTestMessage 的 mock 测试（mock fetch）
  - testChannel 完整流程（mock 版本，不真实发送）
  - --channel 参数筛选 dingtalk 通道
  - --no-send 跳过第三步

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 12)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 7

  **References**:
  - `src/cli.ts:77-396` -- 所有需要测试的函数

  **Acceptance Criteria**:
  - [ ] CLI 钉钉测试 ≥ 5 个用例
  - [ ] 全部 mock（无真实网络请求）
  - [ ] `bun test` 包含这些测试时全部通过

  **Commit**: YES (group with Task 7)
  - Message: `test(cli): add DingTalk channel CLI testing support`
  - Files: `tests/cli-dingtalk.test.ts` (new) or additions to existing

- [x] 12. **README 钉钉文档**

  **What to do**:
  在 README.md 中增加钉钉通道的完整配置文档：

  **新增章节**:
  - Roadmap 表格中 DingTalk 状态从 "Planned" 改为 "Available"
  - 钉钉配置示例（最小配置 + 完整配置）
  - DingTalk Config 字段说明表（webhook, secret, at）
  - 钉钉消息格式说明（Markdown 子集限制）
  - @人功能使用说明
  - 如何获取 Webhook 地址和 Secret 的步骤指引
  - 常见问题（签名失败、频率限制、Markdown 格式问题）

  **更新内容**:
  - keywords 增加 "dingtalk"
  - description 中提及多通道支持

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 3, 6, 7 (实现完成后才能写准确文档)

  **References**:
  - `README.md` -- 现有文档结构（SMTP 章节作为格式参考）

  **Acceptance Criteria**:
  - [ ] README 包含完整的钉钉配置章节
  - [ ] 配置示例可复制粘贴直接使用
  - [ ] 字段说明表完整（字段/类型/必填/说明）

  **Commit**: YES (standalone)
  - Message: `docs: add DingTalk robot channel documentation`
  - Files: `README.md`

- [x] 13. **多通道架构开发文档** (`docs/dingtalk-channel.md`) -- 新文件

  **What to do**:
  在 `docs/` 目录下创建钉钉通道的开发参考文档，供后续开发者（包括未来的自己）扩展新渠道时查阅。内容应包含：

  **a) 架构总览** (~30 行):
  - 多通道架构图（ASCII 或文字描述）
  - 核心组件关系：Channel → ChannelSender + ChannelFormatter → Handler
  - 数据流：EventPayload → Template Render → Format → Send

  **b) 接口规范** (~40 行):
  - `ChannelSender` 接口定义和使用约定
  - `ChannelFormatter` 接口定义和返回值规范
  - 如何实现一个新的 Sender（必须/可选方法、错误处理约定）
  - 如何实现一个新的 Formatter（输入输出格式、纯函数要求）

  **c) 钉钉实现细节** (~50 行):
  - 签名算法完整步骤（HmacSHA256 的参数拼接、编码流程）
  - Markdown 格式化规则（特殊字符转义表、截断策略）
  - HTTP 请求规格（endpoint、headers、body 结构、超时）
  - 错误码处理表（errcode 含义和应对策略）
  - @人功能的配置方式和 payload 结构

  **d) 扩展指南** (~30 行):
  - "加一个新渠道"的 checklist（从零到可用的步骤清单）
  - 需要修改的文件列表和每处的改动要点
  - 常见陷阱：延迟导入约定、DNS 预解析（仅 SMTP 需要）、mock.module() 测试模式
  - 参考：以钉钉实现为模板，标注哪些是通用的、哪些是钉钉特有的

  **e) 配置 schema** (~20 行):
  - 完整的 DingtalkConfig JSON Schema
  - Channel 接口中与钉钉相关的字段映射
  - 与 SMTP Config 的对比表

  **Must NOT do**:
  - 不重复 README 中的用户配置指南（那是给用户的，这是给开发者的）
  - 不包含敏感信息（真实 webhook URL、密钥等）
  - 不写成 API 自动生成的风格（保持人工撰写的技术文档质感）

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 技术文档写作，需要清晰的结构组织和准确的技术描述
  - **Skills**: []

  **Parallelization**:
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11, 12)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1-8 (所有核心实现完成后才能写准确的开发文档)

  **References**:

  **Pattern References**:
  - 本计划文件 `.sisyphus/plans/dingtalk-channel.md` -- 架构决策和设计理由的权威来源
  - `src/types.ts` -- 接口定义的源码位置
  - `src/dingtalk.ts` -- 实现细节的源码位置

  **Acceptance Criteria**:
  - [ ] 文档存在于 `docs/dingtalk-channel.md`
  - [ ] 包含完整的架构图/数据流说明
  - [ ] 包含接口规范（ChannelSender / ChannelFormatter）
  - [ ] 包含钉钉实现的详细技术细节（签名、格式化、HTTP 规格）
  - [ ] 包含"加新渠道" checklist
  - [ ] 开发者阅读后能独立完成一个新渠道的添加

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Development document exists and is comprehensive
    Tool: Read tool (file review)
    Steps:
      1. Read docs/dingtalk-channel.md from start to end
      2. Verify all 5 sections (a-e) are present with content
      3. Check architecture section has component relationship description
      4. Check interface section has type signatures or close approximations
      5. Check extension guide has actionable checklist (not vague advice)
    Expected Result: Complete, well-structured dev doc covering all required sections
    Failure Indicators: Missing sections; too vague to be useful; copies README content
    Evidence: .sisyphus/evidence/task-13-doc-review.txt
  ```

  **Commit**: YES (standalone)
  - Message: `docs: add multi-channel architecture development reference for DingTalk channel`
  - Files: `docs/dingtalk-channel.md`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run typecheck` + `npm run lint` + `npm run test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop patterns.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration (SMTP + DingTalk coexistence, config merge with both channel types). Test edge cases: disabled dingtalk, invalid webhook, missing secret, empty body, very long content. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 -- everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

