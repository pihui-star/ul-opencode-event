# Decisions

## 2026-04-18 Planning Phase
- Format: JSON Lines (每行一条事件)
- Switch: 始终开启，不可关闭
- Variable scope: 全部 variables 对象（~42字段，含衍生字段）
- Rotation: 2MB, truncate-in-place
- File: `~/.local/share/opencode/ul-opencode-event-variables.jsonl`
- Import: 标准 `import * as fs` (不使用 createRequire)
- undefined handling: JSON.stringify 自然省略，不改

