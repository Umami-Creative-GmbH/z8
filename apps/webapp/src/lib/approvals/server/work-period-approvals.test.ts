import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalAuditLogger } from "../infrastructure/audit-logger";
import type { ApprovalDbService, CurrentApprover } from "./types";

const notificationMocks = vi.hoisted(() => ({
	onClockOutApproved: vi.fn(),
	onClockOutRejected: vi.fn(),
	onManualEntryApproved: vi.fn(),
	onManualEntryRejected: vi.fn(),
}));

vi.mock("@/lib/notifications/triggers", () => notificationMocks);

const {
	approveWorkPeriodWithCurrentApproverEffect,
	finalizeAutoCompletedWorkPeriodApprovalEffect,
	rejectWorkPeriodWithCurrentApproverEffect,
} = await import("./work-period-approvals");

const source = readFileSync(
	"src/lib/approvals/server/work-period-approvals.ts",
	"utf8",
);

const currentApprover: CurrentApprover = {
	id: "manager-1",
	userId: "manager-user-1",
	organizationId: "org-1",
	role: "manager",
	user: {
		id: "manager-user-1",
		name: "Morgan Manager",
		email: "manager@example.com",
		image: null,
	},
};

const approval = {
	id: "approval-1",
	organizationId: "org-1",
	entityType: "time_entry",
	entityId: "period-1",
	requestedBy: "employee-1",
	approverId: "manager-1",
	status: "pending",
	reason: "Manual time entry: missed punch",
	metadata: { timeRequest: { kind: "manual_time_submission" } },
};

const period = {
	id: "period-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	canonicalRecordId: "record-1",
	approvalStatus: "pending",
	pendingChanges: { isManualEntry: true },
	startTime: new Date("2026-07-14T08:00:00.000Z"),
	endTime: new Date("2026-07-14T16:00:00.000Z"),
};

function createDecisionDbService(options?: {
	staleWorkPeriod?: boolean;
	autoCompleted?: boolean;
}) {
	const updateSets: Record<string, unknown>[] = [];
	const insertedValues: Record<string, unknown>[] = [];
	const returningResults = [
		...(options?.autoCompleted ? [] : [[{ id: "approval-1" }]]),
		options?.staleWorkPeriod ? [] : [{ id: "period-1" }],
		[{ id: "record-1" }],
	];
	const selectResults = options?.autoCompleted
		? [[{ ...approval, status: "approved" }], [period]]
		: [[period]];
	const selectWhere = vi
		.fn()
		.mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
	const db = {
		query: {
			approvalRequest: { findFirst: vi.fn().mockResolvedValue(approval) },
			approvalChainStageInstance: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			employee: {
				findFirst: vi.fn().mockResolvedValue({ userId: "employee-user-1" }),
			},
		},
		select: vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) })),
		update: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => {
				updateSets.push(values);
				return {
					where: vi.fn(() => ({
						returning: vi
							.fn()
							.mockResolvedValue(returningResults.shift() ?? []),
					})),
				};
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: Record<string, unknown>) => {
				insertedValues.push(values);
				return Promise.resolve(undefined);
			}),
		})),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db)),
	};

	return {
		db,
		updateSets,
		insertedValues,
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService & {
		updateSets: Record<string, unknown>[];
		insertedValues: Record<string, unknown>[];
	};
}

function runDecision(effect: Effect.Effect<unknown, unknown, unknown>) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(ApprovalAuditLogger, {
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	);
}

