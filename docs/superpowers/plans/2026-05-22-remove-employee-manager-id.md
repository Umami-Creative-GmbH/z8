# Remove Employee Manager ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove deprecated `employee.manager_id` and make `employee_managers` the consistent direct-manager source of truth.

**Architecture:** Add a focused manager-resolution helper for single default approver selection, migrate approval and permission flows away from employee-row `managerId`, then remove the schema column and index with a backfill migration. Keep team primary manager fallback only where approval routing already supports it.

**Tech Stack:** Next.js server actions, TypeScript, Drizzle ORM, PostgreSQL SQL migrations, Vitest, Effect.

---

## File Structure

- Modify `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts`: expose a primary eligible manager helper for approval routing.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`: remove legacy fallback from absence approver selection.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect-helpers.ts`: remove selector that accepts legacy manager state.
- Modify `apps/webapp/src/lib/absences/permissions.ts`: authorize managers through `employee_managers` instead of `employee.managerId`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`: route correction approvals through the shared primary eligible manager helper.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts` and `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`: replace manual-entry and clocking approval reads of `emp.managerId` with `employee_managers` lookup or shared helper.
- Modify `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.claims.ts`: route claim approval through `employee_managers`.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/compliance/actions.ts`: replace direct employee manager metadata with canonical manager links.
- Modify `apps/webapp/src/lib/effect/services/manager.service.ts`: stop syncing `employee.managerId` during manager assignment/removal.
- Modify `apps/webapp/src/db/schema/organization.ts` and `apps/webapp/src/db/schema/relations.ts`: remove `employee.managerId` and relation/index references.
- Add `apps/webapp/drizzle/00XX_remove_employee_manager_id.sql`: backfill `employee_managers`, drop the legacy index, drop the column.
- Update tests adjacent to each changed flow.

### Task 1: Add Primary Eligible Manager DB Helper

**Files:**
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts`
- Test: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.test.ts`

- [ ] **Step 1: Write failing tests for primary manager resolution**

Add tests proving the DB helper prefers primary direct manager, falls back to team manager when no direct manager exists, and returns null when neither exists.

```ts
it("returns the primary eligible direct manager for a requester", async () => {
	const db = createEligibilityDb({
		employees: [
			{ id: "requester", organizationId: "org-1", isActive: true, role: "employee" },
			{ id: "manager-a", organizationId: "org-1", isActive: true, role: "manager" },
			{ id: "manager-b", organizationId: "org-1", isActive: true, role: "manager" },
		],
		managerLinks: [
			{ employeeId: "requester", managerId: "manager-a", isPrimary: false },
			{ employeeId: "requester", managerId: "manager-b", isPrimary: true },
		],
	});

	await expect(
		getPrimaryEligibleManagerIdForRequester({ db, requesterEmployeeId: "requester", organizationId: "org-1" }),
	).resolves.toBe("manager-b");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test src/lib/approvals/policies/manager-eligibility-db.test.ts`

Expected: FAIL because `getPrimaryEligibleManagerIdForRequester` is not exported.

- [ ] **Step 3: Implement the helper**

Export a helper that loads the same inputs as `getEligibleManagerIdsForRequester`, calls `resolvePrimaryEligibleManager`, and returns `managerId` or `null`.

```ts
export async function getPrimaryEligibleManagerIdForRequester(input: {
	db: ApprovalEligibilityDb;
	requesterEmployeeId: string;
	organizationId: string;
}) {
	const [employees, managerLinks] = await Promise.all([
		input.db.query.employee.findMany({ where: eq(employee.organizationId, input.organizationId) }),
		input.db.query.employeeManagers.findMany({
			where: eq(employeeManagers.employeeId, input.requesterEmployeeId),
		}),
	]);
	const { memberships, teams } = await getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
		requesterEmployeeIds: [input.requesterEmployeeId],
	});
	const result = resolvePrimaryEligibleManager({
		organizationId: input.organizationId,
		requesterEmployeeId: input.requesterEmployeeId,
		employees: employees as EligibleManagerEmployee[],
		managerLinks: managerLinks as EligibleManagerLink[],
		teamMemberships: memberships,
		teams,
	});

	return result.ok ? result.managerId : null;
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `pnpm --filter webapp test src/lib/approvals/policies/manager-eligibility-db.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts apps/webapp/src/lib/approvals/policies/manager-eligibility-db.test.ts && git commit -m "feat: add canonical primary manager resolver"`

### Task 2: Remove Legacy Manager Fallback From Absence Routing

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect-helpers.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.test.ts`

- [ ] **Step 1: Write failing test for absence approver selector removal**

Replace tests for `selectAbsenceDefaultApproverId` with tests around a canonical helper that does not accept `legacyManagerId`.

```ts
describe("selectAbsenceDefaultApproverId", () => {
	it("uses the resolved eligible manager", () => {
		expect(selectAbsenceDefaultApproverId({ eligibleManagerId: "manager-1" })).toBe("manager-1");
	});

	it("returns null when no eligible manager is resolved", () => {
		expect(selectAbsenceDefaultApproverId({ eligibleManagerId: null })).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test src/app/\[locale\]/\(app\)/absences/request-absence-effect.test.ts`

Expected: FAIL because the helper still accepts `legacyManagerId` and `eligibleManagerIds`.

- [ ] **Step 3: Implement absence routing change**

Import `getPrimaryEligibleManagerIdForRequester`, remove `legacyManagerId`, and select only the resolved eligible manager.

```ts
export function selectAbsenceDefaultApproverId(input: { eligibleManagerId: string | null }): string | null {
	return input.eligibleManagerId;
}
```

```ts
const defaultApproverId = category.requiresApproval
	? yield* _(getAbsenceDefaultApproverId(dbService, currentEmployee))
	: null;
```

Inside `getAbsenceDefaultApproverId`, call `getPrimaryEligibleManagerIdForRequester` and pass only `eligibleManagerId` into the selector.

- [ ] **Step 4: Run absence tests**

Run: `pnpm --filter webapp test src/app/\[locale\]/\(app\)/absences/request-absence-effect.test.ts src/lib/approvals/policies/manager-eligibility-db.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/webapp/src/app/\[locale\]/\(app\)/absences/request-absence-effect.ts apps/webapp/src/app/\[locale\]/\(app\)/absences/request-absence-effect-helpers.ts apps/webapp/src/app/\[locale\]/\(app\)/absences/request-absence-effect.test.ts && git commit -m "refactor: use canonical manager resolver for absences"`

### Task 3: Move Absence Permissions To Manager Links

**Files:**
- Modify: `apps/webapp/src/lib/absences/permissions.ts`
- Test: `apps/webapp/src/lib/absences/permissions.test.ts`

- [ ] **Step 1: Write failing permission tests**

Create or extend `permissions.test.ts` to mock `db.query.employeeManagers.findFirst` and verify manager authorization uses the link table.

```ts
it("allows managers to approve linked employee absences", async () => {
	mockDb.query.employee.findFirst
		.mockResolvedValueOnce({ id: "manager-1", role: "manager" })
		.mockResolvedValueOnce({ id: "employee-1", role: "employee" });
	mockDb.query.employeeManagers.findFirst.mockResolvedValueOnce({
		employeeId: "employee-1",
		managerId: "manager-1",
	});

	await expect(canApproveAbsence("manager-1", "employee-1")).resolves.toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test src/lib/absences/permissions.test.ts`

Expected: FAIL because permissions currently inspect `target.managerId`.

- [ ] **Step 3: Implement link-table authorization**

Import `employeeManagers` and check an assignment for manager permissions.

```ts
const managerRelation = await db.query.employeeManagers.findFirst({
	where: and(
		eq(employeeManagers.employeeId, targetEmployeeId),
		eq(employeeManagers.managerId, employeeId),
	),
});

if (approver.role === "manager" && managerRelation) {
	return true;
}
```

Apply the same pattern to `canEditEmployeeAllowance`.

- [ ] **Step 4: Run permission tests**

Run: `pnpm --filter webapp test src/lib/absences/permissions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/webapp/src/lib/absences/permissions.ts apps/webapp/src/lib/absences/permissions.test.ts && git commit -m "refactor: authorize absences through manager links"`

### Task 4: Migrate Time Tracking Approval Routing

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Tests: existing adjacent time-tracking action tests

- [ ] **Step 1: Write failing tests for no employee.managerId dependency**

In the relevant time-tracking tests, change employee fixtures so they omit `managerId` and provide `employeeManagers` primary manager mocks. Assert approval requests still use the primary manager.

```ts
expect(createApprovalRequestMock).toHaveBeenCalledWith(
	expect.objectContaining({ managerId: "manager-1" }),
);
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test src/app/\[locale\]/\(app\)/time-tracking/actions/approvals.test.ts src/app/\[locale\]/\(app\)/time-tracking/actions/clocking.test.ts`

Expected: FAIL because code still reads `managerId` from employee rows.

- [ ] **Step 3: Replace direct reads with resolver**

Use `getPrimaryEligibleManagerIdForRequester` for approval-required flows. If no manager is resolved, return the existing validation error message for correction requests and avoid silent approval for approval-required manual entries.

```ts
const managerId = yield* _(
	dbService.query("getPrimaryEligibleManagerForApproval", () =>
		getPrimaryEligibleManagerIdForRequester({
			db: dbService.db,
			requesterEmployeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
		}),
	),
);
```

- [ ] **Step 4: Run time-tracking tests**

Run: `pnpm --filter webapp test src/app/\[locale\]/\(app\)/time-tracking/actions/approvals.test.ts src/app/\[locale\]/\(app\)/time-tracking/actions/clocking.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/webapp/src/app/\[locale\]/\(app\)/time-tracking/actions.ts apps/webapp/src/app/\[locale\]/\(app\)/time-tracking/actions/corrections.ts apps/webapp/src/app/\[locale\]/\(app\)/time-tracking/actions/clocking.ts apps/webapp/src/app/\[locale\]/\(app\)/time-tracking && git commit -m "refactor: route time approvals through manager links"`

### Task 5: Migrate Travel Expense Approval Routing

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.claims.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.claims.test.ts`

- [ ] **Step 1: Write failing travel expense test**

Update the successful submission test so `findEmployee` does not return `managerId`; mock `employeeManagers.findMany` with a primary manager and assert the approval request uses it.

```ts
mockState.findEmployee.mockResolvedValueOnce({ id: "emp-1", organizationId: "org-1" });
mockState.findEmployeeManagers.mockResolvedValueOnce([
	{ employeeId: "emp-1", managerId: "manager-1", isPrimary: true },
]);
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter webapp test src/app/\[locale\]/\(app\)/travel-expenses/actions.claims.test.ts`

Expected: FAIL because submission expects `employee.managerId`.

- [ ] **Step 3: Implement claim approver resolution**

Use `getPrimaryEligibleManagerIdForRequester` before inserting `approvalRequest`. Preserve the existing failure behavior when no manager can be resolved.

- [ ] **Step 4: Run travel expense tests**

Run: `pnpm --filter webapp test src/app/\[locale\]/\(app\)/travel-expenses/actions.claims.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/webapp/src/app/\[locale\]/\(app\)/travel-expenses/actions.claims.ts apps/webapp/src/app/\[locale\]/\(app\)/travel-expenses/actions.claims.test.ts && git commit -m "refactor: route expense approvals through manager links"`

### Task 6: Remove ManagerService Denormalized Sync

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/manager.service.ts`
- Test: existing manager service tests or add `apps/webapp/src/lib/effect/services/manager.service.test.ts`

- [ ] **Step 1: Write failing test that assignment does not update employee manager column**

Assert `assignManager` only inserts/updates `employeeManagers` and does not call `db.update(employee).set({ managerId })`.

```ts
expect(updateEmployeeMock).not.toHaveBeenCalledWith(expect.objectContaining({ managerId: "manager-1" }));
```

- [ ] **Step 2: Run manager service test to verify failure**

Run: `pnpm --filter webapp test src/lib/effect/services/manager.service.test.ts`

Expected: FAIL because service still syncs the denormalized column.

- [ ] **Step 3: Remove sync writes**

Delete the `syncEmployeeManagerId` query from `assignManager` and the `update(employee).set({ managerId: newPrimary.managerId })` block from `removeManager`.

- [ ] **Step 4: Run manager service tests**

Run: `pnpm --filter webapp test src/lib/effect/services/manager.service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add apps/webapp/src/lib/effect/services/manager.service.ts apps/webapp/src/lib/effect/services/manager.service.test.ts && git commit -m "refactor: stop syncing legacy manager id"`

### Task 7: Remove Schema Column And Add Migration

**Files:**
- Modify: `apps/webapp/src/db/schema/organization.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Add: `apps/webapp/drizzle/00XX_remove_employee_manager_id.sql`
- Test: schema and migration tests

- [ ] **Step 1: Write failing schema/migration tests**

Update schema tests so `employee.managerId` is no longer expected and migration tests expect the drop statements.

```ts
expect("managerId" in employee).toBe(false);
```

- [ ] **Step 2: Run schema tests to verify failure**

Run: `pnpm --filter webapp test src/db/schema/__tests__/approval-policy-schema.test.ts src/db/__tests__/drizzle-migrations.test.ts`

Expected: FAIL because the schema still contains `managerId` and no migration drops it.

- [ ] **Step 3: Add migration SQL**

Use the next available migration number in `apps/webapp/drizzle`.

```sql
INSERT INTO employee_managers (employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
SELECT
	e.id,
	e.manager_id,
	NOT EXISTS (
		SELECT 1 FROM employee_managers existing_primary
		WHERE existing_primary.employee_id = e.id AND existing_primary.is_primary = true
	),
	e.user_id,
	NOW(),
	NOW()
FROM employee e
WHERE e.manager_id IS NOT NULL
AND NOT EXISTS (
	SELECT 1 FROM employee_managers existing
	WHERE existing.employee_id = e.id AND existing.manager_id = e.manager_id
);
--> statement-breakpoint
DROP INDEX IF EXISTS "employee_managerId_idx";
--> statement-breakpoint
ALTER TABLE "employee" DROP COLUMN IF EXISTS "manager_id";
```

- [ ] **Step 4: Remove schema references**

Delete `managerId: uuid("manager_id")`, `index("employee_managerId_idx")`, and the `manager` relation on `employee.managerId` from `relations.ts`.

- [ ] **Step 5: Run schema and migration tests**

Run: `pnpm --filter webapp test src/db/schema/__tests__/approval-policy-schema.test.ts src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add apps/webapp/src/db/schema/organization.ts apps/webapp/src/db/schema/relations.ts apps/webapp/drizzle/00XX_remove_employee_manager_id.sql apps/webapp/src/db && git commit -m "refactor: remove employee manager id column"`

### Task 8: Sweep Remaining References And Verify

**Files:**
- Modify any files still returned by reference search.

- [ ] **Step 1: Search for legacy references**

Run: `rg "employee\.managerId|managerId: uuid\(\"manager_id\"\)|employee_managerId_idx|target\.managerId|currentEmployee\.managerId|emp\.managerId" apps/webapp/src apps/webapp/drizzle`

Expected: no runtime/schema references to the legacy employee field. References to `employeeManagers.managerId`, local parameter names, team `primaryManagerId`, and approval request `approverId` may remain.

- [ ] **Step 2: Fix any remaining legacy reads**

Replace remaining legacy reads with `employee_managers` lookups or `getPrimaryEligibleManagerIdForRequester`. Do not change unrelated managerId names that belong to `employeeManagers`, teams, analytics grouping, or approval request records.

- [ ] **Step 3: Run targeted test suite**

Run: `pnpm --filter webapp test src/lib/approvals/policies/manager-eligibility-db.test.ts src/lib/approvals/policies/chain-service.test.ts src/app/\[locale\]/\(app\)/absences/request-absence-effect.test.ts src/app/\[locale\]/\(app\)/travel-expenses/actions.claims.test.ts src/app/\[locale\]/\(app\)/time-tracking/actions/approvals.test.ts src/app/\[locale\]/\(app\)/time-tracking/actions/clocking.test.ts src/lib/absences/permissions.test.ts`

Expected: PASS.

- [ ] **Step 4: Run TypeScript check if generated Next types are usable**

Run: `pnpm --filter webapp exec tsc --noEmit`

Expected: PASS, unless blocked by the known `.next/dev/types/routes.d.ts is not a module` generated type issue. If blocked, report that exact blocker.

- [ ] **Step 5: Commit final sweep**

Run: `git add apps/webapp && git commit -m "test: cover canonical manager routing"`

## Self-Review

- Spec coverage: the plan covers canonical manager data, backfill migration, runtime routing, permission checks, denormalized write removal, schema removal, and verification.
- Placeholder scan: no TBD/TODO/fill-later placeholders are present.
- Type consistency: the helper name is consistently `getPrimaryEligibleManagerIdForRequester`; the canonical table remains `employeeManagers` in TypeScript and `employee_managers` in SQL.
