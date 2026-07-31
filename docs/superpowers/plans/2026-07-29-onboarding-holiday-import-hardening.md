# Onboarding And Holiday Import Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce tenant authorization on work-template onboarding, make holiday imports bounded and organization-safe, use explicit calendar semantics, and expose accessible work-template controls and errors.

**Architecture:** Keep authorization in `OnboardingService`, where the authenticated session and active organization are available. Validate and prepare the holiday import in request order before a single transaction that creates or resolves the category and performs one bulk holiday insert. Treat holiday dates as `Temporal.PlainDate` values for recurrence and duplicate decisions, converting to `Date` only for the existing database boundary.

**Tech Stack:** Next.js route handlers and server actions, Effect services, Drizzle ORM, Zod, Temporal polyfill, TanStack React Form, Vitest, Testing Library.

---

### Task 1: Protect Work-Template Onboarding Mutations

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts`
- Test: `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`

- [ ] Add failing service tests proving members, missing memberships, and missing active organizations cannot create or skip work-template setup, while owners/admins can proceed.
- [ ] Run the focused onboarding service tests and verify the authorization cases fail because writes currently occur.
- [ ] Add a shared active-organization owner/admin guard and invoke it before either work-template mutation.
- [ ] Re-run the focused onboarding service tests and verify they pass.

### Task 2: Bound And Secure Holiday Imports

**Files:**
- Modify: `apps/webapp/src/lib/holidays/validation.ts`
- Modify: `apps/webapp/src/app/api/org-admin/holidays/import/route.ts`
- Create: `apps/webapp/src/app/api/org-admin/holidays/import/route.test.ts`

- [ ] Add failing tests for the maximum batch size, foreign category rejection before writes, duplicate detection in request order, ordered row errors, and one atomic bulk write.
- [ ] Run the focused import tests and verify the expected failures.
- [ ] Cap holiday arrays at 366 entries, resolve a supplied category with both ID and active organization, prepare rows sequentially, and use one transaction plus one bulk insert for accepted rows.
- [ ] Re-run the focused import tests and verify they pass.

### Task 3: Use PlainDate Holiday Semantics

**Files:**
- Modify: `apps/webapp/src/lib/holidays/date-holidays-service.ts`
- Create: `apps/webapp/src/lib/holidays/date-holidays-service.test.ts`

- [ ] Add failing tests that run with different process time zones and prove recurrence month/day, duration, and duplicate checks remain tied to holiday calendar dates.
- [ ] Run the focused holiday service tests and verify the timezone-sensitive cases fail.
- [ ] Parse holiday date keys and stored boundary dates as explicit `Temporal.PlainDate` values, use calendar-day arithmetic, and retain `Date` only in returned persistence values.
- [ ] Re-run the focused holiday service tests and verify they pass.

### Task 4: Associate Work-Template Controls And Errors

**Files:**
- Modify: `apps/webapp/src/app/[locale]/onboarding/work-templates/page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/work-templates/page.test.tsx`

- [ ] Add failing DOM tests for label/control association, descriptions, invalid state, error announcements, checkbox labels, and switch labeling.
- [ ] Run the focused page test and verify the accessibility assertions fail.
- [ ] Replace ad hoc labels/messages with `TFormItem`, `TFormLabel`, `TFormControl`, `TFormDescription`, and `TFormMessage`; associate checkbox and switch labels directly.
- [ ] Re-run the focused page test and verify it passes.

### Task 5: Verification

**Files:**
- Verify only the files listed above.

- [ ] Run focused security, holiday import, onboarding, Temporal service, and work-template page tests.
- [ ] Run `pnpm test:temporal-timezone-smoke` and confirm all three configured zones pass.
- [ ] Run the webapp typecheck.
- [ ] Run Biome checks on only the changed implementation and test files.
- [ ] Inspect the approval worktree diff and status without staging or changing the root worktree.
