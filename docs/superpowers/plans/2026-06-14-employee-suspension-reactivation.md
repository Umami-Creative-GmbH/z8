# Employee Suspension And Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-admin employee suspension/reactivation that disables app access while preserving authorized historical calendar access for inactive employees.

**Architecture:** Reuse `employee.isActive` as the lifecycle flag. Add focused server actions beside existing employee mutations, expose them through the employee detail query hook, add a small detail-page lifecycle card, and relax calendar target-employee active filtering while keeping the viewer active and organization-scoped.

**Tech Stack:** Next.js App Router, React, TanStack Query, TanStack Form-adjacent settings UI, Drizzle ORM, Effect server actions, Vitest, Luxon for calendar boundaries.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
  - Add `suspendEmployeeAction` and `reactivateEmployeeAction`.
  - Keep authorization, organization scoping, auth-user access updates, cache revalidation, and logging together with existing employee mutations.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
  - Export client-facing wrappers `suspendEmployee` and `reactivateEmployee`.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
  - Add unit tests for lifecycle actions and source-level export checks.
- Modify: `apps/webapp/src/lib/query/use-employee.ts`
  - Add TanStack Query mutations for suspend/reactivate and invalidate employee/calendar query caches.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-lifecycle-card.tsx`
  - Render org-admin-only suspend/reactivate controls for real employee records.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
  - Wire the lifecycle card into the detail page and toast/refetch after actions.
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
  - Keep current viewer lookup active-only, but remove active-only requirement from the target employee lookup.
- Modify: `apps/webapp/src/app/api/calendar/events/route.test.ts`
  - Add tests for inactive target access and inactive viewer rejection.

## Task 1: Add Employee Lifecycle Server Actions

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Write failing lifecycle action tests**

Add `suspendEmployeeAction` and `reactivateEmployeeAction` to the import list in `employee-mutations.actions.test.ts`:

```ts
import {
	assignManagersAction,
	createEmployeeAction,
	requestEmployeeWorkBalanceRecalculationAction,
	reactivateEmployeeAction,
	suspendEmployeeAction,
	updateEmployeeAction,
	updateEmployeeInvitationDraftAction,
} from "./employee-mutations.actions";
```

Add this test block after the `updateEmployeeAction` describe block:

```ts
describe("employee lifecycle actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function setupLifecycleActionTest() {
		const employeeWhere = vi.fn().mockResolvedValue(undefined);
		const employeeSet = vi.fn(() => ({ where: employeeWhere }));
		const userWhere = vi.fn().mockResolvedValue(undefined);
		const userSet = vi.fn(() => ({ where: userWhere }));
		const update = vi
			.fn()
			.mockReturnValueOnce({ set: employeeSet })
			.mockReturnValueOnce({ set: userSet });
		const dbService = {
			db: { update },
			query: vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run)),
		};

		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromise(options.execute({ setAttribute: vi.fn() })),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(
			Effect.succeed({
				accessTier: "orgAdmin",
				organizationId: "org-1",
				session: { user: { id: "user-admin-1", email: "admin@example.com" } },
				dbService,
			}),
		);
		mocks.requireOrgAdminEmployeeSettingsAccess.mockReturnValue(Effect.void);
		mocks.getTargetEmployee.mockReturnValue(
			Effect.succeed({
				id: "employee-1",
				userId: validUserId,
				organizationId: "org-1",
				isActive: true,
			}),
		);
		mocks.ensureSettingsActorCanAccessEmployeeTarget.mockReturnValue(Effect.void);

		return { update, employeeSet, employeeWhere, userSet, userWhere };
	}

	it("suspends an employee and disables all app access", async () => {
		const { update, employeeSet, userSet, userWhere } = setupLifecycleActionTest();

		await suspendEmployeeAction("employee-1");

		expect(mocks.requireOrgAdminEmployeeSettingsAccess).toHaveBeenCalled();
		expect(mocks.ensureSettingsActorCanAccessEmployeeTarget).toHaveBeenCalled();
		expect(employeeSet).toHaveBeenCalledWith({
			isActive: false,
			updatedAt: expect.anything(),
		});
		expect(userSet).toHaveBeenCalledWith({
			canUseWebapp: false,
			canUseDesktop: false,
			canUseMobile: false,
		});
		expect(update).toHaveBeenNthCalledWith(2, user);
		expect(userWhere).toHaveBeenCalledWith(eq(user.id, validUserId));
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledWith("org-1");
	});

	it("reactivates an employee and restores web app access", async () => {
		const { update, employeeSet, userSet, userWhere } = setupLifecycleActionTest();

		await reactivateEmployeeAction("employee-1");

		expect(mocks.requireOrgAdminEmployeeSettingsAccess).toHaveBeenCalled();
		expect(mocks.ensureSettingsActorCanAccessEmployeeTarget).toHaveBeenCalled();
		expect(employeeSet).toHaveBeenCalledWith({
			isActive: true,
			updatedAt: expect.anything(),
		});
		expect(userSet).toHaveBeenCalledWith({
			canUseWebapp: true,
		});
		expect(update).toHaveBeenNthCalledWith(2, user);
		expect(userWhere).toHaveBeenCalledWith(eq(user.id, validUserId));
		expect(mocks.revalidateEmployeesCache).toHaveBeenCalledWith("org-1");
	});
});
```

- [ ] **Step 2: Run the failing lifecycle tests**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts
```

