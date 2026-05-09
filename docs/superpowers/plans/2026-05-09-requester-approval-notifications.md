# Requester Approval Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify requesters after successful final approval decisions and make `/approvals/inbox` the promoted manager approval surface.

**Architecture:** Keep final-decision notification creation in source-domain approval handlers. Absence and time correction approval handlers already call requester notification triggers; this plan adds coverage tests for those paths, adds travel-expense requester notifications through the existing notification service, and updates manager-facing approval links to the unified inbox. Notification delivery remains non-blocking and organization-scoped.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, Effect, Vitest, existing Z8 notification service.

---

## File Structure

- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
  - Responsibility: source-specific notification trigger helpers and manager pending-approval action URLs.
- Create: `apps/webapp/src/lib/notifications/triggers.test.ts`
  - Responsibility: unit coverage for notification trigger payloads, especially unified inbox manager URLs and travel-expense requester notifications.
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`
  - Responsibility: load requester context and create travel-expense final-decision notifications after successful claim decisions.
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`
  - Responsibility: prove travel-expense notifications are created only after successful decisions and not after stale writes.
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
  - Responsibility: prove absence approve and reject handlers call requester notification triggers after successful mutations.
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
  - Responsibility: prove time-correction approve and reject handlers call requester notification triggers after successful mutations.
- Modify: `apps/webapp/src/components/dashboard/pending-approvals-widget.tsx`
  - Responsibility: route manager triage CTA to `/approvals/inbox`.
- Modify: `apps/webapp/src/components/dashboard/recently-approved-widget.tsx`
  - Responsibility: route manager approval history CTA to `/approvals/inbox`.
- Modify: dashboard widget tests if existing assertions target `/approvals`.
  - Candidate paths: `apps/webapp/src/components/dashboard/pending-approvals-widget.test.tsx`, `apps/webapp/src/components/dashboard/recently-approved-widget.test.tsx` if present.

## Task 1: Cover Notification Trigger URLs And Travel-Expense Trigger Payloads

**Files:**
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
- Create: `apps/webapp/src/lib/notifications/triggers.test.ts`

- [ ] **Step 1: Write failing tests for manager approval URLs and travel-expense requester payloads**

Create `apps/webapp/src/lib/notifications/triggers.test.ts` with this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const createNotification = vi.fn();

vi.mock("./notification-service", () => ({
	createNotification,
}));

import {
	onAbsenceRequestPendingApproval,
	onClockOutPendingApprovalToManager,
	onShiftSwapRequestedToManager,
	onTimeCorrectionPendingApproval,
	onTravelExpenseApproved,
	onTravelExpenseRejected,
} from "./triggers";

