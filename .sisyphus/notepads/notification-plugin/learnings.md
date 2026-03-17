# Project Structure Learnings

## 2026-03-17: Initial Setup

### Package Configuration
- Package name: `@ulthon/ul-opencode-event`
- Type: ESM module (`"type": "module"`)
- Exports field configured for ESM compatibility

### Dependencies
- Production: `nodemailer` - for email notifications
- Dev: `@opencode-ai/plugin`, `@types/nodemailer`, `typescript`

### Build System
- Using bun as the build tool and runtime
- Target: bun
- TypeScript with strict mode enabled

### Directory Structure
```
ul-opencode-event/
├── src/           # Source code
├── tests/         # Test files
├── dist/          # Build output (gitignored)
├── .sisyphus/     # Project notes and evidence
└── node_modules/  # Dependencies (gitignored)
```

### Notes
- bun not found in system PATH, used npm as fallback for dependency installation
- Windows environment requires different directory creation commands

## 2026-03-17: Type Definitions Created

### Type System Design
- Created `src/types.ts` with comprehensive type definitions
- Uses TypeScript strict mode without any `any` types
- Supports multi-channel architecture (SMTP, Feishu, DingTalk)

### Key Type Patterns
1. **Union Types for Channel Config**: `ChannelConfig = SMTPConfig | FeishuConfig | DingtalkConfig`
2. **Optional Properties**: Used `?` for optional fields like `name`, `secure`, `recipients`
3. **Nested Object Types**: `auth` in `SMTPConfig`, `templates` in `Channel`

### Type Dependencies
- Required `bun-types` dev dependency for TypeScript type checking
- Types are pure definitions, no runtime validation logic

### Verification
- Type check passes with `npm run typecheck` (tsc --noEmit)
- All interfaces properly exported for use in other modules
  
## 2026-03-17: Documentation Created  
  
### README.md Structure  
- Installation section with npm install command  
- Configuration documentation with file locations (project-level and global)  
- Template variables reference with all available variables  
- Troubleshooting section for common issues 
  
## Configuration Example (Task 5)  
- Configuration uses JSON format with `channels` array  
- Each channel has: type, enabled, name, config, recipients, events, templates  
- Template variables use Mustache syntax: {{variableName}}  
- Events object controls which events trigger notifications 
  
## Test Utilities Created  
- mock-transport.ts: Uses jsonTransport with overridden sendMail for email capture  
- sample-configs.ts: Multiple test configurations (single, multi-channel, disabled, empty, minimal) 
  
## 2026-03-17: Template Engine Implemented  
  
### Implementation Approach  
- Single function: `renderTemplate(template: string, variables: Record<string, string | undefined>): string`  
- Uses regex `/\{\{(\w+)\}\}/g` to match {{variableName}} patterns  
- Missing/undefined variables replaced with empty string (using nullish coalescing `??`)  
- Implementation is 5 lines of actual code, 12 lines total with comments  
  
### Test Coverage  
- 8 tests covering all edge cases  
- Tests verify: single/multiple vars, missing vars, undefined values, empty template  
  
### Key Decisions  
- No external template library (Handlebars, EJS) - keep it simple  
- No validation for required variables - fail gracefully with empty strings  
- `\w+` in regex matches word characters (alphanumeric + underscore) 

## 2026-03-17: Config Loader Implementation

### Implementation Approach
- loadConfig() loads from global (~/.config/opencode/notification.json) and project (.opencode/notification.json or ./notification.json)
- Merge strategy: channels are merged by name field - project channels override global when names match
- Filtering: only enabled channels are returned (enabled: false excluded)
- Validation: only smtp type supported in phase 1
- Default config returns empty channels when no files exist

## 2026-03-17: Email Sender Implementation

### Implementation Approach
- Factory function: `createEmailSender(channel: Channel): EmailSender | null`
- Returns null for invalid channels (non-smtp, disabled, no recipients)
- Uses nodemailer.createTransport() with SMTPConfig
- Security options set via `transport.set('disableFileAccess', true)` and `transport.set('disableUrlAccess', true)`

### Key Patterns
1. **Type Guard Pattern**: Returns null instead of throwing for invalid channels
2. **Silent Failure**: Wrap send in try-catch, log error with timestamp but don't throw
3. **Closure for Config**: Transport and config captured in closure for send function

### Import Style
- Use `import * as nodemailer from 'nodemailer'` (not default import)
- Required for proper TypeScript compatibility

### Test Strategy
- Mock nodemailer module using `mock.module()` before importing email.ts
- Capture emails in array for assertion
- Mock sendMail behavior for failure scenarios

### Security Considerations
- disableFileAccess: Prevents loading local files into emails
- disableUrlAccess: Prevents loading remote URLs into emails
- Both set after transport creation

## 2026-03-17: Event Handler Implementation

### Implementation Approach
- Factory function: `createEventHandler(config: NotificationConfig): EventHandler`
- Returns object with `handle(eventType, payload)` method
- Iterates all channels, filters by `enabled !== false` and `events[eventType] !== false`

