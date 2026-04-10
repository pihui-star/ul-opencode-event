# 文档全面重组计划

## TL;DR

> **Quick Summary**: 全面重组 @ulthon/ul-opencode-event 项目的文档体系，精简 README、更新过时信息、删除废弃文件、修复源码过时注释。
> 
> **Deliverables**:
> - 精简后的 README.md（英文，~150行以内）
> - 重写后的 README_CN.md（中文，~150行以内）
> - 更新后的 AGENTS.md（反映3通道实现）
> - 新建 docs/smtp-channel.md（SMTP 邮箱通道完整文档）
> - 新建 docs/configuration.md（通用配置指南：文件位置、合并规则、事件配置）
> - 删除 CONFIG_CN.md 和 notes.md
> - 修复 src/ 中的过时注释和 package.json 描述
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (AGENTS.md) -> Task 2-6 (parallel) -> Task 7 (cleanup) -> verify

---

## Context

### Original Request
用户要求"重新整理一下所有的文档"。经过讨论确认：全面重组文档体系。

### Interview Summary
**Key Discussions**:
- 整理范围：用户选择"全面重组"
- README 中的重复内容：精简 README，配置引导到 docs/
- CONFIG_CN.md：用户认为不再需要，删除
- 中英文关系：中英文双语保留
- docs/ 语言：全部中文（已是中文，无需改动）
- 废弃文件处理：直接删除（不标记 deprecated）
- AGENTS.md：需要更新
- 源码过时注释：用户同意一并修复

**Research Findings**:
- Metis 探索确认 3 个通道（smtp、dingtalk、feishu）均已完整实现
- README.md L156-377（~220行）与 docs/ 下的钉钉/飞书文档完全重复
- AGENTS.md 架构描述缺少 dingtalk.ts、feishu.ts、formatters.ts 等 5 个文件
- src/formatters.ts L35 注释说"feishu: not implemented"（已实现）
- src/types.ts L51-52 注释说"Phase 1: Only SMTP"（已实现3通道）
- package.json description 遗漏 feishu

### Metis Review
**Identified Gaps** (addressed):
- 源码过时注释需一并修复：用户已确认同意
- AGENTS.md 必须最先更新：已作为 Task 1
- docs/ 文件内容准确无需修改：已确认为 EXCLUDE
- README_CN.md 应全新重写而非修补：已采纳

---

## Work Objectives

### Core Objective
将项目文档体系重组为清晰、准确、无重复的状态，同时修复源码中的过时注释。

### Concrete Deliverables
- 重写后的 `AGENTS.md`
- 精简后的 `README.md`
- 重写后的 `README_CN.md`
- 删除 `CONFIG_CN.md` 和 `notes.md`
- 修复 `src/formatters.ts`、`src/types.ts` 过时注释
- 更新 `package.json` description 和 keywords

### Definition of Done
- [ ] README.md 行数 <= 150 行
- [ ] README_CN.md 包含 smtp + dingtalk + feishu 三个通道的提及
- [ ] AGENTS.md 架构部分列出所有 13 个 src/ 文件
- [ ] grep "only smtp" / "not implemented" 在 AGENTS.md 中无匹配
- [ ] CONFIG_CN.md 和 notes.md 不存在
- [ ] 无文件包含指向 CONFIG_CN.md 的链接
- [ ] `npm run typecheck` 通过

### Must Have
- AGENTS.md 必须反映3通道已实现
- README 精简后仍包含快速开始和 SMTP 最小配置
- README 包含到 docs/ 下各文档的链接
- 所有文档信息准确，与实际代码一致

### Must NOT Have (Guardrails)
- 不修改 docs/ 下的 4 个文档（已验证准确）
- 不修改 src/ 中的逻辑代码（只改注释）
- 不添加新文档文件
- 不引入文档生成工具
- 不把 docs/ 翻译成英文

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: N/A (documentation-only task)
- **Automated tests**: None needed
- **Framework**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Documentation verification**: Use Bash (grep) - Search for stale claims, verify links, check line counts
- **Source code safety**: Use Bash - Run `npm run typecheck` after changes
- **File system**: Use Bash - Verify deletions, check file existence

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - highest priority):
+-- Task 1: Rewrite AGENTS.md [quick]
    Blocks: Tasks 2-7 (AGENTS.md guides subsequent work)

