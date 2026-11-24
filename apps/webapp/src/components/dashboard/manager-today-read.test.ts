import { beforeEach, describe, expect, it, vi } from "vitest";

const { getManagerDailyBriefing } = vi.hoisted(() => ({ getManagerDailyBriefing: vi.fn() }));
vi.mock("@/lib/manager-daily-briefing/get-manager-daily-briefing", () => ({
	getManagerDailyBriefing,
}));

import { loadManagerTodayForEmployee } from "./manager-today-read";

const manager = { id: "manager-1", role: "manager" as const, organizationId: "org-1" };

describe("loadManagerTodayForEmployee", () => {
	beforeEach(() => getManagerDailyBriefing.mockReset());

	it("reads only the approval counts, not the approvals the widget never shows (#1980)", async () => {
		getManagerDailyBriefing.mockResolvedValue({
			summary: {
				criticalIssues: 0,
				openApprovals: 2,
				openApprovalsAtLeast: true,
				attendanceExceptions: 0,
				absencesToday: 0,
				coverageRisks: 0,
				overtimeWarnings: 0,
				payrollIssues: 0,
			},
		});

		const result = await loadManagerTodayForEmployee(manager as never);

		expect(getManagerDailyBriefing).toHaveBeenCalledWith({
			currentEmployee: manager,
			approvals: "counts",
		});
		expect(result.summary).toMatchObject({ openApprovals: 2, openApprovalsAtLeast: true });
	});
});