### Template Resolution
- Channel-specific templates take precedence: `channel.templates?.[eventType]`
- Falls back to default templates defined inline
- Default templates cover all 3 event types (created, idle, error)

### Channel Type Dispatch
- Uses switch statement with exhaustive check (`never` type) for type safety
- SMTP: calls `createEmailSender(channel).send(subject, body)`
- Feishu/DingTalk: silently skipped (no warning, just continue)
- Unknown types: console.warn logged

### Test Strategy with Mocking
- **Critical**: Use `mock.module()` to replace email module BEFORE importing handler
- Bun's mock.module allows intercepting imports at module load time
- Track sent emails in array for assertions
- Mock must handle null returns for invalid channels (disabled, non-smtp, no recipients)

### Key Test Cases
1. Event triggers all enabled channels
2. Disabled channel doesn't receive notification
3. Channel with disabled event type doesn't send
4. Event data passed to template correctly (verify rendered output)
5. Multiple channels all receive notification
6. Unsupported channel type is skipped silently
7. Default templates are used when channel has no custom templates
8. Empty channels array handled gracefully
9. Channel with no recipients handled gracefully
10. All three event types tested
11. Partial event config (undefined vs false)
12. Custom templates override defaults

### Variables for Templates
From EventPayload:
- eventType, timestamp, projectName, sessionId (always available)
- message, duration (for idle events)
- error (for error events)

## 2026-03-17: Test Fix - Body Template Missing Project Path

### Issue
- Test `session.created event triggers full notification flow` expected body to contain project path `/my-project`
- Default template only had `{{timestamp}}` and `{{sessionId}}`, missing `{{projectName}}`

### Solution
- Updated default template in `src/handler.ts` to include project path in body
- Changed: `'Task started at {{timestamp}}\nSession: {{sessionId}}'`
- To: `'Task started at {{timestamp}}\nProject: {{projectName}}\nSession: {{sessionId}}'`

### Rationale
- Adding project path to body makes notifications more informative
- Users viewing email body will know which project the task belongs to
- Consistent with subject line which already includes project name

### Verification
- All 8 tests pass after the fix
- Test command: `bun test tests/index.test.ts`

## 2026-03-17: Mock Module Strategy Fix for Bun Test

### Problem
- `mock.module('nodemailer', ...)` was not working in integration tests
- Root cause: Modules cached before mock is applied
- When tests run, bun test caches the module at file's top level execution

### Solution
Mock the higher-level module (`../src/email`) instead of the deep dependency (`nodemailer`)

### Why This Works
1. Test imports `createEmailSender` from mocked email module
2. Handler imports `createEmailSender` from same mocked module
3. No caching issue because we mock at the import boundary

### Mock Implementation Requirements
1. Mock returns same interface as real module: `createEmailSender(channel): EmailSender | null`
2. Mock must handle all edge cases the real module does:
   - Return null for non-smtp channels
   - Return null for disabled channels  
   - Return null for channels without recipients
3. Mock's `send` method must await behavior functions for proper error catching
4. Mock must use try-catch for silent failure (same as real implementation)

### Code Pattern
```typescript
// Mock the email module BEFORE importing handler
mock.module('../../src/email', () => ({
  createEmailSender: (channel: Channel): EmailSender | null => {
    if (channel.type !== 'smtp') return null;
    if (channel.enabled === false) return null;
    if (!channel.recipients || channel.recipients.length === 0) return null;

    return {
      async send(subject: string, body: string): Promise<void> {
        try {
          if (mockSendBehavior) {
            await mockSendBehavior();
            return;
          }
          capturedEmails.push({ subject, text: body, ... });
        } catch (error) {
          console.error(`[${timestamp}] [${name}] Failed:`, error);
        }
      },
    };
  },
}));

// Import AFTER mock
import { createEventHandler } from '../../src/handler';
import { createEmailSender } from '../../src/email'; // Gets mocked version
```

### Verification
- All 21 integration tests pass
- Tests properly capture emails in `capturedEmails` array
- Error scenarios work correctly with silent failure
""  
"## 2026-03-17: Manual QA Testing Complete"  
""  
"### QA Results Summary"  
"- All 73 tests pass (52 unit + 21 integration)"  
"- Code coverage: 98.39% (exceeds 80% requirement)"  
"- All QA scenarios verified successfully"  
""  
"### Test Categories Verified"  
"1. Project structure and configuration"  
"2. Type definitions and TypeScript strictness"  
"3. Configuration loading and merging"  
"4. Template rendering with variable replacement"  
"5. Email sending with mock transport"  
"6. Event handling and multi-channel support"  
"7. Full integration flow"  
""  
"### Manual Testing Results"  
"- Configuration loading: PASS (returns empty channels when no config)"  
"- Template rendering: PASS (variables replaced correctly)"  
"- Event handling: PASS (all event types work)"  
"- Build: PASS (40 modules bundled successfully)"  
"- Type check: PASS (no type errors)" 