Wave 2 (After Wave 1 - parallel, independent):
+-- Task 2: Create docs/smtp-channel.md [unspecified-low]
+-- Task 3: Create docs/configuration.md [unspecified-low]
+-- Task 4: Trim README.md [unspecified-low]
+-- Task 5: Rewrite README_CN.md [unspecified-low]
+-- Task 6: Fix stale source code comments [quick]
    All parallel, no interdependencies

Wave 3 (After Wave 2 - cleanup):
+-- Task 7: Delete CONFIG_CN.md + notes.md [quick]

Wave FINAL (After ALL tasks):
+-- F1: Plan compliance audit [oracle]
+-- F2: Cross-reference integrity check [unspecified-high]
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 2,3,4,5,6,7 | 1 |
| 2 | 1 | 7 | 2 |
| 3 | 1 | 7 | 2 |
| 4 | 1 | 7 | 2 |
| 5 | 1 | 7 | 2 |
| 6 | 1 | - | 2 |
| 7 | 2,3,4,5 | F1, F2 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 1 task - T1 -> `quick`
- **Wave 2**: 5 tasks - T2 -> `unspecified-low`, T3 -> `unspecified-low`, T4 -> `unspecified-low`, T5 -> `unspecified-low`, T6 -> `quick`
- **Wave 3**: 1 task - T7 -> `quick`
- **FINAL**: 2 tasks - F1 -> `oracle`, F2 -> `unspecified-high`

---

## TODOs

