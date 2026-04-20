
## session-cache.ts Learnings

- recorder.ts I/O pattern (createRequire + appendFileSync + rotation) is the gold standard for synchronous file persistence in this codebase
- SessionCacheEntry defined locally in session-cache.ts for now; will be moved to types.ts by Task 2
- buildCacheEntry replicates sumAllCompletedTokens exactly: only accumulate messages where input+output+cacheRead+cacheWrite > 0; total excludes reasoning
- loadSessionCache uses "latest-per-session wins" dedup via Map keyed by sessionId (later JSONL entries overwrite earlier)
- Skip [TRUNCATED] marker lines when loading cache
- Cost is accumulated per-message alongside tokens (only for messages with non-zero token usage)
