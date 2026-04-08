# Auto-Update Decisions

## [2026-04-08] Architecture
- New module: src/updater.ts (single file, all update logic)
- Trigger: session.created event, first main session only
- Cache: JSON file in OpenCode data dir, 24h TTL
- Config: auto_update boolean, default true, optional field
