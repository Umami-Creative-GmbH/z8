# Suspended Employee Seat Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop billing suspended employees as seats while preserving historical employee records and existing admin/manager calendar access.

**Architecture:** Introduce one shared billing-seat counter that joins approved organization members to active employee records. Use it from seat sync and subscription services, then trigger seat sync after employee suspension/reactivation with lifecycle-specific audit records. Update lifecycle UI copy so admins understand the billing impact.

**Tech Stack:** Next.js App Router, Drizzle ORM, Effect services, Better Auth organization membership, Stripe Billing subscription quantities, Vitest, React.

---

## File Structure

- Create: `apps/webapp/src/lib/effect/services/billing/billable-seat-count.ts`
  - Owns the single definition of billable seats.
- Create: `apps/webapp/src/lib/effect/services/billing/billable-seat-count.test.ts`
  - Verifies active employees count, inactive employees do not, pending/demo records do not.
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`
  - Use shared counter and add lifecycle audit methods.
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.test.ts`
  - Verify shared counter adoption and lifecycle audit actions.
- Modify: `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`
  - Use shared counter for subscription display and local trial seat count.
- Modify: `apps/webapp/src/lib/effect/services/billing/subscription.service.test.ts` if an existing test is present, otherwise add focused source/service tests near the service.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
  - Trigger lifecycle seat sync after successful suspend/reactivate without failing lifecycle state changes for transient billing/Stripe errors.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
  - Verify suspend/reactivate calls lifecycle seat sync.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-lifecycle-card.tsx`
  - Mention paid-seat impact in suspend/reactivate copy.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`
  - Verify paid-seat copy is covered by the existing lifecycle UI tests or translation fallbacks.

## Task 1: Shared Billable Seat Counter

**Files:**
- Create: `apps/webapp/src/lib/effect/services/billing/billable-seat-count.ts`
- Create: `apps/webapp/src/lib/effect/services/billing/billable-seat-count.test.ts`

- [ ] **Step 1: Write the failing billable seat counter test**

Create `apps/webapp/src/lib/effect/services/billing/billable-seat-count.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { member, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { countBillableSeats } from "./billable-seat-count";

const { select, selectFrom, selectInnerJoin, selectWhere } = vi.hoisted(() => ({
	select: vi.fn(),
	selectFrom: vi.fn(),
	selectInnerJoin: vi.fn(),
	selectWhere: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { select },
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...conditions) => ({ type: "and", conditions })),
	countDistinct: vi.fn((column) => ({ type: "countDistinct", column })),
	eq: vi.fn((column, value) => ({ type: "eq", column, value })),
	notLike: vi.fn((column, value) => ({ type: "notLike", column, value })),
}));

describe("countBillableSeats", () => {
	it("counts approved non-demo members with active employee profiles only", async () => {
		select.mockReturnValue({ from: selectFrom });
		selectFrom.mockReturnValue({ innerJoin: selectInnerJoin });
		selectInnerJoin
			.mockReturnValueOnce({ innerJoin: selectInnerJoin })
			.mockReturnValueOnce({ where: selectWhere });
		selectWhere.mockResolvedValueOnce([{ count: 2 }]);

		const result = await countBillableSeats("org_123");

		expect(result).toBe(2);
		expect(selectFrom).toHaveBeenCalledWith(member);
		expect(selectInnerJoin).toHaveBeenNthCalledWith(1, user, {
			type: "eq",
			column: user.id,
			value: member.userId,
		});
		expect(selectInnerJoin).toHaveBeenNthCalledWith(2, employee, {
			type: "and",
			conditions: [
				{ type: "eq", column: employee.userId, value: member.userId },
				{ type: "eq", column: employee.organizationId, value: member.organizationId },
			],
		});
		expect(selectWhere).toHaveBeenCalledWith({
			type: "and",
			conditions: [
				{ type: "eq", column: member.organizationId, value: "org_123" },
				{ type: "eq", column: member.status, value: "approved" },
				{ type: "eq", column: employee.isActive, value: true },
				{ type: "notLike", column: user.email, value: "%@demo.invalid" },
			],
		});
	});
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/billable-seat-count.test.ts
```

Expected: FAIL because `./billable-seat-count` does not exist.

- [ ] **Step 3: Implement the shared counter**

Create `apps/webapp/src/lib/effect/services/billing/billable-seat-count.ts`:

