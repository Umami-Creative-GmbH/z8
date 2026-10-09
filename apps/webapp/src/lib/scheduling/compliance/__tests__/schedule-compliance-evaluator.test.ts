import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { evaluateScheduleCompliance } from "@/lib/scheduling/compliance/schedule-compliance-evaluator";
import type { ScheduleComplianceWindow } from "@/lib/scheduling/compliance/types";

function window(start: string, endExclusive: string): ScheduleComplianceWindow {
	return { start: parsePlainDate(start), endExclusive: parsePlainDate(endExclusive) };
}

describe("evaluateScheduleCompliance", () => {
	it("flags rest-time, max-hours, and overtime from actual+scheduled data", () => {
		const result = evaluateScheduleCompliance({
			timezone: "Europe/Berlin",
			window: window("2026-02-16", "2026-02-23"),
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
			window: window("2026-02-16", "2026-02-23"),
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
			window: window("2026-02-16", "2026-02-23"),
			regulation: {},
			employees: [],
		});

		expect(result.summary.totalFindings).toBe(0);
		expect(result.findings).toHaveLength(0);
	});

	describe("judges only the half-open window", () => {
		// Window: Wed 2026-03-04 up to (excluding) Sun 2026-03-08, Europe/Berlin.
		const march = window("2026-03-04", "2026-03-08");

		it("reports daily max-hours and overtime only for days inside the window", () => {
			const result = evaluateScheduleCompliance({
				timezone: "Europe/Berlin",
				window: march,
				regulation: { maxDailyMinutes: 600, overtimeDailyThresholdMinutes: 600 },
				employees: [
					{
						employeeId: "emp_1",
						// Lookback day, first day, last day, day after the window.
						actualMinutesByDay: { "2026-03-03": 700, "2026-03-04": 700 },
						scheduledMinutesByDay: { "2026-03-07": 700, "2026-03-08": 700 },
						restTransitions: [],
					},
				],
			});

			expect(
				result.findings.map((finding) =>
					finding.type === "maxHours"
						? `maxHours:${finding.day}`
						: finding.type === "overtime"
							? `overtime:${finding.period}:${finding.periodKey}`
							: finding.type,
				),
			).toEqual([
				"maxHours:2026-03-04",
				"maxHours:2026-03-07",
				"overtime:daily:2026-03-04",
				"overtime:daily:2026-03-07",
			]);
		});

		it("counts lookback minutes toward weeks and months that overlap the window", () => {
			const result = evaluateScheduleCompliance({
				timezone: "Europe/Berlin",
				window: march,
				regulation: {
					overtimeWeeklyThresholdMinutes: 1000,
					overtimeMonthlyThresholdMinutes: 1500,
				},
				employees: [
					{
						employeeId: "emp_1",
						actualMinutesByDay: {
							// Week of Mon 2026-02-23, entirely in the lookback, February only.
							"2026-02-24": 1100,
							// Mon 2026-03-02 lookback day of the window's week and month.
							"2026-03-02": 600,
						},
						scheduledMinutesByDay: { "2026-03-05": 500 },
						restTransitions: [],
					},
				],
			});

			expect(result.findings).toEqual([
				{
					type: "overtime",
					employeeId: "emp_1",
					period: "weekly",
					periodKey: "2026-03-02",
					totalMinutes: 1100,
					thresholdMinutes: 1000,
				},
			]);
		});

		it("reports monthly overtime for a month that only partly overlaps the window", () => {
			const result = evaluateScheduleCompliance({
				timezone: "Europe/Berlin",
				window: window("2026-02-26", "2026-03-02"),
				regulation: { overtimeMonthlyThresholdMinutes: 1000 },
				employees: [
					{
						employeeId: "emp_1",
						actualMinutesByDay: { "2026-01-20": 1100, "2026-02-02": 900 },
						scheduledMinutesByDay: { "2026-02-27": 200, "2026-03-01": 1100 },
						restTransitions: [],
					},
				],
			});

			expect(
				result.findings.map((finding) => (finding.type === "overtime" ? finding.periodKey : "")),
			).toEqual(["2026-02", "2026-03"]);
		});

		it("reports rest gaps only into intervals that start inside the window", () => {
			const result = evaluateScheduleCompliance({
				timezone: "Europe/Berlin",
				window: march,
				regulation: { minRestPeriodMinutes: 660 },
				employees: [
					{
						employeeId: "emp_1",
						actualMinutesByDay: {},
						scheduledMinutesByDay: {},
						restTransitions: [
							// Inside the lookback.
							{ fromEndIso: "2026-03-02T22:00:00+01:00", toStartIso: "2026-03-03T06:00:00+01:00" },
							// Lookback work period into the first in-window shift.
							{ fromEndIso: "2026-03-03T23:00:00+01:00", toStartIso: "2026-03-04T06:00:00+01:00" },
							// Into the last day of the window, given in UTC.
							{ fromEndIso: "2026-03-06T22:00:00Z", toStartIso: "2026-03-07T05:00:00Z" },
							// Into the day after the window.
							{ fromEndIso: "2026-03-07T22:00:00+01:00", toStartIso: "2026-03-08T06:00:00+01:00" },
						],
					},
				],
			});

			expect(
				result.findings.map((finding) => (finding.type === "restTime" ? finding.toStartIso : "")),
			).toEqual(["2026-03-04T06:00:00+01:00", "2026-03-07T05:00:00Z"]);
		});

		it("judges the window's days in the organization's zone", () => {
			// 2026-03-03T23:30Z is 2026-03-04 00:30 in Berlin, inside the window.
			const result = evaluateScheduleCompliance({
				timezone: "Europe/Berlin",
				window: march,
				regulation: { minRestPeriodMinutes: 660 },
				employees: [
					{
						employeeId: "emp_1",
						actualMinutesByDay: {},
						scheduledMinutesByDay: {},
						restTransitions: [
							{ fromEndIso: "2026-03-03T20:00:00Z", toStartIso: "2026-03-03T23:30:00Z" },
							// 2026-03-07T23:30Z is 2026-03-08 00:30 in Berlin, after the window.
							{ fromEndIso: "2026-03-07T20:00:00Z", toStartIso: "2026-03-07T23:30:00Z" },
						],
					},
				],
			});

			expect(
				result.findings.map((finding) => (finding.type === "restTime" ? finding.toStartIso : "")),
			).toEqual(["2026-03-03T23:30:00Z"]);
		});
	});
});
