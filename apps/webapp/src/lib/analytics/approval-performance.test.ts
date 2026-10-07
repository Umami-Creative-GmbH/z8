import { describe, expect, it } from "vitest";
import { type ApprovalAnalyticsRow, buildApprovalPerformanceData } from "./approval-performance";

function row(status: ApprovalAnalyticsRow["status"]): ApprovalAnalyticsRow {
	return {
		source: "approval_request",
		type: "travel_expense_report",
		organizationId: "org-1",
		requesterEmployeeId: "emp-1",
		requesterTeamId: null,
		requesterTeamName: null,
		approverEmployeeId: "mgr-1",
		approverName: "Morgan Manager",
		status,
		submittedAt: new Date("2026-09-01T08:00:00Z"),
		decidedAt: status === "pending" ? null : new Date("2026-09-02T08:00:00Z"),
		slaStatus: null,
	};
}

describe("buildApprovalPerformanceData", () => {
	it("never counts returned or withdrawn report cycles as manager rejections (#603)", () => {
		const data = buildApprovalPerformanceData([
			row("approved"),
			row("rejected"),
			row("returned"),
			row("withdrawn"),
		]);

		expect(data.approvalMetrics.totalApprovals).toBe(1);
		expect(data.approvalMetrics.totalRejections).toBe(1);
		expect(data.approvalMetrics.approvalRate).toBe(50);
		expect(data.byManager).toEqual([
			expect.objectContaining({ managerId: "mgr-1", totalApprovals: 1, totalRejections: 1 }),
		]);
		expect(data.trends).toEqual([
			expect.objectContaining({ month: "2026-09", approvals: 1, rejections: 1 }),
		]);
	});
});
