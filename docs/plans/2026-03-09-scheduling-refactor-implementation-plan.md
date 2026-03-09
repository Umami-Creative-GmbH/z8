# Scheduling Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the scheduling refactor by splitting heavy UI modules, sharing repeated logic, and fixing shift deletion authorization for manager/admin-only draft deletion.

**Architecture:** Keep `apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts` as the stable public API while moving implementation into focused modules. Refactor the scheduler and shift dialog with extracted utilities, hooks, and smaller UI sections, and enforce delete authorization in the scheduling service so security is not dependent on client behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Effect, Drizzle ORM, TanStack Query, TanStack Form, Vitest, Biome.

---

### Task 1: Lock Down Shift Deletion Authorization

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.ts`
- Modify: `apps/webapp/src/lib/effect/services/shift.service.ts`
- Create or Modify: `apps/webapp/src/lib/effect/services/__tests__/shift.service.test.ts`

**Step 1: Write the failing test**

Create or extend `apps/webapp/src/lib/effect/services/__tests__/shift.service.test.ts` with cases for:

```ts
it("rejects draft shift deletion for non-manager employees", async () => {
  // arrange draft shift + acting employee role "employee"
  // assert deleteShift fails with AuthorizationError
});

it("rejects draft shift deletion across organizations", async () => {
  // arrange draft shift org A + acting manager in org B
  // assert deleteShift fails
});

