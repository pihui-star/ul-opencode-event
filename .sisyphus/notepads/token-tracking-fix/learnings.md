## 2026-04-16 Session Start

### Conventions
- Test framework: bun test (NOT Jest/Vitest)
- ESM only, NodeNext module resolution
- Tests in tests/ directory
- Dynamic import for nodemailer (lazy)
- Session ID 不会复用，每个 session.created 都是全新 ID

### Key Decisions
- 不引入 completedSessions Set -- session ID 不复用，直接删掉 tokenDataMap.delete 即可
- 不处理 sessionMap 内存清理 -- 实际场景中不是问题
- 嵌套子会话用 sessionMap 传递闭包，不用 API 调用

### Root Cause
- index.ts L632-638: tokenDataMap.delete(sid) on session.idle resets accumulated data
- aggregateSubSessions L305: only finds direct children, misses nested sub-sessions
