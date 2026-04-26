import { describe, expect, it } from "vitest";

import type { ManagerEffectivenessData } from "../types";

describe("ManagerEffectivenessData approval performance shape", () => {
	it("supports decision-time and bottleneck metrics", () => {
		const data = {
			approvalMetrics: {
				avgResponseTime: 0.25,
				avgDecisionTimeHours: 6,
				totalApprovals: 2,
				totalRejections: 1,
				approvalRate: 66.67,
				pendingSlaWarnings: 3,
			},
			byManager: [
				{
					managerId: "manager-1",
					managerName: "Mina Manager",
					avgResponseTime: 0.25,
					avgDecisionTimeHours: 6,
					totalApprovals: 2,
					totalRejections: 1,
					approvalRate: 66.67,
					teamSize: 4,
					pendingCount: 2,
					pendingSlaWarnings: 1,
				},
			],
			byTeam: [
				{
					id: "team-1",
					label: "Operations",
					approvedCount: 2,
					rejectedCount: 1,
					pendingCount: 2,
					pendingSlaWarnings: 1,
					avgDecisionTimeHours: 6,
					approvalRate: 66.67,
				},
			],
			byType: [
				{
					id: "absence_entry",
					label: "Absence Entry",
					approvedCount: 2,
					rejectedCount: 1,
					pendingCount: 2,
					pendingSlaWarnings: 1,
					avgDecisionTimeHours: 6,
					approvalRate: 66.67,
				},
			],
			responseTimeDistribution: [{ bucket: "< 1 day", count: 3, percentage: 100 }],
			trends: [
				{
					month: "2026-04",
					approvals: 2,
					rejections: 1,
					avgResponseTime: 0.25,
					avgDecisionTimeHours: 6,
				},
			],
		} satisfies ManagerEffectivenessData;

		expect(data.approvalMetrics.pendingSlaWarnings).toBe(3);
	});
});
