# Scheduling Timezone Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduling browser-independent by treating calendar dates and wall times as organization-local Temporal values.

**Architecture:** Scheduler UI state and server-action payloads use primitive `YYYY-MM-DD` date keys. Authenticated server actions resolve these against the organization timezone into half-open instant ranges only at service boundaries. Schedule-X retains its existing global Temporal setup but receives `PlainDateTime` values created from local primitive data.

**Tech Stack:** Next.js server actions, React, TanStack Query/Form, Temporal polyfill, Vitest, Drizzle.

---

### Task 1: Scheduler Temporal Boundary Helpers

**Files:**
- Modify: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler-utils.ts`
- Test: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler-utils.test.ts`

- [ ] Write browser-zone mismatch tests for `YYYY-MM-DD` week selection, event conversion, and Schedule-X range values.
- [ ] Run the test under `TZ=UTC` and `TZ=Pacific/Honolulu`; observe failures from native Date calendar arithmetic.
- [ ] Replace native Date helpers with `Temporal.PlainDate` / `Temporal.PlainDateTime` conversions and date-string range state.
- [ ] Re-run both zone variants and verify identical primitive output.

### Task 2: Primitive Scheduler Payloads

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/types.ts`
- Modify: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx`
- Modify: `apps/webapp/src/components/scheduling/scheduler/use-shift-scheduler-data.ts`
- Modify: `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx`
- Modify: `apps/webapp/src/components/scheduling/shifts/use-shift-dialog-form.ts`
- Test: `apps/webapp/src/components/scheduling/shifts/use-shift-dialog-form.test.ts`

- [ ] Write failing tests that verify dialog and drag/drop submit date strings rather than client ISO/Date payloads.
- [ ] Update UI state, query keys, and mutation inputs to primitive calendar dates and wall times.
- [ ] Verify tests in UTC and Honolulu.

### Task 3: Server Coercion And Scoped Ranges

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.ts`
- Modify: `apps/webapp/src/lib/effect/services/shift.service.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.timezone.test.ts`

- [ ] Write failing action tests for Berlin organization ranges from a Honolulu client, New York spring gaps/fall folds, invalid zones, and cross-organization mutation rejection.
- [ ] Resolve the authenticated organization timezone server-side; validate date/time strings with Temporal and turn ranges into half-open instants.
- [ ] Enforce organization constraints for update and employee/subarea relations.
- [ ] Run focused tests under UTC and Honolulu.

### Task 4: Coverage, Compliance, And Publish Consumers

**Files:**
- Modify: `apps/webapp/src/components/scheduling/scheduler/coverage-heatmap-overlay.tsx`
- Modify: `apps/webapp/src/components/scheduling/scheduler/use-shift-publish-flow.ts`
- Modify: `apps/webapp/src/lib/query/keys.ts`
- Test: `apps/webapp/src/components/scheduling/scheduler/coverage-heatmap-overlay.test.tsx`

- [ ] Write failing tests asserting coverage keys use organization-local date strings.
- [ ] Pass primitive half-open schedule ranges through coverage/compliance/publish calls and remove `toISOString` date-key derivation.
- [ ] Verify focused tests in UTC and Honolulu.

### Task 5: Regression And Static Verification

**Files:** all changed scheduling files

- [ ] Run focused scheduler and action tests with `TZ=UTC` and `TZ=Pacific/Honolulu`.
- [ ] Run datetime foundation tests, Biome checks, and inspect `git diff --check` plus `git diff`.
