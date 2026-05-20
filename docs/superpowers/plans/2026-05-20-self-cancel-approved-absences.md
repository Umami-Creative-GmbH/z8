# Self-Cancel Approved Absences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow employees to cancel their own future approved absences and notify their manager when they do.

**Architecture:** Keep the existing absence cancellation mutation as the single server entrypoint. Add a small pure eligibility helper for date/status rules, extend the mutation to load organization timezone/category/manager recipients, and add a notification trigger for approved self-cancellations. Update the personal absence table to show the cancel action for pending or future approved absences only.

**Tech Stack:** Next.js server actions, Drizzle ORM, Luxon `DateTime`, Vitest, React Testing Library, existing Z8 notification service.

---

## File Structure

- Modify: `apps/webapp/src/lib/absences/permissions.ts`
  - Responsibility: absence cancellation authorization and pure self-cancel eligibility logic.
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
  - Responsibility: single cancellation mutation, canonical record cleanup, calendar deletion sync, approved cancellation manager notification orchestration.
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts`
  - Responsibility: server mutation tests for organization scoping, future-approved cancellation, started-approved rejection, and notification behavior.
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
  - Responsibility: add an in-app manager notification trigger for employee-cancelled approved absences.
- Modify: `apps/webapp/src/lib/notifications/triggers.test.ts`
  - Responsibility: verify manager cancellation notification payload and fire-and-forget failure behavior.
- Modify: `apps/webapp/src/components/absences/absence-entries-table.tsx`
  - Responsibility: client-side action visibility and copy for pending/future approved cancellation.
- Modify: `apps/webapp/src/components/absences/absence-entries-table.test.tsx`
  - Responsibility: UI action visibility tests.

## Task 1: Add Pure Cancellation Eligibility

**Files:**
- Modify: `apps/webapp/src/lib/absences/permissions.ts`

- [ ] **Step 1: Write the failing helper tests**

There is no existing `permissions.test.ts`. Create it.

Create: `apps/webapp/src/lib/absences/permissions.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { canSelfCancelAbsenceStatus } from "./permissions";

describe("canSelfCancelAbsenceStatus", () => {
	const today = "2026-05-20";

	it("allows pending absences regardless of start date", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "pending", startDate: "2026-05-19", today }),
		).toBe(true);
	});

	it("allows approved absences only before the start date", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-21", today }),
		).toBe(true);
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-20", today }),
		).toBe(false);
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-19", today }),
		).toBe(false);
	});

	it("rejects rejected absences", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "rejected", startDate: "2026-05-21", today }),
		).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/webapp vitest run src/lib/absences/permissions.test.ts`

Expected: FAIL with an export error for `canSelfCancelAbsenceStatus`.

- [ ] **Step 3: Add the pure helper**

Modify `apps/webapp/src/lib/absences/permissions.ts`. Add this type and function above `canCancelAbsence`:

```ts
type AbsenceApprovalStatus = "pending" | "approved" | "rejected";

