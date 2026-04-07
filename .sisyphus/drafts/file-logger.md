# Draft: File-Based Logging System

## Requirements (confirmed)
- **Log scope**: Full-level logging (DEBUG / INFO / WARN / ERROR)
- **Rotation**: Single file + size cap (default 2MB, truncate when exceeded)
- **Implementation**: Zero dependencies (node:fs + node:path only)
- **New module**: `src/logger.ts` — shared across all source files

## Technical Decisions
- **Log file location**: `<opencode-data-dir>/ul-opencode-event.log` (same dir as opencode.db)
- **DEBUG mode**: Controlled by existing `UL_OPENCODE_EVENT_DEBUG` env var
- **INFO/WARN/ERROR**: Always written to file (no env var needed to enable)
- **Max size**: Configurable via `UL_OPENCODE_EVENT_LOG_MAX_SIZE` env var (bytes), default 2MB
- **Truncate strategy**: When file exceeds max size, overwrite from beginning (keep tail/newest entries)
- **Format**: `ISO-timestamp [LEVEL] message`
- **Existing console.log/warn/error calls**: Keep as-is for non-TUI usage; logger.write() is additional file output

## Log Level Usage Plan
| Level | When | Example |
|-------|------|---------|
| DEBUG | Event receipt, sessionMap state, handler dispatch details | `[EVENT] type=session.created id=ses_xxx title="..."` |
| INFO | Notification sent summary | `Notification sent: idle → smtp:primary (ses_xxx)` |
| WARN | Config issues, fallback behaviors | `Channel 'backup' failed to initialize, skipping` |
| ERROR | Send failures, unexpected errors | `Failed to send email: SMTP connection refused` |

## Scope Boundaries
- INCLUDE: New src/logger.ts module + integration into index.ts, handler.ts, email.ts, dingtalk.ts, config.ts
- EXCLUDE: Log viewer UI, remote logging, structured JSON format, log shipping
- EXCLUDE: Modifying test files (unless testing logger itself)
- EXCLUDE: Removing existing console.* calls (they stay for non-TUI contexts)

## Files to Modify
1. NEW: `src/logger.ts` — Logger implementation (~80-100 lines)
2. MODIFY: `src/index.ts` — Replace rough debugLog() with proper logger, add info/warn/error calls
3. MODIFY: `src/handler.ts` — Add info on dispatch, error on send failure
4. MODIFY: `src/email.ts` — Add debug on DNS/SMTP, error on failure
5. MODIFY: `src/dingtalk.ts` — Add debug on webhook, error on failure
6. MODIFY: `src/config.ts` — Add warn on config issues, error on parse failures