Expected: FAIL because `suspendEmployeeAction` and `reactivateEmployeeAction` are not exported.

- [ ] **Step 3: Implement lifecycle actions in employee mutations**

In `employee-mutations.actions.ts`, add this helper near the top-level constants:

```ts
type EmployeeLifecycleState = "active" | "suspended";

function setEmployeeLifecycleAction(employeeId: string, state: EmployeeLifecycleState) {
	const isActive = state === "active";
	const actionName = isActive ? "reactivateEmployee" : "suspendEmployee";

	return runTracedEmployeeAction({
		name: actionName,
		attributes: {
			"employee.id": employeeId,
			"employee.lifecycleState": state,
		},
		logError: (error) => {
			logger.error({ error, employeeId, state }, `Failed to ${actionName}`);
		},
		execute: () =>
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const { dbService } = actor;

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can change employee lifecycle state",
						resource: "employee",
						action: isActive ? "reactivate" : "suspend",
					}),
				);

				const validatedEmployeeId = yield* _(validateInput(employeeIdSchema, employeeId));
				const targetEmployee = yield* _(getTargetEmployee(validatedEmployeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee",
						resource: "employee",
						action: isActive ? "reactivate" : "suspend",
					}),
				);

				yield* _(
					dbService.query(`${actionName}:employee`, async () => {
						await dbService.db
							.update(employee)
							.set({ isActive, updatedAt: currentTimestamp() })
							.where(
								and(
									eq(employee.id, validatedEmployeeId),
									eq(employee.organizationId, actor.organizationId),
								),
							);
					}),
				);

				const targetUser = yield* _(getTargetUser(targetEmployee.userId));
				const appAccessService = yield* _(AppAccessService);
				yield* _(
					appAccessService.updatePermissions({
						userId: targetEmployee.userId,
						permissions: isActive
							? { canUseWebapp: true }
							: { canUseWebapp: false, canUseDesktop: false, canUseMobile: false },
						changedBy: session.user.id,
						changedByEmail: session.user.email,
						organizationId: targetEmployee.organizationId,
						targetUserName: targetUser.name,
						targetUserEmail: targetUser.email,
					}),
				);

				revalidateEmployeesCache(targetEmployee.organizationId);
			}),
	});
}
```

Add exported actions below `updateEmployeeAction`:

```ts
export async function suspendEmployeeAction(employeeId: string): Promise<ServerActionResult<void>> {
	return setEmployeeLifecycleAction(employeeId, "suspended");
}

export async function reactivateEmployeeAction(employeeId: string): Promise<ServerActionResult<void>> {
	return setEmployeeLifecycleAction(employeeId, "active");
}
```