export function canSelfCancelAbsenceStatus(input: {
	status: AbsenceApprovalStatus;
	startDate: string;
	today: string;
}): boolean {
	if (input.status === "pending") {
		return true;
	}

	if (input.status === "approved") {
		return input.startDate > input.today;
	}

	return false;
}
```

Then update the `canCancelAbsence` signature and implementation to accept date context without changing existing admin pending behavior:

```ts
export async function canCancelAbsence(
	employeeId: string,
	absenceOwnerId: string,
	absenceStatus: AbsenceApprovalStatus,
	context?: { startDate?: string; today?: string },
): Promise<boolean> {
	if (employeeId === absenceOwnerId) {
		return canSelfCancelAbsenceStatus({
			status: absenceStatus,
			startDate: context?.startDate ?? "",
			today: context?.today ?? "9999-12-31",
		});
	}

	if (absenceStatus !== "pending") {
		return false;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	return emp?.role === "admin";
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/absences/permissions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/absences/permissions.ts apps/webapp/src/lib/absences/permissions.test.ts
git commit -m "feat: add absence self-cancel eligibility"
```

## Task 2: Add Manager Notification Trigger

**Files:**
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.test.ts`

- [ ] **Step 1: Write the failing trigger tests**

Modify the import list in `apps/webapp/src/lib/notifications/triggers.test.ts` to include `onApprovedAbsenceCancelledByEmployee`:

```ts
import {
	onAbsenceRecordedByManager,
	onAbsenceRequestPendingApproval,
	onApprovedAbsenceCancelledByEmployee,
	onClockOutPendingApprovalToManager,
	onShiftSwapRequestedToManager,
	onTimeCorrectionPendingApproval,
	onTravelExpenseApproved,
	onTravelExpenseRejected,
} from "./triggers";
```

Add these tests after the manager-recorded absence tests:

```ts
	it("notifies a manager when an employee cancels an approved absence", async () => {
		await onApprovedAbsenceCancelledByEmployee({
			absenceId: "absence-1",
			managerUserId: "user-manager",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-21",
			endDate: "2026-05-22",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-manager",
			organizationId: "org-1",
			type: "absence_request_approved",
			title: "Approved absence cancelled",
			message: "Avery Employee cancelled approved Vacation for May 21 - May 22.",
			entityType: "absence_entry",
			entityId: "absence-1",
			actionUrl: "/team/absences",
			metadata: {
				approvedAbsenceCancelled: true,
				employeeName: "Avery Employee",
				startDate: "2026-05-21",
				endDate: "2026-05-22",
				absenceType: "Vacation",
			},
		});
	});

	it("swallows approved absence cancellation notification failures", async () => {
		createNotification.mockRejectedValueOnce(new Error("notification failed"));

		await expect(
			onApprovedAbsenceCancelledByEmployee({
				absenceId: "absence-1",
				managerUserId: "user-manager",
				employeeName: "Avery Employee",
				organizationId: "org-1",
				categoryName: "Vacation",
				startDate: "2026-05-21",
				endDate: "2026-05-22",
			}),
		).resolves.toBeUndefined();
	});
```

- [ ] **Step 2: Run trigger tests to verify failure**

Run: `pnpm --dir apps/webapp vitest run src/lib/notifications/triggers.test.ts`

Expected: FAIL because `onApprovedAbsenceCancelledByEmployee` is not exported.

- [ ] **Step 3: Implement the trigger**

Modify `apps/webapp/src/lib/notifications/triggers.ts`. Add this interface below `AbsenceRecordedByManagerParams`:

```ts
interface ApprovedAbsenceCancelledByEmployeeParams extends AbsenceRequestParams {
	managerUserId: string;
}
```

Add this exported function after `onAbsenceRecordedByManager`:

```ts
export async function onApprovedAbsenceCancelledByEmployee(
	params: ApprovedAbsenceCancelledByEmployeeParams,
): Promise<void> {
	try {
		await createNotification({
			userId: params.managerUserId,
			organizationId: params.organizationId,
			type: "absence_request_approved",
			title: "Approved absence cancelled",
			message: `${params.employeeName} cancelled approved ${params.categoryName} for ${formatDateStr(params.startDate)} - ${formatDateStr(params.endDate)}.`,
			entityType: "absence_entry",
			entityId: params.absenceId,
			actionUrl: "/team/absences",
			metadata: {
				approvedAbsenceCancelled: true,
				employeeName: params.employeeName,
				startDate: params.startDate,
				endDate: params.endDate,
				absenceType: params.categoryName,
			},
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger approved absence cancellation notification");
	}
}
```

- [ ] **Step 4: Run trigger tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/notifications/triggers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/notifications/triggers.ts apps/webapp/src/lib/notifications/triggers.test.ts
git commit -m "feat: notify managers of cancelled approved absences"
```

## Task 3: Extend Cancellation Mutation

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts`

- [ ] **Step 1: Expand the mutation test mocks**

Modify the `mockState` in `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts` to include these mocks:

```ts
const mockState = vi.hoisted(() => ({
	findAbsence: vi.fn(),
	findOrganization: vi.fn(),
	findManagers: vi.fn(),
	dbDelete: vi.fn(),
	canCancelAbsence: vi.fn(),
	addCalendarSyncJob: vi.fn(),
	removeCanonicalAbsenceRecord: vi.fn(),
	getCurrentEmployee: vi.fn(),
	onApprovedAbsenceCancelledByEmployee: vi.fn(),
}));
```

Update the `vi.mock("@/db"...)` block to expose organization and employeeManagers queries:

```ts
vi.mock("@/db", () => ({
	db: {
		query: {
			absenceEntry: {
				findFirst: mockState.findAbsence,
			},
			organization: {
				findFirst: mockState.findOrganization,
			},
			employeeManagers: {
				findMany: mockState.findManagers,
			},
		},
		delete: mockState.dbDelete,
	},
}));
```

Add this notification mock below the current queue mock:

```ts
vi.mock("@/lib/notifications/triggers", () => ({
	onApprovedAbsenceCancelledByEmployee: mockState.onApprovedAbsenceCancelledByEmployee,
}));
```

In `beforeEach`, add default mock behavior:

```ts
mockState.findOrganization.mockResolvedValue({ timezone: "Europe/Berlin" });
mockState.findManagers.mockResolvedValue([]);
mockState.canCancelAbsence.mockResolvedValue(true);
mockState.removeCanonicalAbsenceRecord.mockResolvedValue(undefined);
mockState.dbDelete.mockReturnValue({
	where: vi.fn().mockResolvedValue(undefined),
});
```

- [ ] **Step 2: Write failing mutation tests**

Add these tests after the existing cross-organization test:

```ts
	it("passes organization-local today and start date into cancellation permission", async () => {
		vi.setSystemTime(new Date("2026-05-20T10:00:00.000Z"));
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "approved",
			startDate: "2026-05-21",
			endDate: "2026-05-22",
			canonicalRecordId: "record-1",
			category: { name: "Vacation" },
			employee: { user: { name: "Avery Employee" } },
		});

		const result = await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({ success: true });
		expect(mockState.canCancelAbsence).toHaveBeenCalledWith("emp-1", "emp-1", "approved", {
			startDate: "2026-05-21",
			today: "2026-05-20",
		});
	});

	it("rejects approved absences that have already started", async () => {
		vi.setSystemTime(new Date("2026-05-20T10:00:00.000Z"));
		mockState.canCancelAbsence.mockResolvedValue(false);
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "approved",
			startDate: "2026-05-20",
			endDate: "2026-05-22",
			canonicalRecordId: "record-1",
			category: { name: "Vacation" },
			employee: { user: { name: "Avery Employee" } },
		});

		const result = await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(result).toEqual({
			success: false,
			error: "Approved absences can only be cancelled before they start",
		});
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
		expect(mockState.dbDelete).not.toHaveBeenCalled();
	});

	it("notifies managers after an approved self-cancellation succeeds", async () => {
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "approved",
			startDate: "2026-05-21",
			endDate: "2026-05-22",
			canonicalRecordId: "record-1",
			category: { name: "Vacation" },
			employee: { user: { name: "Avery Employee" } },
		});
		mockState.findManagers.mockResolvedValue([
			{ manager: { userId: "user-manager-1" } },
			{ manager: { userId: "user-manager-2" } },
		]);

		await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(mockState.onApprovedAbsenceCancelledByEmployee).toHaveBeenCalledTimes(2);
		expect(mockState.onApprovedAbsenceCancelledByEmployee).toHaveBeenCalledWith({
			absenceId: "absence-1",
			managerUserId: "user-manager-1",
			employeeName: "Avery Employee",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-21",
			endDate: "2026-05-22",
		});
	});

	it("does not notify managers for pending cancellation", async () => {
		mockState.findAbsence.mockResolvedValue({
			id: "absence-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			status: "pending",
			startDate: "2026-05-21",
			endDate: "2026-05-22",
			canonicalRecordId: "record-1",
			category: { name: "Vacation" },
			employee: { user: { name: "Avery Employee" } },
		});

		await mutations.cancelAbsenceRequestForEmployee("absence-1", {
			id: "emp-1",
			organizationId: "org-1",
		});

		expect(mockState.onApprovedAbsenceCancelledByEmployee).not.toHaveBeenCalled();
	});
```

Because these tests use fake time, add `vi.useRealTimers()` to `beforeEach` before default mocks:

```ts
vi.useRealTimers();
```

- [ ] **Step 3: Run mutation tests to verify failure**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/absences/mutations.test.ts'`

Expected: FAIL because the mutation does not request organization timezone, category/user relations, or manager notifications.

- [ ] **Step 4: Implement mutation changes**

Modify imports in `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`:

```ts
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, approvalRequest, employeeManagers } from "@/db/schema";
import { canCancelAbsence } from "@/lib/absences/permissions";
import { onApprovedAbsenceCancelledByEmployee } from "@/lib/notifications/triggers";
import { addCalendarSyncJob } from "@/lib/queue";
import { removeCanonicalAbsenceRecord } from "./actions.canonical";
import { getCurrentEmployee } from "./current-employee";
```

Update the absence query in `cancelAbsenceRequestForEmployee`:

```ts
	const absence = await db.query.absenceEntry.findFirst({
		where: eq(absenceEntry.id, absenceId),
		with: {
			category: true,
			employee: {
				with: { user: true },
			},
		},
	});
```

Add timezone lookup and permission context before calling `canCancelAbsence`:

```ts
	const organization = await db.query.organization.findFirst({
		where: (organization, { eq }) => eq(organization.id, currentEmployee.organizationId),
		columns: { timezone: true },
	});
	const today = DateTime.now()
		.setZone(organization?.timezone || "UTC")
		.toISODate();

	const canCancel = await canCancelAbsence(currentEmployee.id, absence.employeeId, absence.status, {
		startDate: absence.startDate,
		today: today ?? DateTime.now().toUTC().toISODate() ?? "9999-12-31",
	});
```

Replace the permission failure return block with this status-aware error:

```ts
	if (!canCancel) {
		return {
			success: false,
			error:
				absence.employeeId === currentEmployee.id && absence.status === "approved"
					? "Approved absences can only be cancelled before they start"
					: "You do not have permission to cancel this absence",
		};
	}
```

After the approval request deletion and before `return { success: true };`, add:

```ts
	if (absence.status === "approved" && absence.employeeId === currentEmployee.id) {
		void notifyManagersOfApprovedAbsenceCancellation({
			absenceId: absence.id,
			employeeId: absence.employeeId,
			employeeName: absence.employee.user.name,
			organizationId: currentEmployee.organizationId,
			categoryName: absence.category.name,
			startDate: absence.startDate,
			endDate: absence.endDate,
		});
	}
```

Add this helper at the bottom of the file:

```ts
async function notifyManagersOfApprovedAbsenceCancellation(params: {
	absenceId: string;
	employeeId: string;
	employeeName: string;
	organizationId: string;
	categoryName: string;
	startDate: string;
	endDate: string;
}) {
	const managerRows = await db.query.employeeManagers.findMany({
		where: eq(employeeManagers.employeeId, params.employeeId),
		with: {
			manager: true,
		},
	});

	await Promise.all(
		managerRows.map((row) =>
			onApprovedAbsenceCancelledByEmployee({
				absenceId: params.absenceId,
				managerUserId: row.manager.userId,
				employeeName: params.employeeName,
				organizationId: params.organizationId,
				categoryName: params.categoryName,
				startDate: params.startDate,
				endDate: params.endDate,
			}),
		),
	);
}
```

- [ ] **Step 5: Run mutation tests**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/absences/mutations.test.ts'`

Expected: PASS.

- [ ] **Step 6: Run permissions tests with mutation tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/absences/permissions.test.ts 'src/app/[locale]/(app)/absences/mutations.test.ts'`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/absences/mutations.ts apps/webapp/src/app/[locale]/\(app\)/absences/mutations.test.ts
git commit -m "feat: allow future approved absence cancellation"
```

## Task 4: Update Personal Absence Table Actions

**Files:**
- Modify: `apps/webapp/src/components/absences/absence-entries-table.tsx`
- Modify: `apps/webapp/src/components/absences/absence-entries-table.test.tsx`

- [ ] **Step 1: Write UI action visibility tests**

Modify imports in `apps/webapp/src/components/absences/absence-entries-table.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { AbsenceEntriesTable } from "./absence-entries-table";
```

Add this helper above `describe`:

```ts
function buildAbsence(overrides: Partial<AbsenceWithCategory>): AbsenceWithCategory {
	return {
		id: overrides.id ?? "absence-1",
		employeeId: "employee-1",
		startDate: overrides.startDate ?? "2026-05-21",
		startPeriod: "full_day",
		endDate: overrides.endDate ?? overrides.startDate ?? "2026-05-21",
		endPeriod: "full_day",
		status: overrides.status ?? "approved",
		notes: null,
		sickDetail: null,
		category: {
			id: "category-vacation",
			name: "Vacation",
			type: "vacation",
			color: null,
			countsAgainstVacation: true,
		},
		approvedBy: null,
		approvedAt: null,
		rejectionReason: null,
		createdAt: new Date("2026-05-01T00:00:00Z"),
		...overrides,
	};
}
```

Add fake timer setup inside `describe("AbsenceEntriesTable", () => {`:

```ts
	beforeEach(() => {
		vi.setSystemTime(new Date("2026-05-20T10:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});
```

Add these tests after the sick detail test:

```ts
	it("shows cancel actions for pending and future approved absences", () => {
		render(
			<AbsenceEntriesTable
				absences={[
					buildAbsence({ id: "pending", status: "pending", startDate: "2026-05-20" }),
					buildAbsence({ id: "approved-future", status: "approved", startDate: "2026-05-21" }),
				]}
			/>,
		);

		expect(screen.getAllByLabelText("Cancel absence")).toHaveLength(2);
	});

	it("hides cancel actions for approved absences starting today or earlier", () => {
		render(
			<AbsenceEntriesTable
				absences={[
					buildAbsence({ id: "approved-today", status: "approved", startDate: "2026-05-20" }),
					buildAbsence({ id: "approved-past", status: "approved", startDate: "2026-05-19" }),
					buildAbsence({ id: "rejected", status: "rejected", startDate: "2026-05-21" }),
				]}
			/>,
		);

		expect(screen.queryByLabelText("Cancel absence")).toBeNull();
	});
```

- [ ] **Step 2: Run UI tests to verify failure**

Run: `pnpm --dir apps/webapp vitest run src/components/absences/absence-entries-table.test.tsx`

Expected: FAIL because approved future absences do not show a cancel action and the aria label is still `Cancel request`.

- [ ] **Step 3: Implement UI eligibility helper and copy**

Modify imports in `apps/webapp/src/components/absences/absence-entries-table.tsx`:

```ts
import { DateTime } from "luxon";
```

Add this helper above `export function AbsenceEntriesTable`:

```ts
function canShowCancelAction(absence: AbsenceWithCategory, today: string): boolean {
	if (absence.status === "pending") {
		return true;
	}

	if (absence.status === "approved") {
		return absence.startDate > today;
	}

	return false;
}
```

Inside the component, add this near state declarations:

```ts
	const today = DateTime.now().toISODate() ?? "9999-12-31";
```

Replace the action visibility guard:

```ts
					if (!canShowCancelAction(absence, today)) return null;
```

Replace action labels/copy in the action cell:

```tsx
										aria-label={t("absences.table.cancelAbsence", "Cancel absence")}
```

```tsx
											{t("absences.dialog.cancelTitle", "Cancel Absence")}
```

```tsx
												"Are you sure you want to cancel this absence? This action cannot be undone.",
```

```tsx
											{t("absences.dialog.confirmCancel", "Yes, cancel absence")}
```

Update the toast success fallback:

```ts
			toast.success(t("absences.toast.requestCancelled", "Absence cancelled"));
```

Update the `useMemo` dependency list for columns:

```ts
		[t, cancelingId, today],
```

- [ ] **Step 4: Run UI tests**

Run: `pnpm --dir apps/webapp vitest run src/components/absences/absence-entries-table.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/absences/absence-entries-table.tsx apps/webapp/src/components/absences/absence-entries-table.test.tsx
git commit -m "feat: show approved absence cancel actions"
```

## Task 5: Final Verification

**Files:**
- Verify only; no required code changes.

- [ ] **Step 1: Run targeted test suite**

Run: `pnpm --dir apps/webapp vitest run src/lib/absences/permissions.test.ts 'src/app/[locale]/(app)/absences/mutations.test.ts' src/lib/notifications/triggers.test.ts src/components/absences/absence-entries-table.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run broader absence-related tests**

Run: `pnpm --dir apps/webapp vitest run 'src/app/[locale]/(app)/absences/actions.test.ts' 'src/app/[locale]/(app)/absences/actions.exports.test.ts' 'src/app/api/mobile/absences/[absenceId]/cancel/route.test.ts' src/components/absences/absence-entries-table.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run lint/type/build check if local environment permits**

Run: `CI=true pnpm build`

Expected: PASS. If this fails because required Phase CLI secrets or external services are unavailable, record the exact failure and do not claim a passing build.

- [ ] **Step 4: Inspect final diff**

Run: `git diff --stat HEAD~4..HEAD`

Expected: shows changes only in the planned absence, notification, and test files.

- [ ] **Step 5: Commit verification fixes if any**

If verification required a fix, commit it:

```bash
git add <fixed-files>
git commit -m "fix: stabilize approved absence cancellation"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers pending self-cancellation, future approved self-cancellation, blocking started/past approved absences, organization-scoped server validation, canonical cleanup reuse, calendar deletion sync reuse, manager notification, and UI action visibility.
- Red-flag scan: No incomplete requirement markers or unspecified implementation steps remain.
- Type consistency: The same `canSelfCancelAbsenceStatus`, `onApprovedAbsenceCancelledByEmployee`, and `notifyManagersOfApprovedAbsenceCancellation` names are used consistently across tests and implementation steps.