```ts
import { and, countDistinct, eq, notLike } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";

export async function countBillableSeats(organizationId: string): Promise<number> {
	const [result] = await db
		.select({ count: countDistinct(member.id) })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.innerJoin(
			employee,
			and(eq(employee.userId, member.userId), eq(employee.organizationId, member.organizationId)),
		)
		.where(
			and(
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
				eq(employee.isActive, true),
				notLike(user.email, "%@demo.invalid"),
			),
		);

	return result?.count ?? 0;
}
```

- [ ] **Step 4: Run the counter test**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/billable-seat-count.test.ts
```

Expected: PASS.

## Task 2: Use Shared Counter In Billing Services

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/billing/subscription.service.ts`
- Test: `apps/webapp/src/lib/effect/services/billing/billable-seat-count.test.ts`

- [ ] **Step 1: Update SeatSyncService tests to assert helper use and active employee semantics**

In `seat-sync.service.test.ts`, remove direct query-chain mocking for the seat count query and mock the shared helper instead:

```ts
const { countBillableSeatsMock } = vi.hoisted(() => ({
	countBillableSeatsMock: vi.fn(),
}));

vi.mock("./billable-seat-count", () => ({
	countBillableSeats: countBillableSeatsMock,
}));
```

Replace the existing `counts only approved non-demo organization members` test with:

```ts
it("gets current seats from the shared active-employee billable seat counter", async () => {
	countBillableSeatsMock.mockResolvedValueOnce(3);

	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const seatSyncService = yield* SeatSyncService;

			return yield* seatSyncService.getCurrentSeatCount("org_123");
		}).pipe(Effect.provide(SeatSyncServiceLive), Effect.provide(appLayer)),
	);

	expect(result).toBe(3);
	expect(countBillableSeatsMock).toHaveBeenCalledWith("org_123");
});
```

- [ ] **Step 2: Run SeatSyncService test to verify failure before implementation**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/seat-sync.service.test.ts
```

Expected: FAIL because `SeatSyncService` still uses its local member-counting function.

- [ ] **Step 3: Update SeatSyncService to use the shared counter**

In `seat-sync.service.ts`:

1. Remove `count`, `notLike`, `member`, and `user` imports that are only used by the old local counter.
2. Add:

```ts
import { countBillableSeats } from "./billable-seat-count";
```

3. Delete the local `countBillableMembers` function.
4. Replace both calls to `countBillableMembers(organizationId)` with:

```ts
countBillableSeats(organizationId)
```

- [ ] **Step 4: Update SubscriptionService to use the shared counter**

In `subscription.service.ts`:

1. Remove `and`, `count`, `notLike`, `member`, and `user` imports if they are only used by `countBillableOrganizationMembers`.
2. Add:

```ts
import { countBillableSeats } from "./billable-seat-count";
```

3. Delete `countBillableOrganizationMembers`.
4. Replace:

```ts
const currentSeats = await countBillableOrganizationMembers(organizationId);
```

with:

```ts
const currentSeats = await countBillableSeats(organizationId);
```

5. Replace:

```ts
const currentSeats = await countBillableOrganizationMembers(organizationId);
```

inside `ensureLocalTrial` with the same shared helper call.

- [ ] **Step 5: Run billing service tests**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/billable-seat-count.test.ts src/lib/effect/services/billing/seat-sync.service.test.ts
```

Expected: PASS.

## Task 3: Add Lifecycle Seat Sync And Audit Actions

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/billing/seat-sync.service.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Extend SeatSyncService contract tests for lifecycle audit**

In `seat-sync.service.test.ts`, add `insert`, `insertValues`, and a configurable subscription/stripe service if they are not already present. Add this test:

```ts
it("logs employee lifecycle seat audits after syncing seats", async () => {
	countBillableSeatsMock.mockResolvedValueOnce(4);
	const updateSeatCount = vi.fn(() => Effect.void);
	const getByOrganization = vi.fn(() =>
		Effect.succeed({
			id: "sub-1",
			organizationId: "org_123",
			stripeCustomerId: "cus_123",
			stripeSubscriptionId: null,
			status: "active",
			isActive: true,
			isTrialing: false,
			isPastDue: false,
			currentSeats: 6,
			trialStart: null,
			trialEnd: null,
			currentPeriodEnd: null,
			billingInterval: "month",
			cancelAt: null,
		}),
	);
	const insertValues = vi.fn().mockResolvedValue(undefined);
	insert.mockReturnValueOnce({ values: insertValues });

	const layer = Layer.mergeAll(
		Layer.succeed(StripeService, StripeService.of({ ...stripeServiceFixture, config: { ...stripeServiceFixture.config, enabled: false } })),
		Layer.succeed(SubscriptionService, SubscriptionService.of({ ...subscriptionServiceFixture, getByOrganization, updateSeatCount })),
	);

	await Effect.runPromise(
		Effect.gen(function* () {
			const seatSyncService = yield* SeatSyncService;
			yield* seatSyncService.handleEmployeeSuspended("org_123", "employee-1", "user-1");
		}).pipe(Effect.provide(SeatSyncServiceLive), Effect.provide(layer)),
	);

	expect(updateSeatCount).toHaveBeenCalledWith("org_123", 4);
	expect(insertValues).toHaveBeenCalledWith({
		organizationId: "org_123",
		action: "employee_suspended",
		previousSeats: 6,
		newSeats: 4,
		memberId: "employee-1",
		userId: "user-1",
		stripeReported: false,
	});
});
```

