# Learnings

## Project Conventions
- ESM only, NodeNext module resolution, imports must use `.js` extension
- `strict: true`, target ES2022
- Lazy import pattern: no top-level import of nodemailer in library code
- Tests use Bun test (`bun:test`), mock via `mock.module()` and `mock()`
- Template: simple `{{variable}}` regex replacement (`/\{\{(\w+)\}\}/g`)
- Config merge: global + project, channels by name, top-level fields by `??` fallback

## Key Findings
- `updater.ts` has `getCurrentVersion()` for plugin version - MUST reuse
- SDK Session type has `version: string` field for OpenCode version
- `handler.ts` variables map built at lines 119-190 - new vars go here
- `recorder.ts` is passive consumer - no changes needed
- `template.ts` renderTemplate() can be reused for custom var resolution

## Variable Resolution Order
1. Build all built-in variables (system + event + token)
2. Resolve custom variable values against built-in vars (single-pass renderTemplate)
3. Merge custom vars into variables map (custom overrides built-in)
