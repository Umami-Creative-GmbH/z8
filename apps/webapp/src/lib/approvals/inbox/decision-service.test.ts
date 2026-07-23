import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";

const {
	approvalRequestFindFirstMock,
	approvalRequestFindManyMock,
	assignmentFindFirstMock,
	assignmentFindManyMock,
	workPeriodFindFirstMock,
	timeEntryFindFirstMock,
	completeHandlerApproveMock,
} = vi.hoisted(() => ({
	approvalRequestFindFirstMock: vi.fn(),
	approvalRequestFindManyMock: vi.fn(),
	assignmentFindFirstMock: vi.fn(),
	assignmentFindManyMock: vi.fn(),
	workPeriodFindFirstMock: vi.fn(),
	timeEntryFindFirstMock: vi.fn(),
	completeHandlerApproveMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: {
				findFirst: approvalRequestFindFirstMock,
				findMany: approvalRequestFindManyMock,
			},
			approvalStageAssignment: {
				findFirst: assignmentFindFirstMock,
				findMany: assignmentFindManyMock,
			},
			workPeriod: { findFirst: workPeriodFindFirstMock },
			timeEntry: { findFirst: timeEntryFindFirstMock },
		},
	},
}));

vi.mock("@/lib/approvals/inbox/source-adapters", () => ({
	isSupportedInboxType: (type: string) =>
		type === "time_entry" || type === "absence_entry",
	getSupportedInboxHandler: (type: string) =>
		type === "time_entry"
			? {
					type: "time_entry",
					approve: completeHandlerApproveMock,
					reject: vi.fn(() => Effect.void),
				}
			: null,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		error: vi.fn(),
	}),
}));

import {
	approveApprovalInboxItem,
	bulkApproveApprovalInboxItems,
	bulkDecideApprovalInboxItemsFromRequests,
	canAttemptApprovalInboxDecisionTarget,
	decideApprovalInboxItemFromRequest,
	loadApprovalInboxDecisionTarget,
} from "@/lib/approvals/inbox/decision-service";