- [x] 1. Rewrite AGENTS.md to Reflect Current Architecture

  **What to do**:
  - Rewrite `AGENTS.md` to accurately describe the current project
  - Update "项目概述" from "SMTP 邮件发送通知" to "多通道通知（SMTP 邮件、钉钉、飞书）"
  - Update "架构" section: add `dingtalk.ts`、`feishu.ts`、`formatters.ts` to the file listing
  - Remove the "仅实现了 smtp" claim; state that smtp、dingtalk、feishu are all implemented
  - Update "通道类型" section: remove the claim about feishu/dingtalk being unimplemented
  - Ensure architecture diagram lists all 13 src files: index.ts, types.ts, config.ts, handler.ts, email.ts, dingtalk.ts, feishu.ts, formatters.ts, template.ts, locales.ts, cli.ts, logger.ts, updater.ts
  - Update "发布" section to reflect current files included in npm package
  - Keep the existing format/structure but with corrected content

  **Must NOT do**:
  - Do not change the general structure/sections of AGENTS.md (keep it familiar)
  - Do not add documentation about individual channel internals (that's in docs/)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file rewrite with clear instructions, content is well-defined
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (solo)
  - **Blocks**: Tasks 2, 3, 4, 5, 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `AGENTS.md` - Current format/structure to preserve
  - `src/` directory listing - To verify all source files

  **API/Type References** (contracts to implement against):
  - `src/types.ts` - ChannelType union type, all type definitions
  - `src/config.ts` - SUPPORTED_CHANNEL_TYPES array (ground truth for supported channels)
  - `src/formatters.ts` - Formatter registration (proves all 3 channels have formatters)
  - `src/handler.ts` - Channel dispatch (proves all 3 channels are wired)

  **Test References**: N/A

  **External References**: N/A

  **WHY Each Reference Matters**:
  - `src/types.ts`: Contains the actual ChannelType definition - this is the ground truth for what channels exist
  - `src/config.ts` SUPPORTED_CHANNEL_TYPES: Proves which channels pass validation
  - `src/formatters.ts`: Shows formatters registered for smtp/dingtalk/feishu
  - `src/handler.ts`: Shows the dispatch logic for all 3 channels

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: AGENTS.md accurately reflects all implemented channels
    Tool: Bash (grep)
    Preconditions: AGENTS.md has been rewritten
    Steps:
      1. grep -i "only smtp" AGENTS.md -> must return empty
      2. grep -i "not implemented" AGENTS.md -> must return empty
      3. grep "dingtalk" AGENTS.md -> must return at least 1 match
      4. grep "feishu" AGENTS.md -> must return at least 1 match
      5. grep "formatters" AGENTS.md -> must return at least 1 match
    Expected Result: No false claims about unimplemented channels; all 3 channels mentioned
    Failure Indicators: grep finds "only smtp" or "not implemented"
    Evidence: .sisyphus/evidence/task-1-agents-accuracy.txt

  Scenario: AGENTS.md architecture section is complete
    Tool: Bash (grep)
    Preconditions: AGENTS.md has been rewritten
    Steps:
      1. grep "index.ts" AGENTS.md -> match
      2. grep "types.ts" AGENTS.md -> match
      3. grep "config.ts" AGENTS.md -> match
      4. grep "handler.ts" AGENTS.md -> match
      5. grep "email.ts" AGENTS.md -> match
      6. grep "dingtalk.ts" AGENTS.md -> match
      7. grep "feishu.ts" AGENTS.md -> match
      8. grep "formatters.ts" AGENTS.md -> match
      9. grep "template.ts" AGENTS.md -> match
      10. grep "locales.ts" AGENTS.md -> match
      11. grep "cli.ts" AGENTS.md -> match
    Expected Result: All source files referenced in architecture section
    Evidence: .sisyphus/evidence/task-1-agents-architecture.txt
  ```

  **Commit**: YES
  - Message: `docs: rewrite AGENTS.md to reflect 3-channel implementation`
  - Files: `AGENTS.md`
  - Pre-commit: none

---

- [x] 2. Create docs/smtp-channel.md (SMTP Email Channel Documentation)

  **What to do**:
  - Create a new file `docs/smtp-channel.md` covering SMTP email channel configuration
  - Structure it similarly to `docs/dingtalk-channel.md` for consistency (user guide + implementation details)
  - Extract relevant content from the current `README.md` and `CONFIG_CN.md` (which will be deleted)
  - Content to include:

  **Part 1: User Configuration Guide:**
  - How to get SMTP credentials (authorization codes for QQ/163, App Passwords for Gmail)
  - Minimal configuration example
  - Full configuration example
  - Common SMTP servers table (QQ, 163, Gmail, Outlook)
  - Channel configuration fields table
  - SMTP configuration fields table (host, port, secure, localAddress, auth)
  - IPv4/IPv6 configuration (force IPv4, force IPv6, use IPv6 address as host)
  - Multi-channel configuration example (multiple SMTP accounts)
  - FAQ (wrong password, wrong port, firewall, IPv6 issues, debug mode, no notifications)

  **Part 2: Internal Implementation Details (optional, brief):**
  - DNS pre-resolution mechanism (for proxy/TUN environments)
  - Nodemailer lazy import pattern
  - Connection model (persistent transport pool)

  - Write entirely in Chinese (consistent with other docs/ files)
  - Cross-link to `docs/template-configuration.md` for template details
  - Cross-link to `docs/configuration.md` for general config file locations and merge rules

  **Must NOT do**:
  - Do not copy content verbatim from CONFIG_CN.md without updating (some is outdated)
  - Do not include template variable details (those belong in docs/template-configuration.md)
  - Do not include events configuration table (that belongs in README)
  - Do not include configuration file locations/merge rules (those belong in docs/configuration.md)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: New file creation based on existing content, structured writing task
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 4, 5, 6)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References** (existing code to follow):
  - `docs/dingtalk-channel.md` - Structure template: user guide + implementation details format
  - `docs/feishu-channel.md` - Alternative structure reference
  - `README.md` L56-155 - Current SMTP configuration content to extract
  - `CONFIG_CN.md` L46-76 - Authorization code acquisition guides (QQ/163/Gmail)
  - `CONFIG_CN.md` L187-244 - IPv4/IPv6 configuration
  - `CONFIG_CN.md` L246-308 - Multi-channel config and merge rules

  **API/Type References**:
  - `src/types.ts` - SMTPConfig interface (ground truth for config fields)
  - `src/email.ts` - Implementation details (DNS pre-resolution, nodemailer usage)

  **WHY Each Reference Matters**:
  - `docs/dingtalk-channel.md`: The new SMTP doc should follow the same structure pattern for consistency
  - `README.md` L56-155: Contains the SMTP content to extract and reorganize
  - `CONFIG_CN.md`: Contains Chinese-language content about authorization codes, IPv4/IPv6, merge rules
  - `src/types.ts` SMTPConfig: Ensures documentation matches actual type definitions
  - `src/email.ts`: Implementation details for the "internal details" section

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: smtp-channel.md exists and covers essential content
    Tool: Bash (grep)
    Preconditions: docs/smtp-channel.md has been created
    Steps:
      1. test -f docs/smtp-channel.md -> must succeed
      2. grep "smtp.qq.com" docs/smtp-channel.md -> must match (common servers table)
      3. grep "IPv4\|IPv6\|localAddress" docs/smtp-channel.md -> must match
      4. grep "授权码\|authorization" docs/smtp-channel.md -> must match
      5. grep "配置合并\|merge" docs/smtp-channel.md -> must match
    Expected Result: SMTP doc covers servers, IPv4/IPv6, auth codes, and merge rules
    Failure Indicators: Missing key topics
    Evidence: .sisyphus/evidence/task-2-smtp-channel.txt

  Scenario: smtp-channel.md is consistent with dingtalk/feishu docs structure
    Tool: Bash (grep)
    Preconditions: docs/smtp-channel.md has been created
    Steps:
      1. grep "用户配置指南\|配置指南" docs/smtp-channel.md -> must match (has user guide section)
      2. grep "channel-development.md" docs/smtp-channel.md -> must match (cross-links to dev guide)
      3. wc -l docs/smtp-channel.md -> should be between 150-350 lines (similar to dingtalk 333 lines)
    Expected Result: Structure consistent with other channel docs
    Evidence: .sisyphus/evidence/task-2-smtp-channel-structure.txt
  ```

  **Commit**: YES
  - Message: `docs: add SMTP email channel documentation`
  - Files: `docs/smtp-channel.md`
  - Pre-commit: none

---

- [x] 3. Create docs/configuration.md (General Configuration Guide)

  **What to do**:
  - Create a new file `docs/configuration.md` covering general configuration mechanics
  - This document is channel-agnostic -- explains how configuration works for ALL channels
  - Content to include:

  - **Configuration file locations** (priority order):
    1. Project-level: `.opencode/ul-opencode-event.json` or `./ul-opencode-event.json`
    2. Global: `~/.config/opencode/ul-opencode-event.json`
    - Windows paths: `%USERPROFILE%\.config\opencode\ul-opencode-event.json`
  - **Configuration merge rules**:
    - Channels merged by `name` field
    - Same name: project-level overrides global-level
    - Different names: appended together
    - Top-level fields (`language`, `timezone`): project-level takes priority
    - Merge example: global has A,B + project has B,C = final: A(global) + B(project) + C(project)
  - **Events configuration**: which events are available, default values, per-channel override
  - **Template overview**: how templates work (brief, with link to docs/template-configuration.md)
  - **Global vs project installation**: npm install -g vs project install, how they relate to config locations
  - **Debug mode**: `UL_OPENCODE_EVENT_DEBUG=1` environment variable

  - Write entirely in Chinese
  - Cross-link to individual channel docs (smtp-channel.md, dingtalk-channel.md, feishu-channel.md) for channel-specific config
  - Cross-link to docs/template-configuration.md for template details

  **Must NOT do**:
  - Do not duplicate channel-specific configuration (SMTP fields, DingTalk webhook, etc.) -- those belong in channel docs
  - Do not include implementation details -- this is a user-facing guide

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: New file creation, structured writing from existing scattered content
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 4, 5, 6)
  - **Blocks**: Task 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `README.md` L56-62 - Current configuration file location description
  - `CONFIG_CN.md` L5-14 - Chinese configuration file location description
  - `CONFIG_CN.md` L294-308 - Merge rules description
  - `src/config.ts` - Implementation of config loading and merging (ground truth)
  - `AGENTS.md` - Architecture reference for config behavior

  **API/Type References**:
  - `src/types.ts` - NotificationConfig, EventConfig types
  - `src/config.ts` - SUPPORTED_CHANNEL_TYPES, loadConfig() function

  **WHY Each Reference Matters**:
  - `CONFIG_CN.md`: Has Chinese content for config locations and merge rules to reuse
  - `src/config.ts`: Ground truth for how config is actually loaded and merged
  - `src/types.ts`: Defines the actual shape of configuration objects

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: configuration.md covers all general config topics
    Tool: Bash (grep)
    Preconditions: docs/configuration.md has been created
    Steps:
      1. test -f docs/configuration.md -> must succeed
      2. grep "opencode/ul-opencode-event.json" docs/configuration.md -> must match (config paths)
      3. grep "合并\|merge" docs/configuration.md -> must match (merge rules)
      4. grep "name.*字段\|按.*合并" docs/configuration.md -> must match (merge by name)
      5. grep "projectName\|language\|timezone" docs/configuration.md -> must match (top-level fields)
      6. grep "smtp-channel\|dingtalk-channel\|feishu-channel" docs/configuration.md -> must match (cross-links)
    Expected Result: General config doc covers locations, merge, events, and cross-links to channels
    Evidence: .sisyphus/evidence/task-3-configuration.txt

  Scenario: configuration.md is channel-agnostic
    Tool: Bash (grep)
    Preconditions: docs/configuration.md has been created
    Steps:
      1. grep "smtp.qq.com" docs/configuration.md -> must NOT match (no SMTP-specific content)
      2. grep "webhook" docs/configuration.md -> must NOT match (no DingTalk/Feishu-specific content)
    Expected Result: No channel-specific configuration details
    Evidence: .sisyphus/evidence/task-3-configuration-generic.txt
  ```

  **Commit**: YES
  - Message: `docs: add general configuration guide`
  - Files: `docs/configuration.md`
  - Pre-commit: none

---

- [x] 4. Trim README.md (English)

  **What to do**:
  - Remove the full DingTalk configuration section (approximately L156-277)
  - Remove the full Feishu configuration section (approximately L279-377)
  - Replace removed sections with brief mentions + links to `docs/dingtalk-channel.md` and `docs/feishu-channel.md`
  - Also trim the detailed SMTP configuration: replace with minimal example + link to `docs/smtp-channel.md`
  - Remove IPv4/IPv6 detailed configuration (now in docs/smtp-channel.md)
  - Keep: project header, Why section, Roadmap, Quick Start, Installation, minimal SMTP config example, Events table, Template Variables table, CLI section, Troubleshooting (brief), Local Development, License
  - Add a "Documentation" section that links to all docs/ files (including the new smtp-channel.md)
  - Verify final file is under 150 lines
  - Ensure all relative links are valid

  **Must NOT do**:
  - Do not remove SMTP configuration (users need a working example)
  - Do not change the English language of the content
  - Do not translate any English content to Chinese

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Content editing of a single file with clear cut points, no complex decisions
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 4, 5, 6)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `README_CN.md` - Structure reference for the concise approach (good Chinese README structure to mirror)
  - `docs/dingtalk-channel.md` - Target of the DingTalk link
  - `docs/feishu-channel.md` - Target of the Feishu link

  **API/Type References**: N/A

  **WHY Each Reference Matters**:
  - `README_CN.md`: Shows the target conciseness level
  - docs/ files: Confirm the link targets exist and the paths are correct

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: README.md is properly trimmed
    Tool: Bash (wc + grep)
    Preconditions: README.md has been trimmed
    Steps:
      1. Count lines: wc -l README.md -> must be <= 150
      2. grep "docs/dingtalk-channel.md" README.md -> must find link
      3. grep "docs/feishu-channel.md" README.md -> must find link
      4. grep "docs/template-configuration.md" README.md -> must find link
      5. grep "docs/smtp-channel.md" README.md -> must find link
      6. grep "smtp.qq.com" README.md -> SMTP minimal example preserved
    Expected Result: README trimmed to <= 150 lines with links to docs/
    Failure Indicators: Line count > 150 or missing docs/ links
    Evidence: .sisyphus/evidence/task-2-readme-trimmed.txt

  Scenario: No broken links in README.md
    Tool: Bash (test)
    Preconditions: README.md has been trimmed
    Steps:
      1. Extract all relative .md links from README.md
      2. For each link, test -f that the target file exists
      3. Specifically verify: docs/dingtalk-channel.md, docs/feishu-channel.md, docs/template-configuration.md, docs/channel-development.md
    Expected Result: All linked files exist
    Evidence: .sisyphus/evidence/task-2-readme-links.txt
  ```

  **Commit**: YES
  - Message: `docs: slim README.md by moving channel configs to docs/`
  - Files: `README.md`
  - Pre-commit: none

