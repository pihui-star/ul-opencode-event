# Decisions

## 2026-04-18 Task: plan-generation

### D1: sessionTokens 使用 last-message 语义
- 原因: 匹配 OpenCode UI 行为（Go 源码用 `=` 覆盖，DB 数据精确匹配最后一条消息）
- 用户最初否定"最后一次调用"的描述，但数据分析证实确实如此

### D2: total 公式排除 reasoning
- 原因: OpenCode UI 不包含 reasoning 字段
- reasoning 在 TokenBreakdown 中保留（自定义模板可能使用）

### D3: 费用 cost 保持累计
- 原因: 费用是实际消耗的累计值，不应只用最后一次
