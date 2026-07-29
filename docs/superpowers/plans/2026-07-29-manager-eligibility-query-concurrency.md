# Manager Eligibility Query Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve both manager eligibility sequential-await warnings by running independent organization-scoped reads concurrently.

**Architecture:** Each warned database function will await one `Promise.all` containing its employee read, direct-manager read, and existing team-eligibility helper. Deferred database mocks will prove all reads start before any one read resolves, while existing behavior tests continue to verify eligibility results and schema fallback behavior.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, React Doctor, pnpm

---

### Task 1: Specify Concurrent Query Startup

**Files:**
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.test.ts:1-120`
- Test: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.test.ts`

- [ ] **Step 1: Import both warned functions**

Update the imports to include `getEligibleManagerIdsForRequester`:

```ts
import {
	getEligibleApprovalScopesForManager,
	getEligibleManagerIdsForRequester,
	getPrimaryEligibleManagerIdForRequester,
} from "./manager-eligibility-db";
```

- [ ] **Step 2: Add a deferred database fixture**

Add this helper after `createDeferred`:

```ts
function createDeferredEligibilityDb() {
	const employees = createDeferred<unknown[]>();
	const managerLinks = createDeferred<unknown[]>();
	const memberships = createDeferred<unknown[]>();
	const teams = createDeferred<unknown[]>();

	return {
		employees,
		managerLinks,
		memberships,
		teams,
		db: {
			query: {
				employee: { findMany: vi.fn(() => employees.promise) },
				employeeManagers: { findMany: vi.fn(() => managerLinks.promise) },
				teamMembership: { findMany: vi.fn(() => memberships.promise) },
				team: { findMany: vi.fn(() => teams.promise) },
			},
		},
	};
}
```

- [ ] **Step 3: Replace the sequencing test with two concurrency tests**

Replace `starts manager and team eligibility reads after the organization employee read resolves` with:

```ts
it("starts all reads concurrently when resolving eligible manager IDs", async () => {
	const pending = createDeferredEligibilityDb();
	const result = getEligibleManagerIdsForRequester({
		db: pending.db,
		requesterEmployeeId: "requester-1",
		organizationId: "org-1",
	});

	expect(pending.db.query.employee.findMany).toHaveBeenCalledOnce();
	expect(pending.db.query.employeeManagers.findMany).toHaveBeenCalledOnce();
	expect(pending.db.query.teamMembership.findMany).toHaveBeenCalledOnce();
	expect(pending.db.query.team.findMany).toHaveBeenCalledOnce();

	pending.employees.resolve([
		{
			id: "requester-1",
			organizationId: "org-1",
			isActive: true,
			role: "employee",
		},
	]);
	pending.managerLinks.resolve([]);
	pending.memberships.resolve([]);
	pending.teams.resolve([]);
	await expect(result).resolves.toEqual([]);
});

it("starts all reads concurrently when resolving the primary manager", async () => {
	const pending = createDeferredEligibilityDb();
	const result = getPrimaryEligibleManagerIdForRequester({
		db: pending.db,
		requesterEmployeeId: "requester-1",
		organizationId: "org-1",
	});

	expect(pending.db.query.employee.findMany).toHaveBeenCalledOnce();
	expect(pending.db.query.employeeManagers.findMany).toHaveBeenCalledOnce();
	expect(pending.db.query.teamMembership.findMany).toHaveBeenCalledOnce();
	expect(pending.db.query.team.findMany).toHaveBeenCalledOnce();

	pending.employees.resolve([
		{
			id: "requester-1",
			organizationId: "org-1",
			isActive: true,
			role: "employee",
		},
	]);
	pending.managerLinks.resolve([]);
	pending.memberships.resolve([]);
	pending.teams.resolve([]);
	await expect(result).resolves.toBeNull();
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run:

```bash
pnpm test --run src/lib/approvals/policies/manager-eligibility-db.test.ts
```

Working directory: `apps/webapp`

Expected: FAIL because `employeeManagers.findMany`, `teamMembership.findMany`, and `team.findMany` have not started while the employee promise remains unresolved.

### Task 2: Parallelize Both Eligibility Read Groups

**Files:**
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts:106-164`
- Test: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.test.ts`

- [ ] **Step 1: Parallelize `getEligibleManagerIdsForRequester`**

Replace its separate employee await and following `Promise.all` with:

```ts
const [employees, managerLinks, { memberships, teams }] = await Promise.all([
	input.db.query.employee.findMany({
		where: eq(employee.organizationId, input.organizationId),
	}),
	input.db.query.employeeManagers.findMany({
		where: eq(employeeManagers.employeeId, input.requesterEmployeeId),
	}),
	getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
		requesterEmployeeIds: [input.requesterEmployeeId],
	}),
]);
```

- [ ] **Step 2: Parallelize `getPrimaryEligibleManagerIdForRequester`**

Apply the same query group inside the primary-manager function:

```ts
const [employees, managerLinks, { memberships, teams }] = await Promise.all([
	input.db.query.employee.findMany({
		where: eq(employee.organizationId, input.organizationId),
	}),
	input.db.query.employeeManagers.findMany({
		where: eq(employeeManagers.employeeId, input.requesterEmployeeId),
	}),
	getTeamEligibilityInputs({
		db: input.db,
		organizationId: input.organizationId,
		requesterEmployeeIds: [input.requesterEmployeeId],
	}),
]);
```

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
pnpm test --run src/lib/approvals/policies/manager-eligibility-db.test.ts
```

Working directory: `apps/webapp`

Expected: all manager eligibility tests pass, including both concurrency tests.

### Task 3: Validate the Final Change

**Files:**
- Verify: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts`
- Verify: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.test.ts`

- [ ] **Step 1: Run webapp typechecking**

Run:

```bash
pnpm typecheck
```

Working directory: `apps/webapp`

Expected: route type generation and TypeScript compilation complete successfully.

- [ ] **Step 2: Check the diff for whitespace errors**

Run:

```bash
git diff --check
```

Working directory: repository root

Expected: no output and exit code 0.

- [ ] **Step 3: Run React Doctor against changed code**

Run:

```bash
pnpm dlx react-doctor@latest --verbose --scope changed --yes
```

Working directory: `apps/webapp`

Expected: neither `manager-eligibility-db.ts:114` nor `manager-eligibility-db.ts:143` reports `react-doctor/server-sequential-independent-await`, and the health score does not regress from 91.

- [ ] **Step 4: Review repository status**

Run:

```bash
git status --short
```

Expected: only the approved specification, implementation plan, manager eligibility implementation, and manager eligibility test are modified or untracked. Do not commit unless explicitly requested.
