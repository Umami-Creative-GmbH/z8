import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { ComplianceShiftSource } from "@/lib/scheduling/compliance/employee-compliance-input";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import { addedComplianceFindings } from "./staffing-compliance";

const TZ = "Europe/Berlin";
// Friday; its ISO week starts on Monday 2026-10-05.
const DAY = "2026-10-09";

function shift(date: string, startTime: string, endTime: string): ComplianceShiftSource {
	return { date: shiftStoredDate(date, TZ), startTime, endTime };
}

function work(date: string, startTime: string, endTime: string) {
	const start = Temporal.ZonedDateTime.from(`${date}T${startTime}[${TZ}]`);
	const end = Temporal.ZonedDateTime.from(`${date}T${endTime}[${TZ}]`);
	return {
		startTime: dateFromInstant(start.toInstant()),
		endTime: dateFromInstant(end.toInstant()),
		durationMinutes: start.until(end).total("minutes"),
	};
}

function added(input: {
	regulation: Parameters<typeof addedComplianceFindings>[0]["regulation"];
	shifts?: ComplianceShiftSource[];
	workPeriods?: ReturnType<typeof work>[];
	hypothetical: ComplianceShiftSource;
}) {
	return addedComplianceFindings({
		employeeId: "employee-1",
		timezone: TZ,
		shiftDate: parsePlainDate(DAY),
		regulation: input.regulation,
		shifts: input.shifts ?? [],
		workPeriods: input.workPeriods ?? [],
		hypothetical: input.hypothetical,
	});
}

describe("addedComplianceFindings", () => {
	it("judges the same shift by each candidate's own regulation", () => {
		const hypothetical = shift(DAY, "07:00", "17:00");

		expect(added({ regulation: { maxDailyMinutes: 480 }, hypothetical })).toEqual([
			expect.objectContaining({
				type: "maxHours",
				day: DAY,
				totalMinutes: 600,
				maxDailyMinutes: 480,
			}),
		]);
		expect(added({ regulation: { maxDailyMinutes: 600 }, hypothetical })).toEqual([]);
	});

	it("does not report findings that exist without the shift", () => {
		const findings = added({
			regulation: { maxDailyMinutes: 480, overtimeWeeklyThresholdMinutes: 1200 },
			shifts: [shift("2026-10-05", "06:00", "18:00"), shift("2026-10-06", "06:00", "18:00")],
			hypothetical: shift(DAY, "08:00", "12:00"),
		});

		// The week is already over its threshold and Monday over its daily maximum.
		expect(findings).toEqual([]);
	});

	it("reports a weekly threshold the shift crosses", () => {
		const findings = added({
			regulation: { overtimeWeeklyThresholdMinutes: 1200 },
			shifts: [shift("2026-10-05", "06:00", "16:00")],
			workPeriods: [work("2026-10-06", "08:00", "15:00")],
			hypothetical: shift(DAY, "08:00", "12:00"),
		});

		expect(findings).toEqual([
			{
				type: "overtime",
				employeeId: "employee-1",
				period: "weekly",
				periodKey: "2026-10-05",
				totalMinutes: 600 + 420 + 240,
				thresholdMinutes: 1200,
			},
		]);
	});

	it("reports a short rest before the shift", () => {
		const findings = added({
			regulation: { minRestPeriodMinutes: 660 },
			shifts: [shift("2026-10-08", "14:00", "23:00")],
			hypothetical: shift(DAY, "06:00", "14:00"),
		});

		expect(findings).toEqual([
			expect.objectContaining({ type: "restTime", restMinutes: 7 * 60, minRestPeriodMinutes: 660 }),
		]);
	});

	it("reports a short rest after a shift past midnight", () => {
		const findings = added({
			regulation: { minRestPeriodMinutes: 660 },
			shifts: [shift("2026-10-10", "12:00", "18:00")],
			hypothetical: shift(DAY, "22:00", "06:00"),
		});

		expect(findings).toEqual([expect.objectContaining({ type: "restTime", restMinutes: 6 * 60 })]);
	});

	it("reports nothing without a regulation", () => {
		expect(added({ regulation: {}, hypothetical: shift(DAY, "00:00", "23:00") })).toEqual([]);
	});
});
