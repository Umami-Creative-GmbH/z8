import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A canonical kind registered by another module decides its own assignments
 * (#1058): no legacy request or legacy handler stands behind them.
 */

const { decideMock, findFirstMock } = vi.hoisted(() => ({
	decideMock: vi.fn(),
	findFirstMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findFirst: findFirstMock, findMany: async () => [] },
			approvalStageAssignment: { findFirst: async () => null, findMany: async () => [] },
		},
	},
}));

// The kind's inbox type has no legacy handler.
vi.mock("@/lib/approvals/inbox/source-adapters", () => ({
	isSupportedInboxType: (type: string) => type === "time_entry" || type === "travel_expense_claim",
	getSupportedInboxHandler: () => null,
}));

vi.mock("@/lib/approvals/inbox/canonical-inbox-reads", () => {
	const target = {
		id: "assignment-9",
		targetType: "canonical_assignment",
		entityType: "travel_expense_claim",
		entityId: "source-9",
		organizationId: "org-1",
		approverId: "manager-1",
		requesterEmployeeId: "employee-1",
		status: "pending",
		workflowKind: "compliance_exception",
	};
	const read = {
		type: "travel_expense_claim",
		workflowTypes: ["compliance_exception"],
		load: async (input: { assignmentId?: string; assignmentIds?: string[] }) =>
			input.assignmentId === target.id || input.assignmentIds?.includes(target.id)
				? [{ item: { id: target.id }, decisionTarget: target }]
				: [],
		count: async () => 1,
		decide: decideMock,
	};
	return { CANONICAL_INBOX_READS: [read], ordinaryWorkPeriodInboxRead: null };
});

vi.mock("@/lib/logger", () => ({ createLogger: () => ({ error: vi.fn() }) }));

const { approveApprovalInboxItem, bulkApproveApprovalInboxItems, rejectApprovalInboxItem } =
	await import("@/lib/approvals/inbox/decision-service");

describe("deciding a registered canonical kind in the inbox", () => {
	beforeEach(() => {
		decideMock.mockReset().mockResolvedValue(undefined);
		findFirstMock.mockReset().mockResolvedValue(null);
	});

	it("approves through the kind's own decision", async () => {
		await expect(
			approveApprovalInboxItem({
				approvalId: "assignment-9",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
			}),
		).resolves.toEqual({ id: "assignment-9", type: "travel_expense_claim", status: "approved" });
		expect(decideMock).toHaveBeenCalledWith({
			target: expect.objectContaining({
				id: "assignment-9",
				entityId: "source-9",
				workflowKind: "compliance_exception",
			}),
			actorEmployeeId: "manager-1",
			action: "approve",
			allowOrganizationWideApprover: false,
		});
	});

	it("requires a rejection reason and passes it trimmed", async () => {
		const reject = (reason: string) =>
			rejectApprovalInboxItem({
				approvalId: "assignment-9",
				actorEmployeeId: "manager-1",
				organizationId: "org-1",
				reason,
			});
		await expect(reject("  ")).rejects.toThrow("Rejection reason is required");
		expect(decideMock).not.toHaveBeenCalled();

		await expect(reject("  Missing days ")).resolves.toMatchObject({ status: "rejected" });
		expect(decideMock).toHaveBeenCalledWith(
			expect.objectContaining({ action: "reject", reason: "Missing days" }),
		);
	});

	it("refuses the requester's own approval before deciding", async () => {
		await expect(
			approveApprovalInboxItem({
				approvalId: "assignment-9",
				actorEmployeeId: "employee-1",
				organizationId: "org-1",
				includeAllApprovers: true,
			}),
		).rejects.toThrow();
		expect(decideMock).not.toHaveBeenCalled();
	});

	it("decides in bulk through the kind's own decision", async () => {
		const result = await bulkApproveApprovalInboxItems({
			approvalIds: ["assignment-9"],
			actorEmployeeId: "admin-1",
			organizationId: "org-1",
			includeAllApprovers: true,
		});
		expect(result).toEqual({
			succeeded: [{ id: "assignment-9", type: "travel_expense_claim", status: "approved" }],
			failed: [],
		});
		expect(decideMock).toHaveBeenCalledWith(
			expect.objectContaining({ actorEmployeeId: "admin-1", allowOrganizationWideApprover: true }),
		);
	});
});