describe("approval notification triggers", () => {
	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification-1" });
	});

	it("links manager absence approval notifications to the unified inbox", async () => {
		await onAbsenceRequestPendingApproval({
			absenceId: "absence-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			categoryName: "Vacation",
			startDate: "2026-05-11",
			endDate: "2026-05-12",
			managerUserId: "user-manager",
			managerName: "Morgan Manager",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "absence_entry",
				entityId: "absence-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("links manager time-correction approval notifications to the unified inbox", async () => {
		await onTimeCorrectionPendingApproval({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			originalTime: new Date("2026-05-11T08:00:00.000Z"),
			correctedTime: new Date("2026-05-11T08:15:00.000Z"),
			managerUserId: "user-manager",
			reason: "Forgot to clock in",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "work_period",
				entityId: "period-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("links manager clock-out approval notifications to the unified inbox", async () => {
		await onClockOutPendingApprovalToManager({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
			durationMinutes: 480,
			managerUserId: "user-manager",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "approval_request_submitted",
				entityType: "work_period",
				entityId: "period-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("links manager shift-swap approval notifications to the unified inbox", async () => {
		await onShiftSwapRequestedToManager({
			requestId: "shift-request-1",
			organizationId: "org-1",
			managerUserId: "user-manager",
			requesterName: "Avery Requester",
			shiftDate: new Date("2026-05-11T00:00:00.000Z"),
			startTime: "08:00",
			endTime: "16:00",
			targetEmployeeName: "Taylor Target",
		});

		expect(createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-manager",
				organizationId: "org-1",
				type: "shift_swap_requested",
				entityType: "shift_request",
				entityId: "shift-request-1",
				actionUrl: "/approvals/inbox",
			}),
		);
	});

	it("creates a requester notification for approved travel expenses", async () => {
		await onTravelExpenseApproved({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			destinationCity: "Berlin",
			amount: "120.50",
			currency: "EUR",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-requester",
			organizationId: "org-1",
			type: "approval_request_approved",
			title: "Travel expense approved",
			message: "Your travel expense claim for Berlin (EUR 120.50) was approved by Morgan Manager.",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses",
		});
	});

	it("creates a requester notification for rejected travel expenses", async () => {
		await onTravelExpenseRejected({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Manager",
			destinationCity: null,
			amount: "120.50",
			currency: "EUR",
			rejectionReason: "Missing receipt",
		});

		expect(createNotification).toHaveBeenCalledWith({
			userId: "user-requester",
			organizationId: "org-1",
			type: "approval_request_rejected",
			title: "Travel expense rejected",
			message:
				"Your travel expense claim for EUR 120.50 was rejected by Morgan Manager. Reason: Missing receipt",
			entityType: "travel_expense_claim",
			entityId: "claim-1",
			actionUrl: "/travel-expenses",
		});
	});
});
```

- [ ] **Step 2: Run the notification trigger tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/lib/notifications/triggers.test.ts`

Expected: FAIL. Existing manager URL tests should receive `/approvals`, and the travel-expense trigger imports should fail until the new functions are exported.

- [ ] **Step 3: Implement the trigger URL updates and travel-expense trigger helpers**

In `apps/webapp/src/lib/notifications/triggers.ts`, replace these four manager approval action URLs:

```ts
actionUrl: "/approvals",
```

with:

```ts
actionUrl: "/approvals/inbox",
```

The four affected trigger functions are:

- `onAbsenceRequestPendingApproval`
- `onTimeCorrectionPendingApproval`
- `onClockOutPendingApprovalToManager`
- `onShiftSwapRequestedToManager`

Add these interfaces near the other notification parameter interfaces in `apps/webapp/src/lib/notifications/triggers.ts`:

```ts
interface TravelExpenseDecisionParams {
	claimId: string;
	requesterUserId: string;
	organizationId: string;
	approverName: string;
	destinationCity: string | null;
	amount: string;
	currency: string;
}

interface TravelExpenseRejectionParams extends TravelExpenseDecisionParams {
	rejectionReason?: string;
}
```

Add these helper functions before the Team Notifications section:

```ts
function formatTravelExpenseSummary(params: TravelExpenseDecisionParams): string {
	const amount = `${params.currency} ${params.amount}`;
	return params.destinationCity ? `${params.destinationCity} (${amount})` : amount;
}

/**
 * Notify requester that their travel expense claim was approved.
 */
export async function onTravelExpenseApproved(
	params: TravelExpenseDecisionParams,
): Promise<void> {
	try {
		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "approval_request_approved",
			title: "Travel expense approved",
			message: `Your travel expense claim for ${formatTravelExpenseSummary(params)} was approved by ${params.approverName}.`,
			entityType: "travel_expense_claim",
			entityId: params.claimId,
			actionUrl: "/travel-expenses",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger travel expense approved notification");
	}
}

/**
 * Notify requester that their travel expense claim was rejected.
 */
export async function onTravelExpenseRejected(
	params: TravelExpenseRejectionParams,
): Promise<void> {
	try {
		const reasonText = params.rejectionReason ? ` Reason: ${params.rejectionReason}` : "";

		await createNotification({
			userId: params.requesterUserId,
			organizationId: params.organizationId,
			type: "approval_request_rejected",
			title: "Travel expense rejected",
			message: `Your travel expense claim for ${formatTravelExpenseSummary(params)} was rejected by ${params.approverName}.${reasonText}`,
			entityType: "travel_expense_claim",
			entityId: params.claimId,
			actionUrl: "/travel-expenses",
		});
	} catch (error) {
		logger.error({ error, params }, "Failed to trigger travel expense rejected notification");
	}
}
```

- [ ] **Step 4: Run the notification trigger tests to verify they pass**

Run: `pnpm vitest run apps/webapp/src/lib/notifications/triggers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/webapp/src/lib/notifications/triggers.ts apps/webapp/src/lib/notifications/triggers.test.ts
git commit -m "test: cover approval notification triggers"
```

Expected: commit succeeds.

## Task 2: Add Travel-Expense Requester Notifications After Successful Decisions

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`

- [ ] **Step 1: Write failing tests for travel-expense final-decision notifications**

In `apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`, add this mock near the existing `vi.mock` calls:

```ts
const onTravelExpenseApproved = vi.fn();
const onTravelExpenseRejected = vi.fn();

vi.mock("@/lib/notifications/triggers", () => ({
	onTravelExpenseApproved,
	onTravelExpenseRejected,
}));
```

Update the `@/db/schema` mock so `travelExpenseClaim` exposes these fields:

```ts
travelExpenseClaim: {
	id: "id",
	organizationId: "organizationId",
	approverId: "approverId",
	status: "status",
	employeeId: "employeeId",
	destinationCity: "destinationCity",
	calculatedAmount: "calculatedAmount",
	calculatedCurrency: "calculatedCurrency",
},
```

Add these tests inside `describe("persistTravelExpenseDecision", () => { ... })`:

```ts
	it("notifies the requester after an approved travel expense decision succeeds", async () => {
		onTravelExpenseApproved.mockClear();
		onTravelExpenseRejected.mockClear();
		const returning = vi.fn().mockResolvedValue([{ id: "claim-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);
		const findFirst = vi.fn().mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			employeeId: "emp-requester",
			destinationCity: "Berlin",
			calculatedAmount: "120.50",
			calculatedCurrency: "EUR",
			employee: {
				userId: "user-requester",
			},
		});

		const dbService = {
			db: {
				query: {
					travelExpenseClaim: { findFirst },
				},
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		await Effect.runPromise(
			persistTravelExpenseDecision(dbService, "claim-1", currentEmployee, "approve", "looks good"),
		);

		expect(onTravelExpenseApproved).toHaveBeenCalledWith({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Reviewer",
			destinationCity: "Berlin",
			amount: "120.50",
			currency: "EUR",
		});
		expect(onTravelExpenseRejected).not.toHaveBeenCalled();
	});

	it("notifies the requester after a rejected travel expense decision succeeds", async () => {
		onTravelExpenseApproved.mockClear();
		onTravelExpenseRejected.mockClear();
		const returning = vi.fn().mockResolvedValue([{ id: "claim-1" }]);
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);
		const findFirst = vi.fn().mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			employeeId: "emp-requester",
			destinationCity: null,
			calculatedAmount: "120.50",
			calculatedCurrency: "EUR",
			employee: {
				userId: "user-requester",
			},
		});

		const dbService = {
			db: {
				query: {
					travelExpenseClaim: { findFirst },
				},
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		await Effect.runPromise(
			persistTravelExpenseDecision(dbService, "claim-1", currentEmployee, "reject", "Missing receipt"),
		);

		expect(onTravelExpenseRejected).toHaveBeenCalledWith({
			claimId: "claim-1",
			requesterUserId: "user-requester",
			organizationId: "org-1",
			approverName: "Morgan Reviewer",
			destinationCity: null,
			amount: "120.50",
			currency: "EUR",
			rejectionReason: "Missing receipt",
		});
		expect(onTravelExpenseApproved).not.toHaveBeenCalled();
	});

	it("does not notify the requester when a travel expense write is stale", async () => {
		onTravelExpenseApproved.mockClear();
		onTravelExpenseRejected.mockClear();
		const where = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([]),
		});
		const set = vi.fn().mockReturnValue({ where });
		const values = vi.fn().mockResolvedValue(undefined);
		const findFirst = vi.fn().mockResolvedValue({
			id: "claim-1",
			organizationId: "org-1",
			employee: { userId: "user-requester" },
		});

		const dbService = {
			db: {
				query: {
					travelExpenseClaim: { findFirst },
				},
				update: vi.fn().mockReturnValue({ set }),
				insert: vi.fn().mockReturnValue({ values }),
			},
			query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		} as unknown as ApprovalDbService;

		const currentEmployee: CurrentApprover = {
			id: "employee-1",
			userId: "user-1",
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Morgan Reviewer",
				email: "morgan@example.com",
				image: null,
			},
		};

		await Effect.runPromiseExit(
			persistTravelExpenseDecision(dbService, "claim-1", currentEmployee, "approve", "looks good"),
		);

		expect(onTravelExpenseApproved).not.toHaveBeenCalled();
		expect(onTravelExpenseRejected).not.toHaveBeenCalled();
	});
```

- [ ] **Step 2: Run the travel-expense tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`

Expected: FAIL because `persistTravelExpenseDecision` does not load requester notification context or call the new trigger helpers.

- [ ] **Step 3: Implement travel-expense notification context and trigger calls**

In `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`, add this import:

```ts
import { onTravelExpenseApproved, onTravelExpenseRejected } from "@/lib/notifications/triggers";
```

Add this interface after `buildTravelExpenseApprovalPolicyContext`:

```ts
interface TravelExpenseNotificationContext {
	id: string;
	organizationId: string;
	destinationCity: string | null;
	calculatedAmount: string;
	calculatedCurrency: string;
	employee: {
		userId: string;
	};
}
```

Add this helper before `persistTravelExpenseDecision`:

```ts
function loadTravelExpenseNotificationContext(
	dbService: ApprovalDbService,
	claimId: string,
	organizationId: string,
) {
	return dbService
		.query("getTravelExpenseNotificationContext", async () => {
			return await dbService.db.query.travelExpenseClaim.findFirst({
				where: and(
					eq(travelExpenseClaim.id, claimId),
					eq(travelExpenseClaim.organizationId, organizationId),
				),
				with: {
					employee: true,
				},
			});
		})
		.pipe(
			Effect.flatMap((claim) =>
				claim
					? Effect.succeed(claim as unknown as TravelExpenseNotificationContext)
					: Effect.fail(
							new NotFoundError({
								message: "Travel expense claim not found",
								entityType: "travel_expense_claim",
								entityId: claimId,
							}),
						),
			),
		);
}

function notifyTravelExpenseRequester(
	claim: TravelExpenseNotificationContext,
	currentEmployee: CurrentApprover,
	action: "approve" | "reject",
	reason?: string,
) {
	const payload = {
		claimId: claim.id,
		requesterUserId: claim.employee.userId,
		organizationId: claim.organizationId,
		approverName: currentEmployee.user.name,
		destinationCity: claim.destinationCity,
		amount: claim.calculatedAmount,
		currency: claim.calculatedCurrency,
	};

	if (action === "approve") {
		void onTravelExpenseApproved(payload);
		return;
	}

	void onTravelExpenseRejected({
		...payload,
		rejectionReason: reason,
	});
}
```

In `persistTravelExpenseDecision`, after the decision log insert succeeds and before the function returns, add:

```ts
		const claim = yield* _(
			loadTravelExpenseNotificationContext(dbService, claimId, currentEmployee.organizationId),
		);
		notifyTravelExpenseRequester(claim, currentEmployee, action, commentOrReason);
```

- [ ] **Step 4: Run the travel-expense tests to verify they pass**

Run: `pnpm vitest run apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts
git commit -m "feat: notify travel expense requesters after decisions"
```

Expected: commit succeeds.

## Task 3: Add Regression Coverage For Existing Absence And Time-Correction Requester Notifications

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

- [ ] **Step 1: Add absence requester notification tests**

In `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`, add notification trigger mocks near existing mocks:

```ts
const onAbsenceRequestApproved = vi.fn();
const onAbsenceRequestRejected = vi.fn();

vi.mock("@/lib/notifications/triggers", () => ({
	onAbsenceRequestApproved,
	onAbsenceRequestRejected,
}));
```

Add two tests that dynamically import `approveAbsenceWithCurrentApproverEffect` and `rejectAbsenceWithCurrentApproverEffect`, run them with a mocked `ApprovalDbService`, and assert the triggers receive requester payloads. Use this work-period-shaped service pattern adapted to absence fields:

```ts
const dbService = {
	db: {
		query: {
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue({
					id: "approval-1",
					organizationId: "org-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					requestedBy: "emp-requester",
					approverId: "emp-manager",
					status: "pending",
				}),
			},
			absenceEntry: {
				findFirst: vi.fn().mockResolvedValue({
					id: "absence-1",
					employeeId: "emp-requester",
					organizationId: "org-1",
					canonicalRecordId: null,
					startDate: "2026-05-11",
					endDate: "2026-05-12",
					status: "approved",
					rejectionReason: null,
					category: { name: "Vacation", type: "vacation", color: null },
					employee: {
						userId: "user-requester",
						organizationId: "org-1",
						user: {
							name: "Avery Requester",
							email: "avery@example.com",
							image: null,
						},
					},
				}),
			},
			holiday: { findMany: vi.fn().mockResolvedValue([]) },
		},
		update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
	},
	query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
} as unknown as ApprovalDbService;
```

Expected approval assertion:

```ts
expect(onAbsenceRequestApproved).toHaveBeenCalledWith(
	expect.objectContaining({
		absenceId: "absence-1",
		employeeUserId: "user-requester",
		organizationId: "org-1",
		categoryName: "Vacation",
		approverName: "Morgan Manager",
	}),
);
```

Expected rejection assertion:

```ts
expect(onAbsenceRequestRejected).toHaveBeenCalledWith(
	expect.objectContaining({
		absenceId: "absence-1",
		employeeUserId: "user-requester",
		organizationId: "org-1",
		categoryName: "Vacation",
		approverName: "Morgan Manager",
		rejectionReason: "Insufficient balance",
	}),
);
```

- [ ] **Step 2: Add time-correction requester notification tests**

In `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`, add notification trigger mocks near existing mocks:

```ts
const onTimeCorrectionApproved = vi.fn();
const onTimeCorrectionRejected = vi.fn();

vi.mock("@/lib/notifications/triggers", () => ({
	onTimeCorrectionApproved,
	onTimeCorrectionRejected,
}));
```

Add tests that run `approveTimeCorrectionWithCurrentApproverEffect` and `rejectTimeCorrectionWithCurrentApproverEffect` with a mocked `ApprovalDbService`. The approval test service should return one correction entry for the clock-in replacement and no clock-out correction:

```ts
const period = {
	id: "period-1",
	employeeId: "emp-requester",
	clockInId: "entry-original",
	clockOutId: null,
	organizationId: "org-1",
	canonicalRecordId: null,
	startTime: new Date("2026-05-11T08:00:00.000Z"),
	endTime: new Date("2026-05-11T16:00:00.000Z"),
	durationMinutes: 480,
	employee: {
		userId: "user-requester",
		organizationId: "org-1",
		user: { name: "Avery Requester", email: "avery@example.com", image: null },
	},
};
const correction = {
	id: "entry-correction",
	timestamp: new Date("2026-05-11T08:15:00.000Z"),
	replacesEntryId: "entry-original",
};
```

Expected approval assertion:

```ts
expect(onTimeCorrectionApproved).toHaveBeenCalledWith({
	workPeriodId: "period-1",
	employeeUserId: "user-requester",
	employeeName: "Avery Requester",
	organizationId: "org-1",
	originalTime: period.startTime,
	correctedTime: correction.timestamp,
	approverName: "Morgan Manager",
});
```

Expected rejection assertion:

```ts
expect(onTimeCorrectionRejected).toHaveBeenCalledWith(
	expect.objectContaining({
		workPeriodId: "period-1",
		employeeUserId: "user-requester",
		organizationId: "org-1",
		approverName: "Morgan Manager",
		rejectionReason: "Incorrect correction",
	}),
);
```

- [ ] **Step 3: Run the targeted approval tests**

Run:

```bash
pnpm vitest run apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: PASS. If a mock is missing a table field used by `processApprovalWithCurrentEmployee`, add that exact field to the mock and rerun.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts
git commit -m "test: cover requester approval decision notifications"
```

Expected: commit succeeds.

## Task 4: Promote Unified Approval Inbox In Manager CTAs

**Files:**
- Modify: `apps/webapp/src/components/dashboard/pending-approvals-widget.tsx`
- Modify: `apps/webapp/src/components/dashboard/recently-approved-widget.tsx`
- Modify tests for these widgets if they assert the old `/approvals` URL.

- [ ] **Step 1: Search for old manager approval CTAs**

Run: `rg 'href="/approvals"|actionUrl: "/approvals"' apps/webapp/src`

Expected before implementation: matches in `pending-approvals-widget.tsx`, `recently-approved-widget.tsx`, and no remaining notification trigger matches after Task 1.

- [ ] **Step 2: Update dashboard links to the unified inbox**

In `apps/webapp/src/components/dashboard/pending-approvals-widget.tsx`, replace:

```tsx
<Link href="/approvals">
```

with:

```tsx
<Link href="/approvals/inbox">
```

In `apps/webapp/src/components/dashboard/recently-approved-widget.tsx`, replace:

```tsx
<Link href="/approvals">
```

with:

```tsx
<Link href="/approvals/inbox">
```

- [ ] **Step 3: Update dashboard widget tests if they assert link destinations**

If `apps/webapp/src/components/dashboard/pending-approvals-widget.test.tsx` exists and expects `/approvals`, replace the expectation with:

```ts
expect(screen.getByRole("link", { name: /review all approvals/i })).toHaveAttribute(
	"href",
	"/approvals/inbox",
);
```

If `apps/webapp/src/components/dashboard/recently-approved-widget.test.tsx` exists and expects `/approvals`, replace the expectation with:

```ts
expect(screen.getByRole("link", { name: /view all approvals/i })).toHaveAttribute(
	"href",
	"/approvals/inbox",
);
```

- [ ] **Step 4: Verify no old direct manager approval links remain in changed surfaces**

Run: `rg 'href="/approvals"|actionUrl: "/approvals"' apps/webapp/src`

Expected: no matches for notification triggers or dashboard CTAs. Matches for `/approvals/inbox` are expected.

- [ ] **Step 5: Run relevant dashboard tests if present**

Run existing tests only for files present in the repo:

```bash
pnpm vitest run apps/webapp/src/components/dashboard/pending-approvals-widget.test.tsx apps/webapp/src/components/dashboard/recently-approved-widget.test.tsx
```

Expected: PASS if both files exist. If one test file does not exist, rerun with only the existing test file path.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add apps/webapp/src/components/dashboard/pending-approvals-widget.tsx apps/webapp/src/components/dashboard/recently-approved-widget.tsx apps/webapp/src/components/dashboard/*approvals-widget*.test.tsx
git commit -m "fix: route approval widgets to unified inbox"
```

Expected: commit succeeds. If no dashboard test files changed, omit them from `git add`.

## Task 5: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run all targeted approval and notification tests**

Run:

```bash
pnpm vitest run apps/webapp/src/lib/notifications/triggers.test.ts apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts apps/webapp/src/lib/approvals/server/absence-approvals.test.ts apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run a broader test pass for approval inbox routes**

Run:

```bash
pnpm vitest run apps/webapp/src/app/api/approvals/inbox
```

Expected: PASS.

- [ ] **Step 3: Run type/lint verification available in this repo**

Run:

```bash
pnpm lint
```

Expected: PASS. If the repo has no `lint` script, record the package-manager error and run `pnpm vitest run` for the targeted tests from Step 1 instead.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git status --short
```

Expected: only the intended approval notification, trigger, widget, and test files changed. Existing unrelated untracked files, such as `docs/superpowers/plans/2026-05-09-surcharge-reports-tab.md`, may remain untracked and must not be modified.

## Self-Review

- Spec coverage: requester notifications after final decisions are covered by Tasks 2 and 3; unified inbox promotion is covered by Tasks 1 and 4; no schema or channel changes are introduced.
- Placeholder scan: the plan uses exact paths, commands, code blocks, and expected results.
- Type consistency: travel-expense trigger names are `onTravelExpenseApproved` and `onTravelExpenseRejected` in both tests and implementation; payload keys match across trigger tests and server implementation.
