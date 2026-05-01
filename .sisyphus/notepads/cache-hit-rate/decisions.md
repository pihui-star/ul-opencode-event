## Decisions

- 2026-05-01: 默认模板显示 sessionCacheHitRate（session 级），total/project 级仅注册供自定义模板使用
- 2026-05-01: 变量无条件注册（calcCacheHitRate(undefined) 返回 "N/A"，不做 != null 守卫）
- 2026-05-01: 一位小数精度 toFixed(1)，如 "89.5%"
- 2026-05-01: created 事件模板不改（无 token 数据）
