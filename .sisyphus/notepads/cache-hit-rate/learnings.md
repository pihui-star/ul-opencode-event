## Learnings

## 2026-05-01 Pre-session Research

- cacheRead/cacheWrite 已在 handler.ts:216-257 完整追踪（session/total/project 三级）
- TokenBreakdown.total = input + output + cacheRead + cacheWrite（不含 reasoning）
- 模板引擎 template.ts:10 对 undefined 变量渲染为空字符串 → cache hit rate 必须无条件注册
- locales.ts 有 18 个 Token 行，其中 16 个需要更新（排除 created 的 2 个）
- session 级聚合用"最后一条非零消息"，total 级用"所有已完成消息累加"
- 用户决定默认模板显示 session 级（当前会话最有参考意义）

## 2026-05-01 Task 1 Implementation

- `calcCacheHitRate()` 放在 `formatTokenCount()` 之后（line 103-116），遵循相同的 export + 独立纯函数模式
- TokenBreakdown 需要显式 import（原 imports 不含此类型）
- 3 个新变量（sessionCacheHitRate/totalCacheHitRate/projectCacheHitRate）无条件注册（无 `!= null` guard），因为 `calcCacheHitRate(undefined)` 返回 "N/A"
- 变量插入点：在 projectTokensTotalHuman 之后、`// 静态系统变量` 之前
- handler.ts 中已有 recorder.test.ts 和 updater.test.ts 的预存失败（17 个），与本次改动无关
- typecheck 和 473 pass 确认改动正确
