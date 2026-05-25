# Command Palette I18n UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix command palette translations and improve command result rows with localized search terms, icons, and employee avatars.

**Architecture:** The command palette stays in `AppSearch`; static search data remains built by `static-results.ts` and `static-commands.ts`. Global command palette strings move into the loaded `common` namespace because the sidebar is mounted across app routes.

**Tech Stack:** React, Next.js app router, Tolgee, cmdk/shadcn command primitives, Tabler icons, Vitest, Testing Library.

---

### Task 1: Prove Namespaced App Search Translations

**Files:**
- Modify: `apps/webapp/src/tolgee/shared.test.ts`
- Modify: `apps/webapp/messages/common/en.json`
- Modify: `apps/webapp/messages/common/de.json`
- Modify: `apps/webapp/messages/common/fr.json`
- Modify: `apps/webapp/messages/common/es.json`
- Modify: `apps/webapp/messages/common/it.json`
- Modify: `apps/webapp/messages/common/pt.json`

- [ ] Add a failing test that `loadRouteTranslations("de", "/")` includes `appSearch.searchOrRunCommand` with the German translation.
- [ ] Run `pnpm --filter webapp test src/tolgee/shared.test.ts` and verify the test fails because the key is missing from `common/de.json`.
- [ ] Add the `appSearch` tree from the legacy root message files into each `messages/common/{locale}.json` file.
- [ ] Re-run `pnpm --filter webapp test src/tolgee/shared.test.ts` and verify it passes.

### Task 2: Localize Static Search Keywords

**Files:**
- Modify: `apps/webapp/src/lib/app-search/static-results.ts`
- Modify: `apps/webapp/src/lib/app-search/static-results.test.ts`
- Modify: `apps/webapp/messages/common/en.json`
- Modify: `apps/webapp/messages/common/de.json`

- [ ] Add a failing test proving static page keywords are translated through `t()` instead of copied from English literals.
- [ ] Run `pnpm --filter webapp test src/lib/app-search/static-results.test.ts` and verify the test fails.
- [ ] Change keyword definitions in `static-results.ts` to `{ key, defaultValue }` objects and map them through `t()`.
- [ ] Add localized keyword entries to common locale files for the command palette page keyword use case.
- [ ] Re-run `pnpm --filter webapp test src/lib/app-search/static-results.test.ts` and verify it passes.

### Task 3: Improve Command Result Rows

**Files:**
- Modify: `apps/webapp/src/components/app-search.tsx`
- Modify: `apps/webapp/src/components/app-search.test.tsx`
- Modify: `apps/webapp/src/lib/app-search/types.ts`
- Inspect: `apps/webapp/src/components/user-avatar.tsx`

- [ ] Add failing tests proving employee results render the shared `UserAvatar`, settings results render an icon, and translated trigger text is used.
- [ ] Run `pnpm --filter webapp test src/components/app-search.test.tsx` and verify the new tests fail.
- [ ] Extend `AppSearchResult` with optional employee avatar fields needed by `UserAvatar`.
- [ ] Render shadcn-style rows with a leading visual: `UserAvatar` for employees and Tabler icons for actions, pages, settings, and teams.
- [ ] Keep row text truncated and accessible; preserve `CommandItem` selection behavior.
- [ ] Re-run `pnpm --filter webapp test src/components/app-search.test.tsx` and verify it passes.

### Task 4: Verify Focused Scope

**Files:**
- Verify: changed files only

- [ ] Run focused tests for `shared`, `static-results`, and `app-search`.
- [ ] Run formatting/lint/type checks if available and fast enough for the touched files.
- [ ] Review diffs to ensure no unrelated files were changed and no tenant-scoped data access was added.
