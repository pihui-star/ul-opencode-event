# 邮件 IPv6 支持问题排查与修复计划

## 背景与已确认事实
- 现有发送链路在 `src/email.ts` 与 `src/cli.ts` 中创建 SMTP 连接时，没有显式传递地址族策略参数（如 `family/hints/order`）。
- 当前行为主要继承 nodemailer 默认 DNS 解析策略：优先 `resolve4`，仅在 IPv4 为空时才尝试 IPv6。
- 因此在 A 与 AAAA 同时存在时，表现通常是“总走 IPv4”，容易被感知为“不支持 IPv6”。
- 项目文档中有“自动支持 IPv4/IPv6”的描述，和实际“IPv4 优先”行为存在认知偏差。

## 目标
- 明确“仅 IPv4”是策略偏好还是真实不支持。
- 在不破坏默认兼容性的前提下，提供可配置的地址族行为（至少支持自动、IPv4 优先、IPv6 优先、仅 IPv4、仅 IPv6）。
- 同步测试与文档，确保行为可验证、可解释。

## 方案概览
1. 在配置层增加 SMTP 地址族策略字段（例如 `ipMode`）。
2. 在 SMTP 发送实现中根据 `ipMode` 显式构造 nodemailer 连接参数（必要时自定义 `getSocket` 以强控策略）。
3. 在 CLI 测试发送链路同步同一策略，避免双实现行为不一致。
4. 补充单元测试与集成测试，覆盖双栈域名、仅 AAAA、仅 A、本地无 IPv6 接口等场景。
5. 更新 README：把“自动支持”改为“可配置策略 + 默认行为说明”。

## 详细执行步骤

### 步骤 1：配置与类型扩展
- 更新 `src/types.ts` 的 SMTP 配置，新增 `ipMode` 枚举：
  - `auto`（默认，保持兼容）
  - `prefer_ipv4`
  - `prefer_ipv6`
  - `ipv4_only`
  - `ipv6_only`
- 更新 `src/config.ts`：校验 `ipMode` 合法值并提供默认值。

### 步骤 2：发送链路策略落地
- 更新 `src/email.ts`：
  - 将 `ipMode` 映射为连接策略参数。
  - 当选择强约束模式（`ipv4_only` / `ipv6_only`）时，显式控制解析与连接地址族。
  - 保留 `localAddress` 的优先显式绑定能力。
- 更新 `src/cli.ts`：
  - 与 `src/email.ts` 保持同一策略映射，消除 `secure` 与地址族逻辑差异。

### 步骤 3：测试完善
- 更新 `tests/email.test.ts`：
  - 断言不同 `ipMode` 下传给 transport 的关键参数与行为。
- 增加针对解析路径的测试（可通过 mock DNS / mock transport 实现）：
  - A+AAAA 场景下的优先级行为；
  - 仅 AAAA 或仅 A 场景；
  - 指定 `localAddress` 与 `ipMode` 冲突时的处理规则。
- 回归执行全量测试，确保不影响现有事件通知流程。

### 步骤 4：文档修正
- 更新 `README.md`：
  - 明确默认策略不是“并行择优”，而是“可配置优先级/约束”。
  - 给出 `ipMode` 配置示例与排障建议。
- 更新 `examples/ul-opencode-event.json`：
  - 增加 `ipMode` 示例组合。

## 验证标准
- 代码层：测试全部通过，且新增策略分支覆盖通过。
- 行为层：在模拟双栈场景下可观测到 `prefer_ipv6` 与 `ipv6_only` 的差异。
- 文档层：README 不再产生“默认一定会优先 IPv6 或并行”误解。

## 风险与回滚
- 风险：不同 Node/nodemailer 版本在 DNS 细节上存在平台差异。
- 缓解：将策略核心放在项目侧显式控制，不依赖隐式默认。
- 回滚：若出现兼容问题，`ipMode` 默认保持 `auto`，可快速退回现有行为。
