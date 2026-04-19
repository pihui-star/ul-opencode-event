# Decisions

## 2026-04-19 Plan Decisions
- Variable granularity: Full breakdown (input/output/reasoning/cacheRead/cacheWrite/total + Human + formatted cost)
- Template format: Three-segment slash `Token(session/total/project) model`
- Project filtering: By projectPath at db-preload time
- Sessions without projectPath: NOT counted in project total (conservative)
- db-preload fallback: try-catch, old DB schema loads all sessions
- message.updated before session.created: Use ctx.directory as fallback
- Path comparison: Use path.normalize() before comparison