- [ ] **Step 4: Export lifecycle wrappers**

In `actions.ts`, add imports:

```ts
import {
	assignManagersAction,
	createEmployeeAction,
	reactivateEmployeeAction,
	requestEmployeeWorkBalanceRecalculationAction,
	suspendEmployeeAction,
	updateEmployeeAction,
	updateEmployeeInvitationDraftAction,
	updateOwnProfileAction,
} from "./employee-mutations.actions";
```

Add wrappers after `updateEmployee`:

```ts
export async function suspendEmployee(employeeId: string): Promise<ServerActionResult<void>> {
	return suspendEmployeeAction(employeeId);
}

export async function reactivateEmployee(employeeId: string): Promise<ServerActionResult<void>> {
	return reactivateEmployeeAction(employeeId);
}
```

- [ ] **Step 5: Run lifecycle tests again**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts
```

Expected: PASS.

## Task 2: Allow Calendar Access To Inactive Target Employees

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Test: `apps/webapp/src/app/api/calendar/events/route.test.ts`

- [ ] **Step 1: Write failing calendar authorization tests**

Add these tests after `returns the selected employee calendar timezone` in `route.test.ts`:

```ts
it("allows an authorized manager to view an inactive target employee calendar", async () => {
	mockState.getVerifiedOrgContext.mockResolvedValueOnce({
		isValid: true,
		user: { id: "manager-user", role: "user" },
		userId: "manager-user",
		organizationId: "org-1",
		employeeId: "manager-1",
		role: "manager",
	});
	mockState.findEmployee
		.mockResolvedValueOnce({
			id: "manager-1",
			organizationId: "org-1",
			isActive: true,
			role: "manager",
			teamId: null,
			userId: "manager-user",
		})
		.mockResolvedValueOnce({
			id: "employee-2",
			organizationId: "org-1",
			isActive: false,
			role: "employee",
			teamId: null,
			userId: "employee-user-2",
		});
	mockState.findManagerLinks.mockResolvedValueOnce([{ employeeId: "employee-2" }]);
	mockState.findUserSettings.mockResolvedValueOnce({ timezone: "Europe/Berlin" });

	const response = await GET(
		createRequest(
			"https://app.example.com/api/calendar/events?organizationId=org-1&employeeId=employee-2&year=2026&month=4&showTimeEntries=true",
		),
	);

	expect(response.status).toBe(200);
	expect(mockState.getTimeEntriesForMonth).toHaveBeenCalledWith(
		4,
		2026,
		{ organizationId: "org-1", employeeId: "employee-2" },
		"Europe/Berlin",
	);
});

