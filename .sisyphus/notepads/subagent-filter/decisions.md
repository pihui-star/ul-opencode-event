# Subagent Filter - Decisions

## F2 Review (2026-04-06)

### 架构决策
1. **安全默认值**: `includeSubagentEvents` 默认 false（过滤子代理），用户需显式 opt-in 才能接收子代理通知 -- 防止通知风暴
2. **双条件判定**: `!== undefined && !== ''` 而非简单的 truthy 检查 -- 明确排除空串边界情况
3. **条件展开配置**: config.ts L189 使用 `...(field !== undefined && { field })` 仅在有定义时才包含字段 -- 保持输出干净
4. **9 个事件分支统一添加**: 每个 event type 的 return 对象都添加了 isSubagent/parentSessionId -- 保持 payload 结构一致
