import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findMany: vi.fn(),
	loadDecisionTargets: vi.fn(),
	approve: vi.fn(),
	reject: vi.fn(),
	logBatch: vi.fn(),
	logger: { error: vi.fn() },
}));

vi.mock("../domain/registry", () => ({
	getApprovalHandler: vi.fn(() => ({
		displayName: "Travel Expense",
		supportsBulkApprove: true,
		approve: mockState.approve,
		reject: mockState.reject,
	})),
}));

vi.mock("../inbox/decision-service", () => ({
	loadApprovalInboxDecisionTargets: mockState.loadDecisionTargets,
	canAttemptApprovalInboxDecisionTarget: ({
		status,
		workflowKind,
	}: Record<string, string>) =>
		status === "pending" ||
		workflowKind === "manual_time_submission" ||
		workflowKind === "policy_clock_out",
}));

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context, Layer } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	return {
		DatabaseService,
		DatabaseServiceLive: Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: {
					query: {
						approvalRequest: {
							findMany: mockState.findMany,
						},
					},
				},
				query: (_name: string, fn: () => Promise<unknown>) =>
					Effect.promise(fn),
			}),
		),
	};
});

vi.mock("../infrastructure/audit-logger", async () => {
	const { Context, Layer } = await import("effect");
	const ApprovalAuditLogger = Context.GenericTag<any>("ApprovalAuditLogger");
	return {
		ApprovalAuditLogger,
		ApprovalAuditLoggerLive: Layer.succeed(
			ApprovalAuditLogger,
			ApprovalAuditLogger.of({
				log: vi.fn(),
				logBatch: mockState.logBatch,
			}),
		),
	};
});

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

import {
	BulkApprovalService,
	BulkApprovalServiceLive,
} from "./bulk-approval.service";

describe("BulkApprovalService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findMany.mockResolvedValue([
			{
				id: "approval-1",
				entityType: "travel_expense_claim",
				entityId: "claim-1",
				approverId: "employee-1",
				organizationId: "org-1",
				status: "pending",
			},
		]);
		mockState.loadDecisionTargets.mockResolvedValue([
			{
				id: "approval-1",
				targetType: "compatibility_request",
				entityType: "travel_expense_claim",
				entityId: "claim-1",
				approverId: "employee-1",
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
				status: "pending",
			},
		]);
		mockState.approve.mockReturnValue(Effect.void);
		mockState.reject.mockReturnValue(Effect.void);
		mockState.logBatch.mockReturnValue(Effect.void);
	});

	it("does not emit duplicate bulk audit records for successful items", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(BulkApprovalService);
				return yield* _(
					service.bulkDecide(["approval-1"], "employee-1", "org-1", "approve"),
				);
			}).pipe(Effect.provide(BulkApprovalServiceLive)),
		);

		expect(result).toEqual({
			succeeded: [
				{
					id: "approval-1",
					approvalType: "travel_expense_claim",
					status: "approved",
				},
			],
			failed: [],
		});
		expect(mockState.logBatch).not.toHaveBeenCalled();
		expect(mockState.logger.error).not.toHaveBeenCalled();
		expect(mockState.approve).toHaveBeenCalledWith("claim-1", "employee-1", {
			approvalRequestId: "approval-1",
		});
	});

	it("delegates an exact terminal time-entry request for owner replay", async () => {
		mockState.findMany.mockResolvedValue([]);
		mockState.loadDecisionTargets.mockResolvedValue([
			{
				id: "approval-1",
				targetType: "compatibility_request",
				entityType: "time_entry",
				entityId: "period-1",
				approverId: "employee-1",
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
				status: "approved",
				workflowKind: "manual_time_submission",
			},
		]);

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(BulkApprovalService);
				return yield* _(
					service.bulkDecide(["approval-1"], "employee-1", "org-1", "approve"),
				);
			}).pipe(Effect.provide(BulkApprovalServiceLive)),
		);

		expect(result.failed).toEqual([]);
		expect(mockState.approve).toHaveBeenCalledWith("period-1", "employee-1", {
			approvalRequestId: "approval-1",
		});
	});

	it("keeps terminal time corrections stale without invoking their owner", async () => {
		mockState.findMany.mockResolvedValue([]);
		mockState.loadDecisionTargets.mockResolvedValue([
			{
				id: "approval-1",
				targetType: "compatibility_request",
				entityType: "time_entry",
				entityId: "period-1",
				approverId: "employee-1",
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
				status: "approved",
				workflowKind: "time_correction",
			},
		]);

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(BulkApprovalService);
				return yield* _(
					service.bulkDecide(["approval-1"], "employee-1", "org-1", "approve"),
				);
			}).pipe(Effect.provide(BulkApprovalServiceLive)),
		);

		expect(result).toEqual({
			succeeded: [],
			failed: [
				{
					id: "approval-1",
					code: "stale",
					message: "Request is already approved",
				},
			],
		});
		expect(mockState.approve).not.toHaveBeenCalled();
	});

	it("delegates a complete canonical assignment and preserves missing item order", async () => {
		mockState.findMany.mockResolvedValue([]);
		mockState.loadDecisionTargets.mockResolvedValue([
			{
				id: "assignment-1",
				targetType: "canonical_assignment",
				entityType: "time_entry",
				entityId: "period-1",
				approverId: "employee-1",
				requesterEmployeeId: "requester-1",
				organizationId: "org-1",
				status: "pending",
			},
		]);

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(BulkApprovalService);
				return yield* _(
					service.bulkDecide(
						["missing-before", "assignment-1", "missing-after"],
						"employee-1",
						"org-1",
						"approve",
					),
				);
			}).pipe(Effect.provide(BulkApprovalServiceLive)),
		);

		expect(result).toEqual({
			succeeded: [
				{
					id: "assignment-1",
					approvalType: "time_entry",
					status: "approved",
				},
			],
			failed: [
				{
					id: "missing-before",
					code: "not_found",
					message: "Approval request not found",
				},
				{
					id: "missing-after",
					code: "not_found",
					message: "Approval request not found",
				},
			],
		});
		expect(mockState.approve).toHaveBeenCalledWith("period-1", "employee-1", {
			approvalRequestId: "assignment-1",
		});
	});
});
