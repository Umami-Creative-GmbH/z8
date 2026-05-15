# Remove Organization Business-Year Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the abandoned organization-level non-calendar year setting and keep all vacation, absence, report, and analytics behavior calendar-year based.

**Architecture:** Remove the setting at every layer rather than leaving compatibility shims. Runtime callers should depend on existing calendar-year helpers, settings and auth hydration should stop exposing the setting, and a forward migration should drop the legacy database column.

**Tech Stack:** Next.js app router, TypeScript, Drizzle, Better Auth organization fields, Vitest, Tolgee message JSON, Luxon date helpers.

---

### Task 1: Remove Settings Surface

**Files:**
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`
- Delete: the organization settings card component for the removed business-year start option
- Delete: the test file for that removed settings card
- Modify: `apps/webapp/messages/settings/en.json`
- Modify: `apps/webapp/messages/settings/de.json`
- Modify: `apps/webapp/messages/settings/es.json`
- Modify: `apps/webapp/messages/settings/fr.json`
- Modify: `apps/webapp/messages/settings/it.json`
- Modify: `apps/webapp/messages/settings/pt.json`

- [ ] Remove the business-year start card import and JSX from `organization-tab.tsx`.
- [ ] Delete the card component and its tests.
- [ ] Remove translated title, description, help text, month labels, submit labels, and success or error messages for the removed setting.
- [ ] Run the settings-related tests that cover organization settings rendering.

### Task 2: Remove Server Action And Hydration

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Delete: the settings action test file dedicated to the removed business-year start option
- Modify: `apps/webapp/src/app/api/auth/context/route.ts`
- Modify: `apps/webapp/src/app/api/auth/context/route.test.ts`
- Modify: `apps/webapp/src/hooks/use-organization.ts`
- Modify: `apps/webapp/src/stores/organization-settings-store.ts`
- Modify: `apps/webapp/src/stores/organization-settings-store.test.ts`

- [ ] Remove the dedicated update action for the business-year start setting.
- [ ] Remove tests that only validate that deleted action.
- [ ] Stop selecting, serializing, and hydrating the removed setting in auth context.
- [ ] Remove the store field, selector, defaults, and hydration mapping for the removed setting.
- [ ] Update organization hook types so consumers cannot read the removed setting.
- [ ] Run `pnpm --dir apps/webapp test src/stores/organization-settings-store.test.ts src/app/api/auth/context/route.test.ts`.

### Task 3: Remove Schema Field And Add Forward Migration

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify: `apps/webapp/src/db/auth-schema.ts`
- Add: a Drizzle migration under the repository's migration directory

- [ ] Remove the additional organization field for the business-year start setting from auth configuration.
- [ ] Regenerate or update generated schema output according to the repository's Better Auth schema workflow.
- [ ] Add a forward migration that drops the legacy organization start-month column.
- [ ] Verify the migration is one-way and does not reintroduce the removed setting.

### Task 4: Restore Calendar-Year Date Behavior

**Files:**
- Delete: the utility module dedicated to non-calendar organization year ranges
- Delete: the test file for that removed utility module
- Modify: `apps/webapp/src/lib/reports/date-ranges.ts`
- Modify: `apps/webapp/src/lib/reports/date-ranges.test.ts`
- Modify: `apps/webapp/src/lib/absences/date-utils.ts`
- Modify: `apps/webapp/src/lib/absences/date-utils.test.ts`
- Modify: `apps/webapp/src/lib/absences/vacation-calculator.ts`
- Modify: `apps/webapp/src/lib/absences/vacation-calculator.test.ts`
- Modify: `apps/webapp/src/lib/jobs/carryover-automation.ts`
- Modify: `apps/webapp/src/lib/jobs/carryover-automation.test.ts`

- [ ] Delete the utility module and test file dedicated to non-calendar year calculations.
- [ ] Ensure report ranges use calendar-year helpers for current year, last year, and year to date.
- [ ] Ensure absence date utilities return January 1 through December 31 boundaries for a requested year.
- [ ] Ensure vacation calculations and carryover automation no longer accept or derive an organization-specific year-start value.
- [ ] Run `pnpm --dir apps/webapp test src/lib/reports/date-ranges.test.ts src/lib/absences/date-utils.test.ts src/lib/absences/vacation-calculator.test.ts src/lib/jobs/carryover-automation.test.ts`.

### Task 5: Update Runtime Callers

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/queries.test.ts`
- Modify: analytics and reporting callers that previously threaded the removed setting through filters or props

- [ ] Remove removed-setting parameters from absence actions, pages, previews, and queries.
- [ ] Update query tests to assert use of calendar-year helper output and absence overlap boundaries.
- [ ] Remove removed-setting props or filters from analytics and reporting pages.
- [ ] Run `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/absences/queries.test.ts'` and any adjacent caller tests touched in this task.

### Task 6: Delete Utility And Remaining References

**Files:**
- Delete: the utility module dedicated to non-calendar organization year ranges
- Delete: the test file for that removed utility module
- Delete: old design and plan docs for the abandoned business-year start feature
- Modify: any remaining runtime, test, or message files found by cleanup search

- [ ] Delete the utility module and its test if not already removed by Task 4.
- [ ] Delete old design and plan docs for the abandoned setting.
- [ ] Search application source, messages, and superpowers docs for the abandoned feature's old identifiers.
- [ ] Remove remaining runtime, test, message, and obsolete doc references while preserving this removal spec and plan.
- [ ] Run `pnpm --dir apps/webapp test src/stores/organization-settings-store.test.ts src/lib/reports/date-ranges.test.ts src/lib/absences/date-utils.test.ts src/lib/absences/vacation-calculator.test.ts src/lib/jobs/carryover-automation.test.ts 'src/app/[locale]/(app)/absences/queries.test.ts'`.
- [ ] Confirm the cleanup search returns no matches in `apps/webapp/src`, `apps/webapp/messages`, and `docs/superpowers`.

### Task 7: Final Verification

**Files:**
- Review: all modified application source, messages, migrations, tests, and docs

- [ ] Run the focused regression suite from Task 6.
- [ ] Run the cleanup search and confirm it returns no matches.
- [ ] Check `git status --short` and report changed files without committing.
- [ ] Confirm the final state keeps calendar-year vacation behavior, drops the old database column through a forward migration, and removes setting UI, hydration, utilities, callers, tests, messages, and obsolete docs.
