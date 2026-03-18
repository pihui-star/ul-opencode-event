# SMTP DNS 超时排查与修复计划（含 PHP/Python 对比验证）

## 背景结论
- 当前 `node dist/cli.js test` 报错为 `queryA ETIMEOUT smtp.163.com`，属于 Node 进程 DNS 解析超时。
- 系统层 `nslookup` 与 `Test-NetConnection 465` 已通过，说明网络并非完全不可达。
- 需要通过 PHP/Python 独立验证 DNS 与 SMTP，确认是否仅 Node 解析链路异常。

## 目标
1. 用 PHP/Python 在同机验证 DNS 解析与 SMTP 建连是否正常。
2. 明确根因范围：Node DNS 解析、网络策略、或目标服务侧限制。
3. 产出可落地修复：环境修复优先，代码增强兜底。

## 执行步骤
### 步骤 1：环境可用性检查
- 检查本机是否可用 `php`、`python`。
- 记录版本与运行路径，排除解释器本身异常。

### 步骤 2：PHP 验证 DNS 与 SMTP
- DNS：`dns_get_record('smtp.163.com', DNS_A + DNS_AAAA)`。
- SMTP TCP：`stream_socket_client('ssl://smtp.163.com:465', ...)`。
- 记录 DNS 返回、连接耗时、错误码与错误信息。

### 步骤 3：Python 验证 DNS 与 SMTP
- DNS：`socket.getaddrinfo('smtp.163.com', 465)`。
- SMTP：`smtplib.SMTP_SSL('smtp.163.com', 465, timeout=10)`（仅建连/helo，不发信）。
- 记录是否成功、异常类型与异常消息。

### 步骤 4：结果判定矩阵
- 若 PHP/Python 都正常：基本锁定 Node DNS 路径问题（解析器、IPv6 策略、超时策略）。
- 若都异常：偏向系统 DNS/网络策略问题（代理、VPN、防火墙、DNS 污染）。
- 若仅一个语言异常：检查该运行时 DNS 实现差异与系统调用路径。

### 步骤 5：修复实施（按优先级）
- 优先 A（环境）：调整系统 DNS（如 223.5.5.5/8.8.8.8），关闭 DNS 劫持型代理/VPN 后重测。
- 优先 B（运行时）：Node 启动增加 IPv4 优先（`NODE_OPTIONS=--dns-result-order=ipv4first`）后重测。
- 优先 C（代码增强）：在 CLI 连接测试前增加预解析与可读错误提示，必要时支持 host 解析失败时的备选策略（不影响现有配置兼容）。

### 步骤 6：回归验证
- 重跑 `node dist/cli.js test`。
- 校验日志输出是否从 DNS 超时变为可连接，或至少给出明确可操作错误原因。

## 交付物
- PHP 与 Python 的验证结果（成功/失败、错误详情）。
- 根因归类结论与建议优先级。
- 若进入代码增强：对应变更文件、验证结果与回归结论。
