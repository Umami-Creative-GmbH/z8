import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findMany: vi.fn(),
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
				query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
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

import { BulkApprovalService, BulkApprovalServiceLive } from "./bulk-approval.service";

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
		mockState.approve.mockReturnValue(Effect.void);
		mockState.reject.mockReturnValue(Effect.void);
		mockState.logBatch.mockReturnValue(Effect.void);
	});

	it("does not emit duplicate bulk audit records for successful items", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const service = yield* _(BulkApprovalService);
				return yield* _(service.bulkDecide(["approval-1"], "employee-1", "org-1", "approve"));
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
	});
});
