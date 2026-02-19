import { describe, expect, it } from "vitest";

import type { OvertimeBurnDownData } from "../types";

describe("overtime burn-down data types", () => {
	it("accepts a valid OvertimeBurnDownData object shape", () => {
		const data: OvertimeBurnDownData = {
			summary: {
				currentOvertimeHours: 120,
				wowDeltaHours: -10,
				improvingGroups: 3,
				trendDirection: "down",
			},
			weeklySeries: [
				{ weekStart: "2026-02-02", overtimeHours: 72 },
				{ weekStart: "2026-02-09", overtimeHours: 68 },
			],
			byTeam: [
				{
					id: "team-1",
					label: "Platform",
					currentOvertimeHours: 32,
					previousOvertimeHours: 40,
					wowDeltaHours: -8,
					trendDirection: "down",
					weekly: [
						{ weekStart: "2026-02-02", overtimeHours: 20 },
						{ weekStart: "2026-02-09", overtimeHours: 18 },
					],
				},
			],
			byCostCenter: [
				{
					id: "cc-1",
					label: "Engineering",
					currentOvertimeHours: 58,
					previousOvertimeHours: 60,
					wowDeltaHours: -2,
					trendDirection: "down",
					weekly: [
						{ weekStart: "2026-02-02", overtimeHours: 30 },
						{ weekStart: "2026-02-09", overtimeHours: 28 },
					],
				},
			],
			byManager: [
				{
					id: "mgr-1",
					label: "Alex Kim",
					currentOvertimeHours: 30,
					previousOvertimeHours: 28,
					wowDeltaHours: 2,
					trendDirection: "up",
					weekly: [
						{ weekStart: "2026-02-02", overtimeHours: 14 },
						{ weekStart: "2026-02-09", overtimeHours: 16 },
					],
				},
			],
		};

		expect(data.summary.trendDirection).toBe("down");
		expect(data.byTeam[0]?.trendDirection).toBe("down");
	});
});
