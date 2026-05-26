# Employee Work Balance Recalculation Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the employee work-balance recalculation action remove calculated period balances and return that employee to the user-visible not-yet-calculated state.

**Architecture:** Keep the existing server action and UI contract. Change the work-balance service rebuild request to delete org-scoped period rows, write a hidden aggregate full-rebuild marker that public reads treat as null, and serialize reset/refresh work for the same employee with an advisory transaction lock.

**Tech Stack:** TypeScript, Next.js server actions, Drizzle ORM, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/lib/work-balance/service.test.ts`: update service unit tests for scoped period deletion, hidden reset marker reads, refresh promotion to full rebuild, and transaction-client usage.
- Modify `apps/webapp/src/lib/work-balance/service.ts`: implement the reset by deleting from `employee_work_balance_period`, upserting a hidden aggregate full-rebuild marker in `employee_work_balance`, and locking reset/refresh work per employee and organization.
- Modify `apps/webapp/src/lib/work-balance/period-aggregation.ts`: allow period aggregation helpers to use the locked transaction client while preserving default callers.
- Modify `apps/webapp/src/lib/jobs/work-balance.ts`: force a full rebuild for missing aggregate rows as well as dirty null-date marker rows.
- No migration is needed because this changes runtime behavior only.
- No UI files are changed because the existing recalculation button and confirmation copy remain valid.

## Task 1: Replace Dirty-Marking Test With Reset Expectations

**Files:**
- Modify: `apps/webapp/src/lib/work-balance/service.test.ts`

- [ ] **Step 1: Find the current full rebuild delegation test**

Open `apps/webapp/src/lib/work-balance/service.test.ts` and locate this test:

```ts
it("delegates full rebuild requests to period aggregation with the employee scope", async () => {
	mockState.markEmployeeWorkBalanceFullRebuildRequested.mockResolvedValueOnce(undefined);

	await requestEmployeeWorkBalanceFullRebuild({
		employeeId: "employee-1",
		organizationId: "org-1",
	});

	expect(mockState.markEmployeeWorkBalanceFullRebuildRequested).toHaveBeenCalledTimes(1);
	expect(mockState.markEmployeeWorkBalanceFullRebuildRequested).toHaveBeenCalledWith({
		employeeId: "employee-1",
		organizationId: "org-1",
	});
});
```

- [ ] **Step 2: Replace it with a failing reset-behavior test**

Replace the test from Step 1 with this test:

```ts
it("resets employee work balance recalculation state with a hidden aggregate marker", async () => {
	await requestEmployeeWorkBalanceFullRebuild({
		employeeId: "employee-1",
		organizationId: "org-1",
	});

	expect(mockState.txDelete).toHaveBeenCalledWith(employeeWorkBalancePeriod);
	expect(mockState.txInsert).toHaveBeenCalledWith(employeeWorkBalance);
	expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.employeeId, "employee-1");
	expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.organizationId, "org-1");
	expect(mockState.markEmployeeWorkBalanceFullRebuildRequested).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter webapp test src/lib/work-balance/service.test.ts -- --runInBand
