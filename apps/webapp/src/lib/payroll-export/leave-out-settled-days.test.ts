import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { leaveOutSettledDays } from "./leave-out-settled-days";
import type { AbsenceData, WorkPeriodData } from "./types";

const BERLIN = "Europe/Berlin";

function work(
	employeeId: string,
	startAt: string,
	endAt: string,
	durationMinutes: number,
): WorkPeriodData {
	return {
		id: `${employeeId}-${startAt}`,
		employeeId,
		employeeNumber: employeeId.toUpperCase(),
		firstName: null,
		lastName: null,
		startTime: parseInstant(startAt).toZonedDateTimeISO("UTC"),
		endTime: parseInstant(endAt).toZonedDateTimeISO("UTC"),
		durationMinutes,
		workCategoryId: null,
		workCategoryName: null,
		workCategoryFactor: null,
		projectId: null,
		projectName: null,
	};
}

function absence(employeeId: string, startDate: string, endDate: string): AbsenceData {
	return {
		id: `${employeeId}-${startDate}`,
		employeeId,
		employeeNumber: employeeId.toUpperCase(),
		firstName: null,
		lastName: null,
		startDate,
		endDate,
		absenceCategoryId: "vacation",
		absenceCategoryName: "Vacation",
		absenceType: "vacation",
		status: "approved",
	};
}

/** What a formatter reads of a work line: its day (by start), its span and its minutes. */
function lines(periods: readonly WorkPeriodData[]) {
	return periods.map((period) => ({
		employeeId: period.employeeId,
		date: period.startTime.toPlainDate().toString(),
		startAt: period.startTime.toInstant().toString({ fractionalSecondDigits: 3 }),
		endAt: period.endTime?.toInstant().toString({ fractionalSecondDigits: 3 }),
		minutes: period.durationMinutes,
	}));
}

describe("leaving settled days out of a payroll file", () => {
	it("leaves out the work and absences of settled employee-days and keeps every other line as it was", () => {
		const anna10 = work("anna", "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
		const anna11 = work("anna", "2026-11-11T08:00:00Z", "2026-11-11T16:00:00Z", 480);
		const ben10 = work("ben", "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480);
		const annaVacation = absence("anna", "2026-11-12", "2026-11-12");
		const benVacation = absence("ben", "2026-11-12", "2026-11-12");

		const result = leaveOutSettledDays({
			workPeriods: [anna10, anna11, ben10],
			absences: [annaVacation, benVacation],
			settledDays: [
				{ employeeId: "anna", date: "2026-11-10" },
				{ employeeId: "anna", date: "2026-11-12" },
			],
			timezones: new Map([
				["anna", BERLIN],
				["ben", BERLIN],
			]),
		});

		expect(result.workPeriods).toEqual([anna11, ben10]);
		expect(result.absences).toEqual([benVacation]);
	});

	it("cuts a night shift at the employee's local midnight and keeps the part on the unsettled day", () => {
		// 22:00–06:00 in Berlin (winter time), 480 minutes.
		const shift = work("anna", "2026-11-09T21:00:00Z", "2026-11-10T05:00:00Z", 480);

		const mondaySettled = leaveOutSettledDays({
			workPeriods: [shift],
			absences: [],
			settledDays: [{ employeeId: "anna", date: "2026-11-09" }],
			timezones: new Map([["anna", BERLIN]]),
		});
		const tuesdaySettled = leaveOutSettledDays({
			workPeriods: [shift],
			absences: [],
			settledDays: [{ employeeId: "anna", date: "2026-11-10" }],
			timezones: new Map([["anna", BERLIN]]),
		});

		expect(lines(mondaySettled.workPeriods)).toEqual([
			{
				employeeId: "anna",
				date: "2026-11-10",
				startAt: "2026-11-09T23:00:00.000Z",
				endAt: "2026-11-10T05:00:00.000Z",
				minutes: 360,
			},
		]);
		expect(lines(tuesdaySettled.workPeriods)).toEqual([
			{
				employeeId: "anna",
				date: "2026-11-09",
				startAt: "2026-11-09T21:00:00.000Z",
				endAt: "2026-11-09T23:00:00.000Z",
				minutes: 120,
			},
		]);
	});

	it("keeps the unsettled day's share of a night shift with an unlocated break, as the Days tab credits it", () => {
		// 8 hours elapsed, 420 minutes credited: a quarter of the span lies on Monday.
		const shift = work("anna", "2026-11-09T21:00:00Z", "2026-11-10T05:00:00Z", 420);

		const result = leaveOutSettledDays({
			workPeriods: [shift],
			absences: [],
			settledDays: [{ employeeId: "anna", date: "2026-11-10" }],
			timezones: new Map([["anna", BERLIN]]),
		});

		expect(lines(result.workPeriods).map((line) => line.minutes)).toEqual([105]);
	});

	it("splits an absence range around its settled days", () => {
		const result = leaveOutSettledDays({
			workPeriods: [],
			absences: [absence("anna", "2026-11-09", "2026-11-13")],
			settledDays: [
				{ employeeId: "anna", date: "2026-11-09" },
				{ employeeId: "anna", date: "2026-11-11" },
			],
			timezones: new Map([["anna", BERLIN]]),
		});

		expect(result.absences.map(({ startDate, endDate }) => ({ startDate, endDate }))).toEqual([
			{ startDate: "2026-11-10", endDate: "2026-11-10" },
			{ startDate: "2026-11-12", endDate: "2026-11-13" },
		]);
	});
});