If the existing test fixtures are inline, create `stripeServiceFixture` and `subscriptionServiceFixture` constants at the top of the test file from the current mocked services so this test can override `getByOrganization` and `updateSeatCount` without duplicating every method.

- [ ] **Step 2: Run SeatSyncService lifecycle test to verify failure**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/seat-sync.service.test.ts
```

Expected: FAIL because `handleEmployeeSuspended` does not exist.

- [ ] **Step 3: Add lifecycle methods to SeatSyncService**

In `seat-sync.service.ts`, extend the service interface with:

```ts
readonly handleEmployeeSuspended: (
	organizationId: string,
	employeeId: string,
	userId: string,
) => Effect.Effect<void, DatabaseError | StripeError>;

readonly handleEmployeeReactivated: (
	organizationId: string,
	employeeId: string,
	userId: string,
) => Effect.Effect<void, DatabaseError | StripeError>;
```

Add a shared internal function inside `SeatSyncServiceLive`:

```ts
const handleEmployeeLifecycleSeatChange = (
	organizationId: string,
	employeeId: string,
	userId: string,
	action: "employee_suspended" | "employee_reactivated",
) =>
	Effect.gen(function* () {
		const sub = yield* subscriptionService.getByOrganization(organizationId);
		const previousSeats = sub?.currentSeats ?? 0;
		const newSeats = yield* syncSeatsForOrganization(organizationId);

		yield* Effect.tryPromise({
			try: async () => {
				await db.insert(billingSeatAudit).values({
					organizationId,
					action,
					previousSeats,
					newSeats,
					memberId: employeeId,
					userId,
					stripeReported: stripeService.config.enabled && !!sub?.stripeSubscriptionId,
				});
			},
			catch: (error) =>
				new DatabaseError({
					message: "Failed to log employee lifecycle seat audit",
					operation: action,
					table: "billing_seat_audit",
					cause: error,
				}),
		});

		logger.info({ organizationId, employeeId, previousSeats, newSeats, action }, "Employee lifecycle seats synced");
	});
```

Return methods:

```ts
handleEmployeeSuspended: (organizationId, employeeId, userId) =>
	handleEmployeeLifecycleSeatChange(organizationId, employeeId, userId, "employee_suspended"),

handleEmployeeReactivated: (organizationId, employeeId, userId) =>
	handleEmployeeLifecycleSeatChange(organizationId, employeeId, userId, "employee_reactivated"),
