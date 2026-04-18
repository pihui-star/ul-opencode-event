# Learnings

## Task 1: recorder.ts creation (2026-04-18)

- Followed logger.ts patterns exactly: constants, path resolution, ensureDir, truncate, write+rotate
- Used lazy initialization for filePath (getFilePath pattern) to avoid top-level side effects at import time
- JSON.stringify naturally omits undefined values, so no special handling needed
- Single exported function `recordEventVariables` - no class, no factory, no config parameter
- TRUNCATE_MARKER is plain text (not JSON), consistent with logger.ts approach
- typecheck passes cleanly with zero errors

## Task 2: handler.ts refactoring - variables extraction (2026-04-18)

- Variables object (~42 fields) depends ONLY on `payload` and `formatTokenCount`, both available in handle() scope - safe to hoist out of channel loop
- Moving variables outside loop also means variables are built once per event instead of once per channel per event
- `recordEventVariables` is fire-and-forget (catches all errors internally), so calling it before the loop is safe - won't block channel dispatch
- recorder.ts uses `import * as fs from 'node:fs'` which Bun's test runner doesn't fully mock by default, causing `fs.appendFileSync is not a function` errors in test output - but these are non-fatal (caught by recorder's try/catch) and don't affect test results
- The 9 pre-existing test failures in updater.test.ts are unrelated (fs mock issues in updater module)
- Import added after existing logger import, following module import ordering convention
- Comment style: kept Chinese comments as-is in the moved block

## Task 3: recorder.ts createRequire fix (2026-04-18)

- Must use `createRequire` for fs (not `import * as fs from 'node:fs'`) because Bun's `mock.module('fs', ...)` in logger.test.ts is global and cascades through the import chain: handler.ts -> recorder.ts -> fs
- Same pattern as file.ts lines 11-19 which was created for the exact same reason
- The `createRequire` approach loads the real `node:fs` module bypassing Bun's mock registry
- Verified: 9 updater.test.ts failures are PRE-EXISTING (same count with and without recorder.ts changes), not caused by recorder
- `import * as path` and `import * as os` are safe to keep as standard imports - tests don't mock those

## Task 4: recorder.test.ts creation (2026-04-18)

- recorder.ts is a singleton module - `filePath` is cached lazily on first call to `getFilePath()`. Once cached, it cannot be reset from tests.
- In full test suite, handler.test.ts loads handler.ts -> recorder.ts before recorder.test.ts runs. If handler tests call `recordEventVariables`, filePath gets cached to the default homedir path, ignoring our `process.env.OPENCODE_DATA_DIR`.
- Solution: detect the actual file path by calling `recordEventVariables` once, then checking where the file appeared (TEMP_DIR or default path). Use that path for all subsequent tests.
- Test file must also use `createRequire` for fs, not `import * as fs from 'node:fs'` - same reason as recorder.ts itself: mock.module('fs') from logger.test.ts cascades.
- `afterEach` cleans up by deleting the file (not the directory), so the next test starts with no file but the directory still exists.
- Rotation test: pre-fill file to >2MB with valid JSON lines using `fs.openSync`/`fs.writeSync`, then call `recordEventVariables` to trigger rotation. Verify file starts with `[TRUNCATED]` marker.
- Full variable test: build a ~50-field variables object matching handler.ts lines 119-175 structure. Verify all expected keys present and undefined fields omitted.
- 7 test cases, 80 expect() calls, all pass standalone and in full suite (374 pass, 9 pre-existing updater failures).
- Added `__recorder_test__: 'yes'` marker to test data for safe cleanup in afterAll (only delete default-path file if it contains our markers).

