# Learnings

## 2026-04-19 Task 1+2+3: bun-sqlite.d.ts + db-preload.ts + index.ts integration
- bun:sqlite is a built-in Bun module, needs custom .d.ts type declaration
- SQLite WAL mode readonly is safe for concurrent access (industry standard)
- db-preload uses `import { Database } from 'bun:sqlite'` - only used in db-preload.ts, index.ts uses dynamic import
- dataDir from `process.env.OPENCODE_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'opencode')`
- SQL query: SELECT from message table with json_extract for role filtering, session subquery for recent sessions
- Token format conversion: DB `tokens.cache.read` -> TokenBreakdown `cacheRead`
- `bun test` known issues: 9 failures in updater.test.ts (pre-existing, unrelated to our changes)

## 2026-04-19 Task 4: Unit tests for db-preload - CRITICAL LESSONS
- **Bun mock.module is PROCESS-WIDE**: Any mock.module call affects ALL test files, not just the file that registered it
- **Do NOT mock '../src/logger'**: This replaces logger.error() with a no-op for ALL files, breaking dingtalk.test.ts and email.test.ts error-logging assertions
- **Do NOT mock 'fs' or 'node:fs'**: Even spreading full realFs breaks other tests (logger.test.ts partial mock interaction)
- **Solution for "DB not found" tests**: Removed fs.existsSync from db-preload.ts entirely; rely on Database constructor throwing for nonexistent files
- **Solution for mocking bun:sqlite**: Create real temp directory with empty opencode.db file; use require('node:fs') at top level to cache real fs before any mocks
- **Mock bun:sqlite constructor** checks fs.existsSync(filePath) to simulate real behavior (throws for nonexistent files)
- Final result: 384 pass / 9 fail (baseline 377 + 7 new tests = 384, 9 updater pre-existing)

## 2026-04-19 Task 5: Documentation updates
- event-data-flow.md: Added Section 6 (preloading), renumbered Section 6 -> 7
- token-zero-on-mid-event.md: Added preloading section + db-preload.ts to code table
- AGENTS.md: Added db-preload.ts to architecture tree + opencode.db note