```

Expected: FAIL. The failure should show that `requestEmployeeWorkBalanceFullRebuild` still delegates to `markEmployeeWorkBalanceFullRebuildRequested` and does not perform the period delete plus aggregate marker write.

## Task 2: Implement Reset Marker, Locking, and Full Rebuild Promotion

**Files:**
- Modify: `apps/webapp/src/lib/work-balance/service.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/period-aggregation.ts`
- Modify: `apps/webapp/src/lib/jobs/work-balance.ts`
- Modify: `apps/webapp/src/lib/jobs/work-balance.test.ts`

- [ ] **Step 1: Remove unused full-rebuild dirty marker import**

In `apps/webapp/src/lib/work-balance/service.ts`, change the import from `./period-aggregation` from this:

```ts
import {
	computeEmployeePeriodBalance,
	markEmployeeWorkBalanceFullRebuildRequested,
	rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";
```

to this:

```ts
import {
	computeEmployeePeriodBalance,
	rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";
```

- [ ] **Step 2: Replace the rebuild request implementation**

In `apps/webapp/src/lib/work-balance/service.ts`, replace the current function:

```ts
export async function requestEmployeeWorkBalanceFullRebuild(input: {
	employeeId: string;
	organizationId: string;
}) {
	await markEmployeeWorkBalanceFullRebuildRequested(input);
}
```

with an implementation that:

```ts
export async function requestEmployeeWorkBalanceFullRebuild(input: {
	employeeId: string;
	organizationId: string;
}) {
	await withEmployeeWorkBalanceLock(input, async (tx) => {
		// Delete scoped period rows, then upsert the hidden aggregate marker.
	});
}
```

Use a marker date such as `0001-01-01` so normal dirty rows are not hidden by public reads. `getEmployeeWorkBalance` should return `null` for that marker.

- [ ] **Step 3: Promote stale selected refreshes to full rebuild**

Inside locked refresh, re-read the current aggregate row after acquiring the lock. Force full rebuild if the row is missing or is the reset marker, even when the job selected the employee before the reset happened.

- [ ] **Step 4: Pass the locked transaction client through helpers**

Allow service and period aggregation helpers to accept an optional transaction client. Use it for work-balance reads/writes inside the lock, while preserving default module-`db` behavior for existing callers.

- [ ] **Step 5: Remove unused test mock code if needed**

If Vitest or TypeScript reports `markEmployeeWorkBalanceFullRebuildRequested` mock setup as unused in `apps/webapp/src/lib/work-balance/service.test.ts`, remove only the obsolete assertions or setup for that test. Do not remove the module mock if other tests still need it.

- [ ] **Step 6: Run the focused service test and verify it passes**

Run:

```bash
pnpm --filter webapp test src/lib/work-balance/service.test.ts -- --runInBand
```

Expected: PASS for `service.test.ts`.

## Task 3: Verify Server Action Contract Still Holds

**Files:**
- Read-only unless a failing test reveals a real contract change: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Run employee mutation tests**

Run:

```bash
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts' -- --runInBand
```

Expected: PASS. The server action should still call `requestEmployeeWorkBalanceFullRebuild` after org-admin authorization and organization-scoped employee lookup.

- [ ] **Step 2: If the test fails only because the mocked service behavior changed, keep the action contract unchanged**

The expected assertion should remain:

```ts
expect(mocks.requestEmployeeWorkBalanceFullRebuild).toHaveBeenCalledWith({
	employeeId: validEmployeeId,
	organizationId: "org-1",
});
```

Do not make the server action delete rows directly. The deletion belongs in `apps/webapp/src/lib/work-balance/service.ts`.

## Task 4: Final Verification

**Files:**
- No code changes expected unless verification exposes a regression.

- [ ] **Step 1: Run focused work-balance job tests**

Run:

```bash
pnpm --filter webapp test src/lib/jobs/work-balance.test.ts -- --runInBand
```

Expected: PASS. The job can still rebuild employees selected by the existing missing-balance path.

- [ ] **Step 2: Run TypeScript or lint check available for webapp**

Run:

```bash
pnpm --filter webapp lint
```

Expected: PASS. If the repository does not define a `lint` script for `webapp`, record that exact command output and run the focused tests from Tasks 2 and 3 again instead.

- [ ] **Step 3: Inspect the diff**

Run:

```bash
git diff -- apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts
```

Expected: The diff only changes the recalculation service behavior and its tests. It should not alter authorization, UI copy, time-tracking source data, or unrelated balance computations.

- [ ] **Step 4: Commit if requested by the user**

Only commit if the user explicitly asks. Use:

```bash
git add apps/webapp/src/lib/work-balance/service.ts apps/webapp/src/lib/work-balance/service.test.ts docs/superpowers/specs/2026-05-26-employee-work-balance-recalculation-reset-design.md docs/superpowers/plans/2026-05-26-employee-work-balance-recalculation-reset.md
git commit -m "fix: reset employee work balance recalculation state"
```

## Self-Review

- Spec coverage: The plan deletes calculated period rows, hides the aggregate as not-yet-calculated with an internal marker, preserves the existing action contract, does not change UI or source time data, and forces full rebuild for missing or reset-marker aggregate rows.
- Placeholder scan: No placeholder steps remain; each code change and command includes concrete content.
- Type consistency: Function names, table names, and file paths match the current codebase.