---

- [x] 5. Rewrite README_CN.md (Chinese)

  **What to do**:
  - Complete rewrite of README_CN.md (not incremental edit - too outdated)
  - Structure should mirror the trimmed README.md but in Chinese
  - Include: project header, features, Roadmap (with dingtalk+feishu marked as "已发布"), Quick Start, Installation (global + project), SMTP minimal config, common SMTP servers table, Events table, CLI section, Troubleshooting
  - Add "更多文档" section linking to all docs/ files
  - Do NOT reference CONFIG_CN.md (will be deleted)
  - Verify it mentions all 3 channels: smtp, dingtalk, feishu

  **Must NOT do**:
  - Do NOT reference CONFIG_CN.md (it is being deleted)
  - Do not copy-paste from the English README (write natural Chinese)
  - Do not include full DingTalk/Feishu configuration (link to docs/)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Single file rewrite with clear structure, content is well-defined
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 4, 5, 6)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `README.md` (current) - English structure reference (but use Chinese README_CN style)
  - `README_CN.md` (current L1-200) - Chinese phrasing and style reference

  **API/Type References**: N/A

  **WHY Each Reference Matters**:
  - Current README_CN.md: Reference for Chinese writing style and local conventions
  - README.md: Reference for what content to include (structure)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: README_CN.md covers all 3 channels
    Tool: Bash (grep)
    Preconditions: README_CN.md has been rewritten
    Steps:
      1. grep "smtp" README_CN.md -> must match
      2. grep "dingtalk\|钉钉" README_CN.md -> must match
      3. grep "feishu\|飞书" README_CN.md -> must match
      4. grep "CONFIG_CN" README_CN.md -> must NOT match
      5. grep "docs/" README_CN.md -> must match (links to docs/)
    Expected Result: All 3 channels mentioned, no reference to CONFIG_CN.md
    Failure Indicators: Missing channel mentions or stale CONFIG_CN.md reference
    Evidence: .sisyphus/evidence/task-3-readme-cn-coverage.txt

  Scenario: README_CN.md Roadmap is up to date
    Tool: Bash (grep)
    Preconditions: README_CN.md has been rewritten
    Steps:
      1. grep -A 10 "开发计划\|Roadmap" README_CN.md
      2. Verify dingtalk row shows "已发布" or "Available" (not "计划中")
      3. Verify feishu row shows "已发布" or "Available" (not "计划中")
    Expected Result: Both dingtalk and feishu marked as available/released
    Evidence: .sisyphus/evidence/task-3-readme-cn-roadmap.txt
  ```

  **Commit**: YES
  - Message: `docs: rewrite README_CN.md for current 3-channel support`
  - Files: `README_CN.md`
  - Pre-commit: none

---

- [x] 6. Fix Stale Source Code Comments and package.json

  **What to do**:
  - `src/formatters.ts` L35: Remove or update comment about "feishu: not implemented"
  - `src/types.ts` L51-52: Remove or update comment about "Phase 1: Only SMTP is implemented"
  - `package.json` L4: Update description from "email or DingTalk" to include feishu
  - `package.json` keywords: Add "feishu" keyword
  - Only change comments and description text, do not modify any logic

  **Must NOT do**:
  - Do not change any code logic, types, or function signatures
  - Do not add new comments beyond fixing the stale ones

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 4 small text edits across 3 files, purely cosmetic
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 4, 5, 6)
  - **Blocks**: None
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/formatters.ts:35` - Stale comment location
  - `src/types.ts:51-52` - Stale comment location

  **API/Type References**:
  - `package.json` - Current description and keywords

  **WHY Each Reference Matters**:
  - These are the exact locations of stale information that needs correction

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Stale comments are removed
    Tool: Bash (grep)
    Preconditions: Source files have been updated
    Steps:
      1. grep -n "not implemented" src/formatters.ts -> must return empty
      2. grep -n "Only SMTP" src/types.ts -> must return empty
      3. grep -n "Phase 1" src/types.ts -> must return empty
    Expected Result: No stale "not implemented" or "Only SMTP" comments
    Evidence: .sisyphus/evidence/task-4-stale-comments.txt

  Scenario: package.json includes feishu
    Tool: Bash (grep)
    Preconditions: package.json has been updated
    Steps:
      1. grep "feishu" package.json -> must match (in description or keywords)
    Expected Result: feishu mentioned in package.json
    Evidence: .sisyphus/evidence/task-4-package-json.txt

  Scenario: Build still passes
    Tool: Bash
    Preconditions: All changes made
    Steps:
      1. npm run typecheck -> must pass with no errors
    Expected Result: typecheck passes (only comments/description changed)
    Evidence: .sisyphus/evidence/task-4-typecheck.txt
  ```

  **Commit**: YES
  - Message: `fix: update stale channel implementation comments and package.json description`
  - Files: `src/formatters.ts`, `src/types.ts`, `package.json`
  - Pre-commit: `npm run typecheck`

---

- [x] 7. Delete CONFIG_CN.md and notes.md

  **What to do**:
  - Delete `CONFIG_CN.md`
  - Delete `notes.md`
  - Verify no remaining files reference CONFIG_CN.md

  **Must NOT do**:
  - Do not delete any other files
  - Do not modify docs/ files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File deletion with verification
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (solo)
  - **Blocks**: F1, F2
  - **Blocked By**: Tasks 2, 3, 4, 5 (must ensure no references to CONFIG_CN.md remain)

  **References**: N/A

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Deleted files no longer exist
    Tool: Bash (test)
    Preconditions: Files have been deleted
    Steps:
      1. test -f CONFIG_CN.md -> must fail (file not found)
      2. test -f notes.md -> must fail (file not found)
    Expected Result: Both files do not exist
    Evidence: .sisyphus/evidence/task-5-deletion.txt

  Scenario: No dangling references to CONFIG_CN.md
    Tool: Bash (grep)
    Preconditions: Files have been deleted
    Steps:
      1. grep -r "CONFIG_CN" *.md docs/*.md -> must return empty
    Expected Result: No file references the deleted CONFIG_CN.md
    Evidence: .sisyphus/evidence/task-5-no-dangling.txt
  ```

  **Commit**: YES
  - Message: `docs: remove outdated CONFIG_CN.md and empty notes.md`
  - Files: `CONFIG_CN.md` (delete), `notes.md` (delete)
  - Pre-commit: none

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** -- `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, grep content). For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Cross-Reference Integrity Check** -- `unspecified-high`
  1. Grep all .md files for broken relative links (links to non-existent files)
  2. Verify README.md and README_CN.md both link to all 6 docs/ files (including smtp-channel.md and configuration.md)
  3. Verify no file references CONFIG_CN.md or notes.md
  4. Run `npm run typecheck` to confirm no source code breakage
  5. Verify AGENTS.md has no "only smtp" or "not implemented" claims
  Output: `Links [N/N valid] | References [CLEAN/N issues] | Typecheck [PASS/FAIL] | VERDICT`

---

## Commit Strategy

- **Commit 1**: `docs: rewrite AGENTS.md to reflect 3-channel implementation` - AGENTS.md
- **Commit 2**: `docs: add SMTP email channel documentation` - docs/smtp-channel.md
- **Commit 3**: `docs: add general configuration guide` - docs/configuration.md
- **Commit 4**: `docs: slim README.md by moving channel configs to docs/` - README.md
- **Commit 5**: `docs: rewrite README_CN.md for current 3-channel support` - README_CN.md
- **Commit 6**: `fix: update stale channel implementation comments and package.json description` - src/formatters.ts, src/types.ts, package.json
- **Commit 7**: `docs: remove outdated CONFIG_CN.md and empty notes.md` - CONFIG_CN.md (delete), notes.md (delete)

---

## Success Criteria

### Verification Commands
```bash
# README.md trimmed
wc -l README.md  # Expected: <= 150

# SMTP channel doc exists
test -f docs/smtp-channel.md && echo "OK" || echo "FAIL"  # Expected: OK

# No stale claims
grep -ri "only smtp" AGENTS.md README.md README_CN.md  # Expected: no output
grep -ri "not implemented" AGENTS.md src/formatters.ts src/types.ts  # Expected: no output
grep -ri "Phase 1" src/types.ts  # Expected: no output

# All channels mentioned
grep "dingtalk" README.md README_CN.md AGENTS.md  # Expected: matches in all 3
grep "feishu" README.md README_CN.md AGENTS.md package.json  # Expected: matches in all 4

# Deleted files gone
test -f CONFIG_CN.md && echo "FAIL" || echo "OK"  # Expected: OK
test -f notes.md && echo "FAIL" || echo "OK"  # Expected: OK

# No dangling references
grep -r "CONFIG_CN" *.md docs/*.md  # Expected: no output

# docs/ contains 6 files
ls docs/*.md | wc -l  # Expected: 6

# Source code intact
npm run typecheck  # Expected: no errors
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] npm run typecheck passes
- [ ] All docs/ links in READMEs are valid
