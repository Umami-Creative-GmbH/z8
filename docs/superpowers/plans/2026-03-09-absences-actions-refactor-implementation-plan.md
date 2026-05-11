# Absences Actions Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the heavy absences server-actions module into focused internal files while preserving the current public API and runtime behavior.

**Architecture:** Keep `apps/webapp/src/app/[locale]/(app)/absences/actions.ts` as a compatibility facade. Move current-employee lookup, read-side queries, shared mappers, and the Effect-based request workflow into adjacent modules with one-way dependencies and shared helpers for duplicated logic.

**Tech Stack:** Next.js App Router server actions, TypeScript, Drizzle ORM, Effect, Luxon, pnpm.

---

### Task 1: Add a shared absence mapper before moving queries

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/absences/mappers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`

**Step 1: Write the failing test**

Add a focused unit test for the mapper if a nearby test location already exists. If there is no established absences test harness for this module, use a type-level verification step instead of creating speculative test infrastructure.

```ts
// example target assertion if a mapper test is added
expect(mapAbsenceWithCategoryRecord(record)).toEqual(expectedAbsence);
```

**Step 2: Run test to verify it fails**

Run a targeted command if a new test is created, otherwise skip directly to implementation and verify with typecheck/test in Step 4.

Run: `pnpm --filter webapp test -- <targeted-test-path>`
Expected: FAIL because the mapper does not exist yet.

**Step 3: Write minimal implementation**

Create a mapper that centralizes the repeated `AbsenceWithCategory` transformation currently duplicated in `getVacationBalance` and `getAbsenceEntries`, then switch both call sites to use it.

```ts
export function mapAbsenceWithCategoryRecord(record: AbsenceRecord): AbsenceWithCategory {
  return {
    id: record.id,
    employeeId: record.employeeId,
    startDate: record.startDate,
    startPeriod: record.startPeriod,
    endDate: record.endDate,
    endPeriod: record.endPeriod,
    status: record.status,
    notes: record.notes,
    category: {
      id: record.category.id,
      name: record.category.name,
      type: record.category.type,
      color: record.category.color,
      countsAgainstVacation: record.category.countsAgainstVacation,
    },
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    rejectionReason: record.rejectionReason,
    createdAt: record.createdAt,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp test -- <targeted-test-path>` or `pnpm --filter webapp exec tsc --noEmit`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences/mappers.ts apps/webapp/src/app/[locale]/(app)/absences/actions.ts
git commit -m "refactor(absences): share absence record mapping"
```

### Task 2: Extract current employee lookup to a dedicated helper

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`

**Step 1: Write the failing test**

If there is an established test setup for these server actions, add a small import/behavior test around current employee resolution. Otherwise plan to verify via targeted typecheck and existing tests.

```ts
expect(await getCurrentEmployee()).toEqual(expectedEmployeeOrNull);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- <targeted-test-path>`
Expected: FAIL because the extracted helper does not exist yet.

**Step 3: Write minimal implementation**

Move `getCurrentEmployee` into `current-employee.ts`, keep its behavior unchanged, and update imports so `actions.ts` re-exports it and `approvals/actions.ts` imports from the new internal helper or from the facade, whichever avoids cycles cleanly.

```ts
export async function getCurrentEmployee() {
  // identical activeOrganizationId-first lookup
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec tsc --noEmit`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences/current-employee.ts apps/webapp/src/app/[locale]/(app)/absences/actions.ts apps/webapp/src/app/[locale]/(app)/approvals/actions.ts
git commit -m "refactor(absences): isolate current employee lookup"
```

### Task 3: Move read-side queries into a query module

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/absences/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx` (only if imports need adjustment during transition)
- Test: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`

**Step 1: Write the failing test**

If adding tests is practical, create a focused regression test for one query helper and one cancellation helper. Otherwise use a typecheck-first refactor and verify through targeted commands.

```ts
expect(await getAbsenceCategories(orgId)).toEqual(expectedCategories);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- <targeted-test-path>`
Expected: FAIL because the extracted query module does not exist yet.

**Step 3: Write minimal implementation**

Move the following functions into `queries.ts` without changing their signatures:

- `getVacationBalance`
- `getAbsenceEntries`
- `getHolidays`
- `cancelAbsenceRequest`
- `getAbsenceCategories`

Keep shared mapping delegated to `mappers.ts` and preserve `Promise.all` usage in vacation balance lookup.

```ts
export async function getVacationBalance(employeeId: string, year: number) {
  // existing query flow, now using mapAbsenceWithCategoryRecord
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec tsc --noEmit`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences/queries.ts apps/webapp/src/app/[locale]/(app)/absences/actions.ts
git commit -m "refactor(absences): extract query helpers"
```

### Task 4: Extract the request-absence Effect workflow

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Test: `apps/webapp/src/components/absences/request-absence-dialog.tsx`

**Step 1: Write the failing test**

If there is existing action coverage, add a regression test for the public `requestAbsence` result shape. If not, rely on targeted typecheck plus existing webapp tests.

```ts
expect(await requestAbsence(validRequest)).toEqual(
  expect.objectContaining({ success: expect.any(Boolean) }),
);
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- <targeted-test-path>`
Expected: FAIL because the extracted workflow file does not exist yet.

**Step 3: Write minimal implementation**

Move `requestAbsenceEffect` into `request-absence-effect.ts` and extract small private helpers for:

- date validation
- overlap detection
- category fetch
- absence insert
- auto-approval update
- manager/employee detail fetch
- email rendering/sending

Keep OTEL span behavior, Effect error handling, and server-action result contract unchanged.

```ts
export async function requestAbsenceEffect(data: AbsenceRequest) {
  return runServerActionSafe(buildRequestAbsenceEffect(data));
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec tsc --noEmit`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts apps/webapp/src/app/[locale]/(app)/absences/actions.ts
git commit -m "refactor(absences): extract request workflow"
```

### Task 5: Reduce `actions.ts` to a compatibility facade

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`
- Test: `apps/webapp/src/components/absences/request-absence-dialog.tsx`
- Test: `apps/webapp/src/components/absences/absence-entries-table.tsx`

**Step 1: Write the failing test**

Add a small import-surface regression test only if the repo already has a suitable pattern. Otherwise verify with typecheck and page/component compilation.

```ts
import {
  requestAbsence,
  getCurrentEmployee,
  getVacationBalance,
} from "@/app/[locale]/(app)/absences/actions";

expect(requestAbsence).toBeTypeOf("function");
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- <targeted-test-path>`
Expected: FAIL before the facade is finalized.

**Step 3: Write minimal implementation**

Make `actions.ts` export only the public functions from the new internal modules and keep `requestAbsence` aliased to `requestAbsenceEffect` for backward compatibility.

```ts
export { getCurrentEmployee } from "./current-employee";
export {
  getVacationBalance,
  getAbsenceEntries,
  getHolidays,
  cancelAbsenceRequest,
  getAbsenceCategories,
} from "./queries";
export { requestAbsenceEffect, requestAbsence } from "./request-absence-effect";
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter webapp exec tsc --noEmit`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences/actions.ts
git commit -m "refactor(absences): turn actions file into facade"
```

### Task 6: Run targeted verification and clean up follow-on issues

**Files:**
- Modify: any files touched while fixing verification failures
- Test: absences and approvals paths impacted by the refactor

**Step 1: Run targeted verification**

Run the narrowest useful checks first.

```bash
pnpm --filter webapp exec tsc --noEmit
pnpm --filter webapp test -- --runInBand
```

If the second command is too broad or unsupported, replace it with the specific webapp test command already used in this repo.

**Step 2: Fix any failures in small steps**

Address import cycles, type regressions, or missed references one at a time.

**Step 3: Re-run verification**

Run the same commands again.

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences apps/webapp/src/app/[locale]/(app)/approvals/actions.ts
git commit -m "refactor(absences): verify split actions module"
```

### Task 7: Optional follow-up cleanup after the safe split

**Files:**
- Modify: only if clearly justified by discovered duplication

**Step 1: Identify low-risk cleanup**

Look only for issues discovered during the split, such as duplicate date formatters or repeated update payloads.

**Step 2: Apply one cleanup at a time**

Keep behavior stable and avoid widening scope.

**Step 3: Re-run targeted verification**

Run: `pnpm --filter webapp exec tsc --noEmit`
Expected: PASS.

**Step 4: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/absences
git commit -m "refactor(absences): polish extracted helpers"
```