describe("ordinary work-period approval finalizer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("approves the source period and canonical record and records one decision", async () => {
		const dbService = createDecisionDbService();

		await runDecision(
			approveWorkPeriodWithCurrentApproverEffect(
				dbService,
				currentApprover,
				"period-1",
				"manual_time_submission",
				{ approvalRequestId: "approval-1" },
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "approved" }),
				expect.objectContaining({
					approvalStatus: "approved",
					pendingChanges: null,
				}),
				expect.objectContaining({
					approvalState: "approved",
					updatedBy: "manager-user-1",
				}),
			]),
		);
		expect(dbService.insertedValues).toContainEqual(
			expect.objectContaining({
				organizationId: "org-1",
				recordId: "record-1",
				actorEmployeeId: "manager-1",
				action: "approved",
			}),
		);
		expect(notificationMocks.onManualEntryApproved).toHaveBeenCalledOnce();
		expect(notificationMocks.onClockOutApproved).not.toHaveBeenCalled();
		expect(
			vi.mocked(dbService.db.transaction).mock.invocationCallOrder[0],
		).toBeLessThan(
			notificationMocks.onManualEntryApproved.mock.invocationCallOrder[0],
		);
	});

	it("rejects the source period and canonical record with the decision reason", async () => {
		const dbService = createDecisionDbService();

		await runDecision(
			rejectWorkPeriodWithCurrentApproverEffect(
				dbService,
				currentApprover,
				"period-1",
				"policy_clock_out",
				"Outside scheduled hours",
				{ approvalRequestId: "approval-1" },
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "rejected",
					rejectionReason: "Outside scheduled hours",
				}),
				expect.objectContaining({
					approvalStatus: "rejected",
					pendingChanges: null,
				}),
				expect.objectContaining({
					approvalState: "rejected",
					updatedBy: "manager-user-1",
				}),
			]),
		);
		expect(dbService.insertedValues[0]).toMatchObject({
			action: "rejected",
			reason: "Outside scheduled hours",
		});
		expect(notificationMocks.onClockOutRejected).toHaveBeenCalledOnce();
		expect(notificationMocks.onManualEntryRejected).not.toHaveBeenCalled();
	});

	it("fails a stale work-period transition before touching the canonical record", async () => {
		const dbService = createDecisionDbService({ staleWorkPeriod: true });

		await expect(
			runDecision(
				approveWorkPeriodWithCurrentApproverEffect(
					dbService,
					currentApprover,
					"period-1",
					"manual_time_submission",
					{ approvalRequestId: "approval-1" },
				),
			),
		).rejects.toThrow("Work period is no longer pending approval");
		expect(dbService.updateSets).toHaveLength(2);
		expect(dbService.insertedValues).not.toContainEqual(
			expect.objectContaining({ recordId: "record-1" }),
		);
		expect(notificationMocks.onManualEntryApproved).not.toHaveBeenCalled();
	});

	it("finalizes an already approved auto-completed request without creating a pending row", async () => {
		const dbService = createDecisionDbService({ autoCompleted: true });

		const result = await Effect.runPromise(
			finalizeAutoCompletedWorkPeriodApprovalEffect(dbService, {
				approvalRequestId: "approval-1",
				organizationId: "org-1",
				requesterEmployeeId: "employee-1",
				requesterUserId: "employee-user-1",
				requesterName: "Avery Employee",
				kind: "manual_time_submission",
			}),
		);

		expect(result).toMatchObject({
			action: "approve",
			kind: "manual_time_submission",
		});
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
			expect.objectContaining({
				approvalState: "approved",
				updatedBy: "employee-user-1",
			}),
		]);
		expect(dbService.insertedValues).toContainEqual(
			expect.objectContaining({
				recordId: "record-1",
				actorEmployeeId: "employee-1",
				action: "approved",
			}),
		);
		expect(notificationMocks.onManualEntryApproved).not.toHaveBeenCalled();
	});

	it("auto-completes a policy clock-out with approved source state and a system decision", async () => {
		const dbService = createDecisionDbService({ autoCompleted: true });

		const result = await Effect.runPromise(
			finalizeAutoCompletedWorkPeriodApprovalEffect(dbService, {
				approvalRequestId: "approval-1",
				organizationId: "org-1",
				requesterEmployeeId: "employee-1",
				requesterUserId: "employee-user-1",
				requesterName: "Avery Employee",
				kind: "policy_clock_out",
			}),
		);

		expect(result).toMatchObject({
			action: "approve",
			kind: "policy_clock_out",
		});
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
			expect.objectContaining({
				approvalState: "approved",
				updatedBy: "employee-user-1",
			}),
		]);
		expect(dbService.insertedValues).toContainEqual(
			expect.objectContaining({
				organizationId: "org-1",
				recordId: "record-1",
				actorEmployeeId: "employee-1",
				action: "approved",
				reason: "requester_is_approver",
			}),
		);
		expect(notificationMocks.onClockOutApproved).not.toHaveBeenCalled();
		expect(notificationMocks.onClockOutRejected).not.toHaveBeenCalled();
	});

	it("keeps every source and canonical mutation organization and employee scoped", () => {
		expect(source).toContain(
			"eq(workPeriod.organizationId, approval.organizationId)",
		);
		expect(source).toContain("eq(workPeriod.employeeId, requestedBy)");
		expect(source).toContain(
			"eq(timeRecord.organizationId, approval.organizationId)",
		);
		expect(source).toContain("eq(timeRecord.employeeId, requestedBy)");
		expect(source).toContain('eq(timeRecord.recordKind, "work")');
	});

	it("never locates or mutates correction entries", () => {
		expect(source).not.toContain("timeEntry");
		expect(source).not.toContain("correctionEntry");
	});
});
