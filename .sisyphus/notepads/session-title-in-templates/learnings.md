## Task 1: Add sessionTitle to EventPayload (types.ts)
- Date: 2026-04-06 17:56
- Status: COMPLETED
- Changes:
  - Added sessionTitle?: string optional field to EventPayload interface (after parentSessionId)
  - Updated 	itle field JSDoc with @remarks clarifying it's only for question/permission events, not session-level titles
- Verification: 
npm run typecheck passes (exit code 0), lsp_diagnostics clean

## Task 2: Extract sessionTitle in eventToPayload + Tests
- Date: 2026-04-06
- Status: COMPLETED
- Changes:
  - **src/index.ts**: Added `sessionTitle: undefined` to basePayload; added extraction in all 9 branches (8 with values, file.edited stays undefined)
  - **src/handler.ts**: Added `sessionTitle: payload.sessionTitle` to template variables mapping (line ~89)
  - **src/locales.ts**: Added `{{sessionTitle}}` to all 16 templates (8 en + 8 zh, excluding fileEdited)
  - **tests/index.test.ts**: Added 3 assertions for 'Test Session' body content (created/idle/question); added session.created setup to question test
- Verification: bun test tests/index.test.ts -- 53 pass, 0 fail
- Key learning: New field pipeline = types -> extraction(index.ts) -> mapping(handler.ts) -> template(locales.ts). All 4 layers needed.