it("allows draft shift deletion for in-org managers", async () => {
  // arrange draft shift + acting manager in same org
  // assert deleteShift succeeds
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp exec vitest run "src/lib/effect/services/__tests__/shift.service.test.ts"`

Expected: FAIL because the current delete path does not enforce org-scoped manager/admin-only rules.

**Step 3: Write minimal implementation**

- Change the scheduling action to pass actor context needed for secure deletion.
- In `apps/webapp/src/lib/effect/services/shift.service.ts`, update `deleteShift` to:
  - load the shift
  - load the acting employee
  - reject missing employee context
  - reject cross-org access
  - reject non-manager/non-admin actors
  - reject published shifts
  - delete only after those checks pass

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec vitest run "src/lib/effect/services/__tests__/shift.service.test.ts"`

Expected: PASS for the new authorization cases.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-actions.ts apps/webapp/src/lib/effect/services/shift.service.ts apps/webapp/src/lib/effect/services/__tests__/shift.service.test.ts
git commit -m "fix(scheduling): require manager access for shift deletion"
```

### Task 2: Extract Scheduler Utilities and Hooks

**Files:**
- Modify: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx`
- Create: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler-utils.ts`
- Create: `apps/webapp/src/components/scheduling/scheduler/use-shift-scheduler-data.ts`
- Create: `apps/webapp/src/components/scheduling/scheduler/use-shift-publish-flow.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts`

**Step 1: Write the failing test**

If helper tests are warranted, add a small utility test such as:

```ts
it("forces published status for employee-visible shift queries", () => {
  // assert extracted query builder preserves employee restrictions
});
```

If that is too indirect, use the existing publish handshake test as the guardrail for extracted publish flow behavior.

**Step 2: Run test to verify current baseline**

Run: `pnpm --filter webapp exec vitest run "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"`

Expected: PASS before refactor, giving a stable baseline.

**Step 3: Write minimal implementation**

- Move `shiftToEvent`, `dateToPlainDateTime`, and week-range helpers into `shift-scheduler-utils.ts`.
- Move query/mutation orchestration into `use-shift-scheduler-data.ts`.
- Move publish dialog and acknowledgment logic into `use-shift-publish-flow.ts`.
- Trim `shift-scheduler.tsx` so it mostly wires hooks, calendar plugins, and child components.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec vitest run "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"`

Expected: PASS with no behavior change.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx apps/webapp/src/components/scheduling/scheduler/shift-scheduler-utils.ts apps/webapp/src/components/scheduling/scheduler/use-shift-scheduler-data.ts apps/webapp/src/components/scheduling/scheduler/use-shift-publish-flow.ts apps/webapp/src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts
git commit -m "refactor(scheduling): split scheduler container logic"
```

### Task 3: Split Shift Dialog State and Sections

**Files:**
- Modify: `apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx`
- Create: `apps/webapp/src/components/scheduling/shifts/use-shift-dialog-form.ts`
- Create: `apps/webapp/src/components/scheduling/shifts/use-shift-dialog-data.ts`
- Create: `apps/webapp/src/components/scheduling/shifts/shift-dialog-sections.tsx`
- Test: `apps/webapp/src/components/scheduling/shifts/` (create tests only if extraction introduces meaningful pure helpers)

**Step 1: Write the failing test**

If you extract pure helper behavior, add focused tests like:

```ts
it("applies template defaults without overriding an existing subarea", () => {
  // assert autofill logic keeps current subarea when already chosen
});
```

If no pure helper emerges, skip new tests and use targeted manual verification plus package checks for this extraction.

**Step 2: Run test to verify baseline**

Run the focused helper test if added, or note that this task will be validated via typecheck plus the unchanged scheduling test.

**Step 3: Write minimal implementation**

- Move form initialization/reset/template autofill into `use-shift-dialog-form.ts`.
- Move employees/locations/skill validation queries into `use-shift-dialog-data.ts`.
- Move repeated JSX sections into `shift-dialog-sections.tsx`.
- Keep `shift-dialog.tsx` as the modal shell plus mutation wiring.

**Step 4: Run test to verify it passes**

Run any new helper tests, then run:

`pnpm --filter webapp exec vitest run "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"`

Expected: PASS, with no regressions in scheduling-specific flow.

**Step 5: Commit**

```bash
git add apps/webapp/src/components/scheduling/shifts/shift-dialog.tsx apps/webapp/src/components/scheduling/shifts/use-shift-dialog-form.ts apps/webapp/src/components/scheduling/shifts/use-shift-dialog-data.ts apps/webapp/src/components/scheduling/shifts/shift-dialog-sections.tsx
git commit -m "refactor(scheduling): split shift dialog responsibilities"
```

### Task 4: Final Verification and Cleanup

**Files:**
- Verify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/*.ts`
- Verify: `apps/webapp/src/components/scheduling/scheduler/*`
- Verify: `apps/webapp/src/components/scheduling/shifts/*`

**Step 1: Run scheduling-focused tests**

Run:

```bash
pnpm --filter webapp exec vitest run "src/app/[locale]/(app)/scheduling/__tests__/publish-compliance-handshake.test.ts"
pnpm --filter webapp exec vitest run "src/lib/effect/services/__tests__/shift.service.test.ts"
```

Expected: PASS.

**Step 2: Run webapp typecheck**

Run: `pnpm --filter webapp exec tsc --noEmit --pretty false`

Expected: existing unrelated failures may remain, but there should be no new scheduling-related errors.

**Step 3: Run formatter/checker on touched files**

Run:

```bash
pnpm --filter webapp exec biome check --write "src/app/[locale]/(app)/scheduling/actions.ts" "src/app/[locale]/(app)/scheduling/actions/*.ts" "src/components/scheduling/scheduler/*.ts*" "src/components/scheduling/shifts/*.ts*"
```

Expected: files are formatted and any lintable issues in touched files are addressed.

**Step 4: Review diff**

Run: `git diff -- apps/webapp/src/app/[locale]/(app)/scheduling apps/webapp/src/components/scheduling`

Expected: smaller modules, stable public exports, and no accidental feature additions.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/scheduling apps/webapp/src/components/scheduling docs/plans/2026-03-09-scheduling-refactor-design.md docs/plans/2026-03-09-scheduling-refactor-implementation-plan.md
git commit -m "refactor(scheduling): split ui modules and harden delete auth"
```