describe("approval inbox decision service", () => {
	beforeEach(() => {
		approvalRequestFindFirstMock.mockReset();
		approvalRequestFindManyMock.mockReset();
		assignmentFindFirstMock.mockReset();
		assignmentFindManyMock.mockReset().mockResolvedValue([]);
		workPeriodFindFirstMock.mockReset().mockResolvedValue(null);
		timeEntryFindFirstMock.mockReset().mockResolvedValue(null);
		completeHandlerApproveMock.mockClear();
		completeHandlerApproveMock.mockReturnValue(Effect.void);
	});

	it("fails closed for unexpected statuses even with an ordinary kind", () => {
		expect(
			canAttemptApprovalInboxDecisionTarget({
				status: "cancelled",
				workflowKind: "manual_time_submission",
			}),
		).toBe(false);
	});

	it("loads an exact active complete-mode assignment as a time-entry decision target", async () => {
		approvalRequestFindFirstMock.mockResolvedValue(null);
		assignmentFindFirstMock.mockResolvedValue({
			id: "assignment-1",
			organizationId: "org-1",
			workflowId: "workflow-1",
			stageId: "stage-1",
			approverEmployeeId: "manager-1",
			status: "pending",
			workflow: {
				id: "workflow-1",
				organizationId: "org-1",
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: "period-1",
				requesterEmployeeId: "employee-1",
				status: "pending",
				currentStageOrder: 2,
			},
			stage: {
				id: "stage-1",
				organizationId: "org-1",
				workflowId: "workflow-1",
				sequence: 2,
				status: "pending",
			},
		});

		await expect(
			approveApprovalInboxItem({
				approvalId: "assignment-1",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({
			id: "assignment-1",
			type: "time_entry",
			status: "approved",
		});
		expect(completeHandlerApproveMock).toHaveBeenCalledWith(
			"period-1",
			"manager-1",
			{ approvalRequestId: "assignment-1" },
		);
	});

	it("loads an exact terminal ordinary assignment so the owner can determine replay", async () => {
		approvalRequestFindFirstMock.mockResolvedValue(null);
		assignmentFindFirstMock.mockResolvedValue({
			id: "assignment-1",
			organizationId: "org-1",
			workflowId: "workflow-1",
			stageId: "stage-1",
			approverEmployeeId: "manager-1",
			status: "approved",
			workflow: {
				id: "workflow-1",
				organizationId: "org-1",
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: "period-1",
				requesterEmployeeId: "employee-1",
				status: "approved",
				currentStageOrder: null,
			},
			stage: {
				id: "stage-1",
				organizationId: "org-1",
				workflowId: "workflow-1",
				sequence: 1,
				status: "approved",
			},
		});

		await approveApprovalInboxItem({
			approvalId: "assignment-1",
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
		});

		expect(completeHandlerApproveMock).toHaveBeenCalledWith(
			"period-1",
			"manager-1",
			{ approvalRequestId: "assignment-1" },
		);
	});

	it("classifies canonical terminal time corrections and rejects them as already processed", async () => {
		approvalRequestFindFirstMock.mockResolvedValue(null);
		assignmentFindFirstMock.mockResolvedValue({
			id: "assignment-1",
			organizationId: "org-1",
			workflowId: "workflow-1",
			stageId: "stage-1",
			approverEmployeeId: "manager-1",
			status: "approved",
			workflow: {
				id: "workflow-1",
				organizationId: "org-1",
				workflowType: "time_correction",
				sourceType: "time_entry",
				sourceId: "period-1",
				requesterEmployeeId: "employee-1",
				status: "approved",
				currentStageOrder: null,
			},
			stage: {
				id: "stage-1",
				organizationId: "org-1",
				workflowId: "workflow-1",
				sequence: 1,
				status: "approved",
			},
		});

		const target = await loadApprovalInboxDecisionTarget({
			approvalId: "assignment-1",
			organizationId: "org-1",
		});
		expect(target.workflowKind).toBe("time_correction");
		await expect(
			approveApprovalInboxItem({
				approvalId: "assignment-1",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).rejects.toThrow("Request is already approved");
		expect(completeHandlerApproveMock).not.toHaveBeenCalled();
	});

	it("classifies metadata-free terminal ordinary requests from exact source evidence", async () => {
		approvalRequestFindFirstMock.mockResolvedValue({
			id: "approval-1",
			entityType: "time_entry",
			entityId: "period-1",
			organizationId: "org-1",
			approverId: "manager-1",
			requestedBy: "employee-1",
			status: "approved",
			metadata: null,
			reason: null,
		});
		workPeriodFindFirstMock.mockResolvedValue({
			id: "period-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			pendingChanges: { isManualEntry: true },
			clockInId: "clock-in-1",
			clockOutId: "clock-out-1",
		});

		const target = await loadApprovalInboxDecisionTarget({
			approvalId: "approval-1",
			organizationId: "org-1",
		});

		expect(target.workflowKind).toBe("manual_time_submission");
	});

	it("classifies metadata-free terminal corrections from exact relational evidence", async () => {
		approvalRequestFindFirstMock.mockResolvedValue({
			id: "approval-1",
			entityType: "time_entry",
			entityId: "period-1",
			organizationId: "org-1",
			approverId: "manager-1",
			requestedBy: "employee-1",
			status: "approved",
			metadata: null,
			reason: null,
		});
		workPeriodFindFirstMock.mockResolvedValue({
			id: "period-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			pendingChanges: null,
			clockInId: "clock-in-1",
			clockOutId: "clock-out-1",
		});
		timeEntryFindFirstMock.mockResolvedValue({ id: "correction-1" });

		const target = await loadApprovalInboxDecisionTarget({
			approvalId: "approval-1",
			organizationId: "org-1",
		});

		expect(target.workflowKind).toBe("time_correction");
		await expect(
			approveApprovalInboxItem({
				approvalId: "approval-1",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).rejects.toThrow("Request is already approved");
		expect(completeHandlerApproveMock).not.toHaveBeenCalled();
	});

	it("fails closed when legacy request metadata contradicts exact source evidence", async () => {
		approvalRequestFindFirstMock.mockResolvedValue({
			id: "approval-1",
			entityType: "time_entry",
			entityId: "period-1",
			organizationId: "org-1",
			approverId: "manager-1",
			requestedBy: "employee-1",
			status: "approved",
			metadata: { timeRequest: { kind: "policy_clock_out" } },
			reason: null,
		});
		workPeriodFindFirstMock.mockResolvedValue({
			id: "period-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			pendingChanges: { isManualEntry: true },
			clockInId: "clock-in-1",
			clockOutId: "clock-out-1",
		});

		const target = await loadApprovalInboxDecisionTarget({
			approvalId: "approval-1",
			organizationId: "org-1",
		});

		expect(target.workflowKind).toBe("unclassified");
		await expect(
			approveApprovalInboxItem({
				approvalId: "approval-1",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).rejects.toThrow("Request is already approved");
		expect(completeHandlerApproveMock).not.toHaveBeenCalled();
	});

	it("loads exact terminal ordinary assignments for bulk replay", async () => {
		approvalRequestFindManyMock.mockResolvedValue([]);
		assignmentFindManyMock.mockResolvedValue([
			{
				id: "assignment-1",
				organizationId: "org-1",
				workflowId: "workflow-1",
				stageId: "stage-1",
				approverEmployeeId: "manager-1",
				status: "approved",
				workflow: {
					id: "workflow-1",
					organizationId: "org-1",
					workflowType: "manual_time_submission",
					sourceType: "time_entry",
					sourceId: "period-1",
					requesterEmployeeId: "employee-1",
					status: "approved",
					currentStageOrder: null,
				},
				stage: {
					id: "stage-1",
					organizationId: "org-1",
					workflowId: "workflow-1",
					sequence: 1,
					status: "approved",
				},
			},
		]);

		const result = await bulkApproveApprovalInboxItems({
			approvalIds: ["assignment-1"],
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
		});

		expect(result.failed).toEqual([]);
		expect(completeHandlerApproveMock).toHaveBeenCalledWith(
			"period-1",
			"manager-1",
			{ approvalRequestId: "assignment-1" },
		);
	});
	it("returns the same generic not-found error for missing and inaccessible single IDs", async () => {
		approvalRequestFindFirstMock
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				id: "approval-inaccessible",
				entityType: "absence_entry",
				entityId: "absence-1",
				organizationId: "org-1",
				approverId: "manager-1",
				requestedBy: "employee-1",
				status: "pending",
			});
		const decide = (approvalId: string) =>
			approveApprovalInboxItem({
				approvalId,
				actorEmployeeId: "outsider-1",
				organizationId: "org-1",
			});

		const missing = await decide("approval-missing").catch((error) => error);
		const inaccessible = await decide("approval-inaccessible").catch(
			(error) => error,
		);

		expect(missing).toBeInstanceOf(NotFoundError);
		expect(inaccessible).toBeInstanceOf(NotFoundError);
		expect({ tag: missing._tag, message: missing.message }).toEqual({
			tag: inaccessible._tag,
			message: inaccessible.message,
		});
		expect(missing.message).toBe("Approval not found");
		expect(approvalRequestFindFirstMock).toHaveBeenCalledTimes(2);
	});

	it("does not reveal which bulk IDs exist but are inaccessible", async () => {
		approvalRequestFindManyMock.mockResolvedValueOnce([
			{
				id: "approval-inaccessible",
				entityType: "absence_entry",
				entityId: "absence-1",
				organizationId: "org-1",
				approverId: "manager-1",
				requestedBy: "employee-1",
				status: "pending",
			},
		]);

		const result = await bulkApproveApprovalInboxItems({
			approvalIds: ["approval-missing", "approval-inaccessible"],
			actorEmployeeId: "outsider-1",
			organizationId: "org-1",
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-missing",
				code: "not_found",
				message: "Approval not found",
			},
			{
				id: "approval-inaccessible",
				code: "not_found",
				message: "Approval not found",
			},
		]);
	});
	it("requires rejection reasons", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "reject",
				reason: "   ",
				handler: {
					type: "absence_entry",
					reject: vi.fn(),
					approve: vi.fn(),
				} as never,
			}),
		).rejects.toThrow("Rejection reason is required");
	});

	it("delegates approve to the persisted source handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "absence_entry", approve, reject: vi.fn() } as never,
			}),
		).resolves.toEqual({
			id: "approval-1",
			type: "absence_entry",
			status: "approved",
		});
		expect(approve).toHaveBeenCalledWith("absence-1", "manager-1", {
			approvalRequestId: "approval-1",
		});
	});

	it("passes the stable time-correction inbox request ID to the handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await decideApprovalInboxItemFromRequest({
			request: {
				id: "time-request-1",
				entityType: "time_entry",
				entityId: "work-period-1",
				organizationId: "org-1",
				approverId: "manager-1",
				requesterEmployeeId: "employee-1",
				status: "pending",
			},
			actorEmployeeId: "manager-1",
			action: "approve",
			handler: { type: "time_entry", approve, reject: vi.fn() } as never,
		});

		expect(approve).toHaveBeenCalledWith("work-period-1", "manager-1", {
			approvalRequestId: "time-request-1",
		});
	});

	it("passes approval request options when approving as a non-assigned actor", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "delegate-1",
				action: "approve",
				handler: { type: "absence_entry", approve, reject: vi.fn() } as never,
			}),
		).resolves.toEqual({
			id: "approval-1",
			type: "absence_entry",
			status: "approved",
		});
		expect(approve).toHaveBeenCalledWith("absence-1", "delegate-1", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});

	it("uses an injected effect runner for single decisions", async () => {
		const effect = Effect.succeed(undefined);
		const runEffect = vi.fn(async () => Exit.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: {
					type: "absence_entry",
					approve: vi.fn(() => effect),
					reject: vi.fn(),
				} as never,
				runEffect,
			}),
		).resolves.toEqual({
			id: "approval-1",
			type: "absence_entry",
			status: "approved",
		});
		expect(runEffect).toHaveBeenCalledWith(effect);
	});

	it("delegates reject to the persisted source handler with trimmed reason", async () => {
		const reject = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "reject",
				reason: "  Missing documentation  ",
				handler: { type: "absence_entry", approve: vi.fn(), reject } as never,
			}),
		).resolves.toEqual({
			id: "approval-1",
			type: "absence_entry",
			status: "rejected",
		});
		expect(reject).toHaveBeenCalledWith(
			"absence-1",
			"manager-1",
			"Missing documentation",
			{
				approvalRequestId: "approval-1",
			},
		);
	});

	it("passes approval request options when rejecting as a non-assigned actor", async () => {
		const reject = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "delegate-1",
				action: "reject",
				reason: "  Missing documentation  ",
				handler: { type: "absence_entry", approve: vi.fn(), reject } as never,
			}),
		).resolves.toEqual({
			id: "approval-1",
			type: "absence_entry",
			status: "rejected",
		});
		expect(reject).toHaveBeenCalledWith(
			"absence-1",
			"delegate-1",
			"Missing documentation",
			{
				approvalRequestId: "approval-1",
				allowAnyApprover: true,
			},
		);
	});

	it("rejects wrong handler type without calling the handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: { type: "time_entry", approve, reject: vi.fn() } as never,
			}),
		).rejects.toThrow("Unsupported approval type: absence_entry");
		expect(approve).not.toHaveBeenCalled();
	});

	it("rejects non-pending requests as stale", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "approved",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: {
					type: "absence_entry",
					approve: vi.fn(),
					reject: vi.fn(),
				} as never,
			}),
		).rejects.toThrow("Request is already approved");
	});

	it("rejects unsupported entity types", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "shift_request",
					entityId: "shift-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: {
					type: "absence_entry",
					approve: vi.fn(),
					reject: vi.fn(),
				} as never,
			}),
		).rejects.toThrow("Unsupported approval type: shift_request");
	});

	it("unwraps handler effect failures", async () => {
		await expect(
			decideApprovalInboxItemFromRequest({
				request: {
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				actorEmployeeId: "manager-1",
				action: "approve",
				handler: {
					type: "absence_entry",
					approve: vi.fn(() => Effect.fail(new Error("domain failed"))),
					reject: vi.fn(),
				} as never,
			}),
		).rejects.toThrow("domain failed");
	});

	it("returns partial success for bulk decisions", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
				{
					id: "approval-2",
					entityType: "absence_entry",
					entityId: "absence-2",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "approved",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() => Effect.succeed(undefined)),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toHaveLength(1);
		expect(result.failed).toEqual([
			{
				id: "approval-2",
				code: "stale",
				message: "Request is already approved",
			},
		]);
	});

	it("returns not found failures for bulk approval ids missing from the org-scoped query", async () => {
		approvalRequestFindManyMock.mockResolvedValueOnce([
			{
				id: "approval-1",
				entityType: "unsupported_type",
				entityId: "entity-1",
				organizationId: "org-1",
				approverId: "manager-1",
				requestedBy: "employee-1",
				status: "pending",
			},
		]);

		const result = await bulkApproveApprovalInboxItems({
			approvalIds: ["approval-1", "missing-approval"],
			actorEmployeeId: "manager-1",
			organizationId: "org-1",
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "unsupported",
				message: "Unsupported approval type: unsupported_type",
			},
			{
				id: "missing-approval",
				code: "not_found",
				message: "Approval not found",
			},
		]);
	});

	it("returns forbidden for bulk decisions by actors outside assigned and eligible scopes", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					requesterEmployeeId: "employee-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-2",
			action: "approve",
			resolveHandler: () =>
				({ type: "absence_entry", approve, reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "not_found",
				message: "Approval not found",
			},
		]);
		expect(approve).not.toHaveBeenCalled();
	});

	it("allows bulk decisions by eligible fallback managers for the request requester and approver", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					requesterEmployeeId: "employee-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-2",
			action: "approve",
			eligibleApprovalScopes: [
				{
					requesterEmployeeId: "employee-1",
					eligibleApproverIds: ["manager-1", "manager-2"],
				},
			],
			resolveHandler: () =>
				({ type: "absence_entry", approve, reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toEqual([
			{ id: "approval-1", type: "absence_entry", status: "approved" },
		]);
		expect(result.failed).toEqual([]);
		expect(approve).toHaveBeenCalledWith("absence-1", "manager-2", {
			approvalRequestId: "approval-1",
			allowAnyApprover: true,
		});
	});

	it("allows bulk decisions by org-wide manage approvers", async () => {
		const reject = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					requesterEmployeeId: "employee-1",
					status: "pending",
				},
			],
			actorEmployeeId: "admin-1",
			action: "reject",
			reason: "Missing documentation",
			includeAllApprovers: true,
			resolveHandler: () =>
				({ type: "absence_entry", approve: vi.fn(), reject }) as never,
		});

		expect(result.succeeded).toEqual([
			{ id: "approval-1", type: "absence_entry", status: "rejected" },
		]);
		expect(result.failed).toEqual([]);
		expect(reject).toHaveBeenCalledWith(
			"absence-1",
			"admin-1",
			"Missing documentation",
			{
				approvalRequestId: "approval-1",
				allowOrganizationWideApprover: true,
			},
		);
	});

	it("passes an injected effect runner through bulk successful decisions", async () => {
		const effect = Effect.succeed(undefined);
		const runEffect = vi.fn(async () => Exit.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() => effect),
					reject: vi.fn(),
				}) as never,
			runEffect,
		});

		expect(result.succeeded).toEqual([
			{ id: "approval-1", type: "absence_entry", status: "approved" },
		]);
		expect(result.failed).toEqual([]);
		expect(runEffect).toHaveBeenCalledWith(effect);
	});

	it("returns a bulk failure for wrong handler type without calling the handler", async () => {
		const approve = vi.fn(() => Effect.succeed(undefined));

		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({ type: "time_entry", approve, reject: vi.fn() }) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "unsupported",
				message: "Unsupported approval type: absence_entry",
			},
		]);
		expect(approve).not.toHaveBeenCalled();
	});

	it("returns a bulk failure for unresolved handlers", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () => null,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "unsupported",
				message: "Unsupported approval type: absence_entry",
			},
		]);
	});

	it("maps ambiguous already processed authorization failures as forbidden", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() =>
						Effect.fail({
							_tag: "AuthorizationError",
							message:
								"Approval request not found, already processed, or you are not the approver",
						}),
					),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "forbidden",
				message: "You are not authorized to decide this request",
			},
		]);
	});

	it("maps clear already approved failures as stale", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() =>
						Effect.fail(
							new ConflictError({
								message: "Approval request is already approved",
								conflictType: "approval_status",
							}),
						),
					),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "stale",
				message: "Approval request is already approved",
			},
		]);
	});

	it("maps arbitrary bulk handler failures to a generic message", async () => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() =>
						Effect.fail(
							new Error("database password connection string leaked"),
						),
					),
					reject: vi.fn(),
				}) as never,
		});

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "approval-1",
				code: "validation_failed",
				message: "Approval decision failed",
			},
		]);
	});

	it.each([
		{
			code: "forbidden",
			error: new AuthorizationError({
				message: "You are not authorized to decide this request",
			}),
			expectedCode: "forbidden",
			expectedMessage: "You are not authorized to decide this request",
		},
		{
			code: "version_conflict",
			error: new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
			}),
			expectedCode: "stale",
			expectedMessage:
				"Approval workflow decision conflicts with the current state",
		},
		{
			code: "idempotency_mismatch",
			error: new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
			}),
			expectedCode: "stale",
			expectedMessage:
				"Approval workflow decision conflicts with the current state",
		},
		{
			code: "malformed_command",
			error: new ValidationError({
				message: "Approval workflow decision is invalid",
			}),
			expectedCode: "validation_failed",
			expectedMessage: "Approval workflow decision is invalid",
		},
	])("maps translated canonical $code errors to a specific bulk failure", async ({
		error,
		expectedCode,
		expectedMessage,
	}) => {
		const result = await bulkDecideApprovalInboxItemsFromRequests({
			requests: [
				{
					id: "approval-1",
					entityType: "absence_entry",
					entityId: "absence-1",
					organizationId: "org-1",
					approverId: "manager-1",
					status: "pending",
				},
			],
			actorEmployeeId: "manager-1",
			action: "approve",
			resolveHandler: () =>
				({
					type: "absence_entry",
					approve: vi.fn(() => Effect.fail(error)),
					reject: vi.fn(),
				}) as never,
		});

		expect(result).toEqual({
			succeeded: [],
			failed: [
				{
					id: "approval-1",
					code: expectedCode,
					message: expectedMessage,
				},
			],
		});
	});
});