```

- [ ] **Step 4: Trigger lifecycle seat sync from employee actions**

In `employee-mutations.actions.ts`, add imports:

```ts
import { Layer } from "effect";
import {
	SeatSyncService,
	SeatSyncServiceLive,
	StripeServiceLive,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";
```

Add helper near `setEmployeeLifecycleAction`:

```ts
function syncBillingSeatsAfterEmployeeLifecycleChange(params: {
	organizationId: string;
	employeeId: string;
	userId: string;
	action: "suspend" | "reactivate";
}) {
	const layers = SeatSyncServiceLive.pipe(
		Layer.provide(StripeServiceLive),
		Layer.provide(SubscriptionServiceLive),
	);

	return Effect.gen(function* (_) {
		const seatSyncService = yield* _(SeatSyncService);

		if (params.action === "suspend") {
			yield* _(
				seatSyncService.handleEmployeeSuspended(
					params.organizationId,
					params.employeeId,
					params.userId,
				),
			);
			return;
		}

		yield* _(
			seatSyncService.handleEmployeeReactivated(
				params.organizationId,
				params.employeeId,
				params.userId,
			),
		);
	}).pipe(
		Effect.provide(layers),
		Effect.catchAll((error) =>
			Effect.sync(() => {
				logger.error(
					{
						error,
						organizationId: params.organizationId,
						employeeId: params.employeeId,
						action: params.action,
					},
					"Failed to sync billing seats after employee lifecycle change",
				);
			}),
		),
	);
}
```

After `revalidateEmployeesCache(targetEmployee.organizationId);`, add:

```ts
yield* _(
	syncBillingSeatsAfterEmployeeLifecycleChange({
		organizationId: targetEmployee.organizationId,
		employeeId: targetEmployee.id,
		userId: targetEmployee.userId,
		action,
	}),
);
```

This logs billing sync failures but does not fail the already-completed lifecycle action.

- [ ] **Step 5: Update employee mutation tests for lifecycle seat sync source behavior**

In `employee-mutations.actions.test.ts`, add a source-level regression test in the lifecycle describe block:

```ts
it("triggers lifecycle-specific billing seat sync after employee lifecycle changes", () => {
	const source = readFileSync(new URL("./employee-mutations.actions.ts", import.meta.url), "utf8");

	expect(source).toContain("syncBillingSeatsAfterEmployeeLifecycleChange");
	expect(source).toContain("handleEmployeeSuspended");
	expect(source).toContain("handleEmployeeReactivated");
	expect(source).toContain("Failed to sync billing seats after employee lifecycle change");
});
```

- [ ] **Step 6: Run lifecycle and billing tests**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/billable-seat-count.test.ts src/lib/effect/services/billing/seat-sync.service.test.ts "src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts"
```

Expected: PASS.

## Task 4: Update Lifecycle UI Billing Copy

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-lifecycle-card.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`

- [ ] **Step 1: Write/update UI copy tests**

In `page-sections.test.tsx`, add source or render-level expectations for paid-seat copy. If the file already imports `EmployeeLifecycleCard`, render it with an active real employee and assert the confirmation copy includes `paid seat`. Render it with an inactive real employee and assert the description includes `paid seat`.

Use exact fallback strings:

```ts
expect(screen.getByText(/stops consuming a paid seat/i)).toBeTruthy();
expect(screen.getByText(/will count as a paid seat again/i)).toBeTruthy();
```

- [ ] **Step 2: Run UI test to verify failure**

Run:

```bash
pnpm --filter webapp test "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"
```

Expected: FAIL because current copy does not mention paid seats.

- [ ] **Step 3: Update lifecycle card copy**

In `employee-lifecycle-card.tsx`, change active description fallback to:

```ts
"Suspending disables account access, stops this employee from consuming a paid seat, and preserves historical records."
```

Change inactive description fallback to:

```ts
"Reactivation restores the employee profile and web app access. The employee will count as a paid seat again."
```

Change confirmation description fallback to:

```ts
"This will disable account access and stop this employee from consuming a paid seat. Historical records will be preserved."
```

- [ ] **Step 4: Run UI test again**

Run:

```bash
pnpm --filter webapp test "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"
```

Expected: PASS.

## Task 5: Final Verification

**Files:**
- Verify only; do not edit unless a command reveals a feature regression.

- [ ] **Step 1: Run targeted billing and lifecycle tests**

Run:

```bash
pnpm --filter webapp test src/lib/effect/services/billing/billable-seat-count.test.ts src/lib/effect/services/billing/seat-sync.service.test.ts "src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts" "src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx"
```

Expected: PASS.

- [ ] **Step 2: Run existing suspension regression set**

Run:

```bash
pnpm --filter webapp test "src/app/api/calendar/events/route.test.ts" "src/lib/query/use-employee.test.ts"
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run full test suite and record known blocker if unchanged**

Run:

```bash
pnpm test
```

Expected: PASS if the existing stale Docker worker manifest issue has been fixed. If it fails with only `Docker target worker generated files are stale: - docker/targets/worker/package.json`, record that exact existing blocker and do not modify Docker manifests unless the user explicitly asks.

- [ ] **Step 5: Inspect diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: Diff includes only billing seat counting/sync, employee lifecycle billing trigger/copy, tests, and the previously approved suspension files already in the worktree.

## Self-Review Notes

- Spec coverage: billable active employees, shared helper, SeatSyncService and SubscriptionService adoption, lifecycle-triggered sync, Stripe quantity behavior, lifecycle audit entries, UI copy, and tests are covered.
- Deferred-work marker scan: no `TBD`, `TODO`, vague implementation steps, or undefined follow-up tasks remain.
- Type consistency: shared helper is `countBillableSeats`, lifecycle service methods are `handleEmployeeSuspended` and `handleEmployeeReactivated`, audit actions are `employee_suspended` and `employee_reactivated`.

## Commit Policy

Do not commit unless the user explicitly requests a commit. If commit approval is given after verification, inspect `git status`, `git diff`, and `git log --oneline -10`, then commit only the intended files.
