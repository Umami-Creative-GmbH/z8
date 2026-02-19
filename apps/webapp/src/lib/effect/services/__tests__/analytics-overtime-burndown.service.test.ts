import { describe, expect, it } from "vitest";
import { buildOvertimeBurnDownDataForTesting } from "../analytics.service";

describe("buildOvertimeBurnDownDataForTesting", () => {
	it("clips negative overtime values to zero", () => {
		const data = buildOvertimeBurnDownDataForTesting(
			[
				{
					weekStart: "2026-02-02",
					overtimeHours: -4,
					teamId: "team-a",
					teamLabel: "Team A",
					costCenterId: "cc-a",
					costCenterLabel: "Cost Center A",
					managerId: "mgr-a",
					managerLabel: "Manager A",
				},
			],
			["2026-02-02"],
		);

		expect(data.weeklySeries).toEqual([{ weekStart: "2026-02-02", overtimeHours: 0 }]);
		expect(data.byTeam[0]?.currentOvertimeHours).toBe(0);
	});

	it("groups overtime by team, cost center, and manager", () => {
		const data = buildOvertimeBurnDownDataForTesting(
			[
				{
					weekStart: "2026-02-02",
					overtimeHours: 5,
					teamId: "team-a",
					teamLabel: "Team A",
					costCenterId: "cc-a",
					costCenterLabel: "Cost Center A",
					managerId: "mgr-a",
					managerLabel: "Manager A",
				},
				{
					weekStart: "2026-02-02",
					overtimeHours: 3,
					teamId: "team-b",
					teamLabel: "Team B",
					costCenterId: "cc-b",
					costCenterLabel: "Cost Center B",
					managerId: "mgr-b",
					managerLabel: "Manager B",
				},
			],
			["2026-02-02"],
		);

		expect(data.byTeam.map((row) => row.id).sort()).toEqual(["team-a", "team-b"]);
		expect(data.byCostCenter.map((row) => row.id).sort()).toEqual(["cc-a", "cc-b"]);
		expect(data.byManager.map((row) => row.id).sort()).toEqual(["mgr-a", "mgr-b"]);
	});

	it("computes week-over-week delta and trend direction", () => {
		const data = buildOvertimeBurnDownDataForTesting(
			[
				{
					weekStart: "2026-02-02",
					overtimeHours: 12,
					teamId: "team-a",
					teamLabel: "Team A",
					costCenterId: "cc-a",
					costCenterLabel: "Cost Center A",
					managerId: "mgr-a",
					managerLabel: "Manager A",
				},
				{
					weekStart: "2026-02-09",
					overtimeHours: 4,
					teamId: "team-a",
					teamLabel: "Team A",
					costCenterId: "cc-a",
					costCenterLabel: "Cost Center A",
					managerId: "mgr-a",
					managerLabel: "Manager A",
				},
				{
					weekStart: "2026-02-02",
					overtimeHours: 8,
					teamId: "team-b",
					teamLabel: "Team B",
					costCenterId: "cc-b",
					costCenterLabel: "Cost Center B",
					managerId: "mgr-b",
					managerLabel: "Manager B",
				},
				{
					weekStart: "2026-02-09",
					overtimeHours: 8,
					teamId: "team-b",
					teamLabel: "Team B",
					costCenterId: "cc-b",
					costCenterLabel: "Cost Center B",
					managerId: "mgr-b",
					managerLabel: "Manager B",
				},
			],
			["2026-02-02", "2026-02-09"],
		);

		expect(data.summary.currentOvertimeHours).toBe(12);
		expect(data.summary.wowDeltaHours).toBe(-8);
		expect(data.summary.trendDirection).toBe("down");
		expect(data.summary.improvingGroups).toBe(1);
	});
});
