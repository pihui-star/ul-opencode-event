# Draft: Token Tracking Fix

## Requirements (confirmed)
- Token 值应在同一会话内单调递增，不应减少
- sessionTokensTotal = 本会话 token 总和
- totalTokensTotal = 本会话 + 所有子代理 token 总和
- 主会话可多次 idle-resume，token 数据应贯穿整个生命周期

## Research Findings

### Oracle 审计结果 (13 个问题)

| # | 严重度 | 问题 | 位置 |
|---|--------|------|------|
| 1 | CRITICAL | tokenDataMap.delete(sid) 在 idle 时清除累积数据 | index.ts:636 |
| 2 | HIGH | sessionMap 从不清理，内存无限增长 | index.ts:477 |
| 3 | HIGH | 子会话 token 数据在父会话聚合前被删除 | index.ts:636 |
| 4 | HIGH | aggregateSubSessions 只找直接子节点，遗漏嵌套子会话 | index.ts:305 |
| 5 | MEDIUM | session.created 重复处理安全（已由 flag 保护） | index.ts:494 |
| 6 | MEDIUM | undefined tokens 零填充可能掩盖数据问题 | index.ts:553 |
| 7 | MEDIUM | totalCostFormatted 在子会话聚合前设置（耦合脆弱） | index.ts:273 |
| 8 | MEDIUM | 子会话可能不在 sessionMap 中导致聚合跳过 | index.ts:304 |
| 9 | MEDIUM | 空 SessionTokenData 条目被创建 | index.ts:543 |
| 10 | LOW | 模块级 flag 跨重载持久化（预期行为） | index.ts:386 |
| 11 | LOW | formatTokenCount 对小数值取整 | handler.ts:41 |
| 12 | LOW | file.edited 无 sessionId 用于 token 查找 | index.ts:202 |
| 13 | LOW | 无 NaN/Infinity 保护 | index.ts:553 |

### 待补充: opencode-tokenscope 参考插件分析

## Technical Decisions
- 修复 #1 (CRITICAL): 不在 session.idle 时删除 tokenDataMap
- 修复 #2 (HIGH): 引入统一清理策略
- 修复 #3 (HIGH): 子会话数据在父会话聚合完成前保留
- 修复 #4 (HIGH): 支持嵌套子会话聚合

## Open Questions
- opencode-tokenscope 的 token 追踪策略待研究
