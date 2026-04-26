import { describe, expect, it } from "vitest";

import { buildApprovalPerformanceData } from "../approval-performance";

const baseSubmittedAt = new Date("2026-04-01T08:00:00.000Z");

describe("buildApprovalPerformanceData", () => {
	const baseRow = {
		source: "approval_request" as const,
		type: "absence_entry",
		organizationId: "org-1",
		requesterEmployeeId: "employee-1",
		requesterTeamId: "team-1",
		requesterTeamName: "Operations",
		approverEmployeeId: "manager-1",
		approverName: "Mina Manager",
		status: "approved" as const,
		submittedAt: baseSubmittedAt,
		decidedAt: new Date("2026-04-01T12:00:00.000Z"),
		slaStatus: "on_time" as const,
	};

	it("calculates approval rate from decided rows and excludes pending rows", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				status: "rejected",
				decidedAt: new Date("2026-04-01T10:00:00.000Z"),
			},
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
			},
		]);

		expect(result.approvalMetrics.totalApprovals).toBe(1);
		expect(result.approvalMetrics.totalRejections).toBe(1);
		expect(result.approvalMetrics.approvalRate).toBe(50);
	});

	it("calculates average decision time in hours from decidedAt and submittedAt", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				decidedAt: new Date("2026-04-01T16:00:00.000Z"),
			},
		]);

		expect(result.approvalMetrics.avgDecisionTimeHours).toBe(6);
		expect(result.approvalMetrics.avgResponseTime).toBe(0.25);
	});

	it("counts pending SLA warnings for approaching and overdue rows", () => {
		const result = buildApprovalPerformanceData([
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
				slaStatus: "approaching",
			},
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
				slaStatus: "overdue",
			},
			{
				...baseRow,
				status: "pending",
				decidedAt: null,
				slaStatus: null,
			},
		]);

		expect(result.approvalMetrics.pendingSlaWarnings).toBe(2);
		expect(result.byManager[0]?.pendingSlaWarnings).toBe(2);
	});

	it("groups bottlenecks by manager, requester team, and approval type", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				source: "travel_expense_claim",
				type: "travel_expense_claim",
				requesterTeamId: "team-2",
				requesterTeamName: "Field Sales",
				approverEmployeeId: "manager-2",
				approverName: "Tara Travel",
				status: "pending",
				decidedAt: null,
				slaStatus: "overdue",
			},
		]);

		expect(result.byManager.map((row) => row.managerName)).toEqual(["Tara Travel", "Mina Manager"]);
		expect(result.byTeam.map((row) => row.label)).toContain("Field Sales");
		expect(result.byType.map((row) => row.label)).toContain("Travel Expense Claim");
	});

	it("excludes draft-like rows before calculation", () => {
		const result = buildApprovalPerformanceData([
			baseRow,
			{
				...baseRow,
				source: "travel_expense_claim",
				type: "travel_expense_claim",
				status: "draft",
				decidedAt: null,
			},
		]);

		expect(result.approvalMetrics.totalApprovals).toBe(1);
		expect(result.byType).toHaveLength(1);
	});
});