it("rejects calendar requests from inactive viewers", async () => {
	mockState.findEmployee.mockResolvedValueOnce(null);

	const response = await GET(
		createRequest(
			"https://app.example.com/api/calendar/events?organizationId=org-1&year=2026&month=4&showTimeEntries=true",
		),
	);

	expect(response.status).toBe(403);
	expect(mockState.getTimeEntriesForMonth).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run failing calendar tests**

Run:

```bash
pnpm --filter @z8/webapp test src/app/api/calendar/events/route.test.ts
```

Expected: FAIL for the inactive target test because `resolveAuthorizedCalendarEmployeeId` still filters target employees by `eq(employee.isActive, true)`.

- [ ] **Step 3: Relax only target employee active filtering**

In `route.ts`, change the target employee lookup from:

```ts
const targetEmployee = await db.query.employee.findFirst({
	where: and(
		eq(employee.id, targetEmployeeId),
		eq(employee.organizationId, orgContext.organizationId),
		eq(employee.isActive, true),
	),
});
```

to:

```ts
const targetEmployee = await db.query.employee.findFirst({
	where: and(
		eq(employee.id, targetEmployeeId),
		eq(employee.organizationId, orgContext.organizationId),
	),
});
```

Do not change the earlier `currentEmployee` lookup. It must keep `eq(employee.isActive, true)` so inactive viewers are rejected.

- [ ] **Step 4: Run calendar tests again**

Run:

```bash
pnpm --filter @z8/webapp test src/app/api/calendar/events/route.test.ts
```

Expected: PASS.

## Task 3: Wire Lifecycle Mutations Into The Employee Detail Hook

**Files:**
- Modify: `apps/webapp/src/lib/query/use-employee.ts`

- [ ] **Step 1: Import lifecycle wrappers**

Update the settings employee action import in `use-employee.ts`:

```ts
import {
	type EmployeeDetailRecord,
	getEmployee,
	listEmployeesForSelect,
	reactivateEmployee,
	requestEmployeeWorkBalanceRecalculation,
	suspendEmployee,
	updateEmployee,
	updateEmployeeInvitationDraft,
} from "@/app/[locale]/(app)/settings/employees/actions";
```

- [ ] **Step 2: Add shared lifecycle cache invalidation**

Add this helper near `_invalidateEmploymentHistoryQueries`:

```ts
const invalidateEmployeeLifecycleQueries = () => {
	queryClient.invalidateQueries({
		queryKey: queryKeys.employees.detail(employeeId),
	});
	queryClient.invalidateQueries({
		queryKey: queryKeys.employees.all,
	});
	queryClient.invalidateQueries({
		queryKey: queryKeys.calendar.all,
	});
};
```

- [ ] **Step 3: Add suspend/reactivate mutations**

Add these mutations after `updateMutation`:

```ts
const suspendMutation = useMutation({
	mutationFn: async () => (isDraft ? draftActionResult : suspendEmployee(employeeId)),
	onSuccess: (result) => {
		if (result.success) {
			invalidateEmployeeLifecycleQueries();
		}
	},
});

const reactivateMutation = useMutation({
	mutationFn: async () => (isDraft ? draftActionResult : reactivateEmployee(employeeId)),
	onSuccess: (result) => {
		if (result.success) {
			invalidateEmployeeLifecycleQueries();
		}
	},
});
```

- [ ] **Step 4: Return lifecycle mutation APIs**

Add these fields to the returned object:

```ts
suspendEmployee: suspendMutation.mutateAsync,
isSuspendingEmployee: suspendMutation.isPending,
reactivateEmployee: reactivateMutation.mutateAsync,
isReactivatingEmployee: reactivateMutation.isPending,
```

- [ ] **Step 5: Run TypeScript-adjacent test target**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts src/app/api/calendar/events/route.test.ts
```

Expected: PASS. `apps/webapp/src/lib/query/keys.ts` defines `queryKeys.calendar.all`, so the lifecycle invalidation should use that exact key.

## Task 4: Add Employee Detail Lifecycle UI

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-lifecycle-card.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`

- [ ] **Step 1: Create the lifecycle card component**

Create `employee-lifecycle-card.tsx`:

```tsx
"use client";

import { IconLoader2, IconPlayerPlay, IconUserPause } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { defaultTranslate, type Translate } from "./employee-section-shared";

export function EmployeeLifecycleCard({
	employee,
	isPending,
	onSuspend,
	onReactivate,
	t = defaultTranslate,
}: {
	employee: EmployeeDetail;
	isPending: boolean;
	onSuspend: () => void;
	onReactivate: () => void;
	t?: Translate;
}) {
	if (employee.kind === "invitationDraft") return null;

	const isActive = employee.isActive;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.employees.lifecycle.title", "Employee access")}</CardTitle>
				<CardDescription>
					{isActive
						? t(
								"settings.employees.lifecycle.suspendDescription",
								"Suspend this employee when they leave the company. Their account access is disabled, but historical records stay available.",
							)
						: t(
								"settings.employees.lifecycle.reactivateDescription",
								"Reactivate this employee to restore their employee profile and web app access.",
							)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isActive ? (
					<Button type="button" variant="destructive" onClick={onSuspend} disabled={isPending}>
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconUserPause className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.employees.lifecycle.suspend", "Suspend employee")}
					</Button>
				) : (
					<Button type="button" onClick={onReactivate} disabled={isPending}>
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconPlayerPlay className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.employees.lifecycle.reactivate", "Reactivate employee")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 2: Wire hook values in the detail page**

In `employee-detail-page-client.tsx`, import the card:

```tsx
import { EmployeeLifecycleCard } from "./employee-lifecycle-card";
```

Add these destructured values from `useEmployee`:

```ts
suspendEmployee,
isSuspendingEmployee,
reactivateEmployee,
isReactivatingEmployee,
```

Add this derived value near the existing `canManage...` constants:

```ts
const canManageLifecycle = accessTier === "orgAdmin";
const isMutatingLifecycle = isSuspendingEmployee || isReactivatingEmployee;
```

- [ ] **Step 3: Add lifecycle action handlers**

Add these handlers near `handleWorkBalanceRecalculation`:

```ts
const handleSuspendEmployee = async () => {
	const result = await suspendEmployee().catch(() => null);

	if (result?.success) {
		toast.success(t("settings.employees.lifecycle.suspendSuccess", "Employee suspended"));
		void refetch();
		return;
	}

	toast.error(
		result?.error || t("settings.employees.lifecycle.suspendError", "Failed to suspend employee"),
	);
};

const handleReactivateEmployee = async () => {
	const result = await reactivateEmployee().catch(() => null);

	if (result?.success) {
		toast.success(t("settings.employees.lifecycle.reactivateSuccess", "Employee reactivated"));
		void refetch();
		return;
	}

	toast.error(
		result?.error ||
			t("settings.employees.lifecycle.reactivateError", "Failed to reactivate employee"),
	);
};
```

- [ ] **Step 4: Render the lifecycle card for org admins**

Add this block after the edit/overview grid and before manager assignment:

```tsx
{canShowRealEmployeeSections && canManageLifecycle && (
	<EmployeeLifecycleCard
		employee={employee}
		isPending={isMutatingLifecycle}
		onSuspend={handleSuspendEmployee}
		onReactivate={handleReactivateEmployee}
		t={t}
	/>
)}
```

- [ ] **Step 5: Run relevant tests**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts src/app/api/calendar/events/route.test.ts
```

Expected: PASS.

## Task 5: Full Verification

**Files:**
- Verify changed files only; no new source edits unless tests reveal a concrete failure.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts src/app/api/calendar/events/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader test suite if targeted tests pass**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff without reverting unrelated work**

Run:

```bash
git diff -- apps/webapp/src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/actions.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/employee-mutations.actions.test.ts apps/webapp/src/lib/query/use-employee.ts apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/employee-lifecycle-card.tsx apps/webapp/src/app/[locale]/\(app\)/settings/employees/[employeeId]/employee-detail-page-client.tsx apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts
```

Expected: Diff only contains the lifecycle actions, lifecycle UI, hook wiring, and calendar target authorization change.

## Self-Review Notes

- Spec coverage: lifecycle actions, app access updates, org-admin authorization, active viewer/inactive target calendar behavior, UI controls, cache invalidation, and tests are covered.
- Deferred-work marker scan: no `TBD`, `TODO`, vague implementation steps, or undefined follow-up tasks remain.
- Type consistency: action names are `suspendEmployeeAction`, `reactivateEmployeeAction`, client wrappers are `suspendEmployee`, `reactivateEmployee`, and hook return names are `suspendEmployee`, `reactivateEmployee`, `isSuspendingEmployee`, `isReactivatingEmployee`.

## Commit Policy

Do not commit unless the user explicitly requests a commit. If commit approval is given after verification, inspect `git status`, `git diff`, and `git log --oneline -10`, then commit only the files changed for this feature with a concise message such as `feat(settings): add employee suspension controls`.
