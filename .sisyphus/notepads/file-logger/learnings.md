# File Logger Module - Learnings

## 2026-04-07: Initial Implementation (src/logger.ts)

### Design Decisions
- **Synchronous I/O**: All `fs` operations use Sync variants (`appendFileSync`, `statSync`, etc.) to avoid async complexity in a logging utility
- **Silent failure pattern**: Every fs operation wrapped in try/catch; write failures fall back to console output (except debug which is silently dropped)
- **Truncation strategy**: Keep the second (newer) half of content when file exceeds maxSize. Search for nearest `\n` from midpoint to preserve line boundaries. Prepend `[TRUNCATED] ... old logs dropped\n` marker.
- **Auto path resolution**: Checks `OPENCODE_DATA_DIR` env var first, then falls back to `<homedir>/.local/share/opencode/ul-opencode-event.log`
- **Directory creation on init**: `mkdirSync(dir, { recursive: true })` called during `createLogger()` so first write doesn't fail from missing dir

### Exported API
| Export | Type | Description |
|--------|------|-------------|
| `LogLevel` | type | `'debug' \| 'info' \| 'warn' \| 'error'` |
| `LoggerConfig` | interface | Config options for factory |
| `Logger` | interface | Log method contract |
| `createLogger()` | function | Factory, returns `Logger` instance |
| `logger` | const | Default instance with `[ul-opencode-event]` prefix |
| `DEBUG_ENABLED` | const | Boolean derived from env var |

### Integration Notes
- Replaces duplicated `LOG_PREFIX`, `DEBUG_ENABLED`, and inline debugLog() functions currently in index.ts, email.ts, dingtalk.ts
- Existing code uses `require('node:fs')` inside functions (lazy) — logger.ts uses static ESM imports since it's a utility module with no nodemailer conflict concern
- File name changed from `ul-opencode-event-debug.log` (old) to `ul-opencode-event.log` (new) — this is intentional; the new logger handles all levels not just debug

### Constants
- Default max size: 2 MB (`2 * 1024 * 1024`)
- Default prefix: `[ul-opencode-event]`
- Debug env var: `UL_OPENCODE_EVENT_DEBUG` (accepts `'1'` or `'true'`)
