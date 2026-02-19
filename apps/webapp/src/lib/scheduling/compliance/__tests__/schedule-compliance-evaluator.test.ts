import { describe, expect, it } from "vitest";
import { evaluateScheduleCompliance } from "@/lib/scheduling/compliance/schedule-compliance-evaluator";

describe("evaluateScheduleCompliance", () => {
	it("flags rest-time, max-hours, and overtime from actual+scheduled data", () => {
		const result = evaluateScheduleCompliance({
			timezone: "Europe/Berlin",
			regulation: {
				minRestPeriodMinutes: 660,
				maxDailyMinutes: 590,
				overtimeDailyThresholdMinutes: 500,
				overtimeWeeklyThresholdMinutes: 1000,
				overtimeMonthlyThresholdMinutes: 1100,
			},
			employees: [
				{
					employeeId: "emp_1",
					actualMinutesByDay: { "2026-02-18": 540 },
					scheduledMinutesByDay: { "2026-02-19": 600 },
					restTransitions: [
						{
							fromEndIso: "2026-02-18T23:00:00+01:00",
							toStartIso: "2026-02-19T08:00:00+01:00",
						},
					],
				},
			],
		});

		expect(result.summary.totalFindings).toBeGreaterThan(0);
		expect(result.summary.byType.restTime).toBe(1);
		expect(result.summary.byType.maxHours).toBe(1);
		expect(result.summary.byType.overtime).toBe(4);

		const overtimePeriods = result.findings
			.filter((finding) => finding.type === "overtime")
			.map((finding) => finding.period)
			.sort();
		expect(overtimePeriods).toEqual(["daily", "daily", "monthly", "weekly"]);
	});

	it("does not emit findings when values are exactly at thresholds", () => {
		const result = evaluateScheduleCompliance({
			timezone: "UTC",
			regulation: {
				minRestPeriodMinutes: 600,
				maxDailyMinutes: 600,
				overtimeDailyThresholdMinutes: 600,
				overtimeWeeklyThresholdMinutes: 600,
				overtimeMonthlyThresholdMinutes: 600,
			},
			employees: [
				{
					employeeId: "emp_1",
					actualMinutesByDay: { "2026-02-18": 300 },
					scheduledMinutesByDay: { "2026-02-18": 300 },
					restTransitions: [
						{
							fromEndIso: "2026-02-18T12:00:00Z",
							toStartIso: "2026-02-18T22:00:00Z",
						},
					],
				},
			],
		});

		expect(result.summary.totalFindings).toBe(0);
		expect(result.findings).toHaveLength(0);
	});

	it("ignores open shifts with no employeeId", () => {
		const result = evaluateScheduleCompliance({
			timezone: "UTC",
			regulation: {},
			employees: [],
		});

		expect(result.summary.totalFindings).toBe(0);
		expect(result.findings).toHaveLength(0);
	});
});
