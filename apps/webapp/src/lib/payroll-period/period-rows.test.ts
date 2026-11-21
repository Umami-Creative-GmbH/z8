import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { buildPayrollPeriodRows } from "./period-rows";
import { settledDayValues } from "./settlement-values";
import type {
	CreditedWorkSpan,
	PayrollPeriodAbsenceSource,
	PayrollPeriodEmployeeSource,
} from "./types";

function person(overrides: Partial<PayrollPeriodEmployeeSource> = {}): PayrollPeriodEmployeeSource {
	return {
		id: "employee-1",
		name: "Anna Berg",
		employeeNumber: "E-1",
		teamName: "Ops",
		contractType: "fixed",
		timezone: "Europe/Berlin",
		...overrides,
	};
}

function span(
	startAt: string,
	endExclusive: string,
	minutes: number,
	overrides: Partial<CreditedWorkSpan> = {},
): CreditedWorkSpan {
	return {
		recordId: `record-${startAt}`,
		employeeId: "employee-1",
		startAt: Temporal.Instant.from(startAt),
		endExclusive: Temporal.Instant.from(endExclusive),
		minutes,
		...overrides,
	};
}

function minutesByDate(
	rows: ReturnType<typeof buildPayrollPeriodRows>,
	employeeId = "employee-1",
): Record<string, number> {
	const employee = rows.employees.find((row) => row.id === employeeId);
	return Object.fromEntries(
		(employee?.days ?? [])
			.filter((day) => day.creditedMinutes !== 0)
			.map((day) => [day.date, day.creditedMinutes]),
	);
}

const NOVEMBER = { startDate: "2026-11-01", endDate: "2026-11-30" };

function absence(overrides: Partial<PayrollPeriodAbsenceSource> = {}): PayrollPeriodAbsenceSource {
	return {
		id: "absence-1",
		employeeId: "employee-1",
		categoryId: "vacation",
		categoryName: "Vacation",
		categoryType: "vacation",
		categoryColor: "#22c55e",
		startDate: "2026-11-10",
		endDate: "2026-11-10",
		startPeriod: "full_day",
		endPeriod: "full_day",
		approvalState: "approved",
		...overrides,
	};
}

function absenceMarks(rows: ReturnType<typeof buildPayrollPeriodRows>, employeeId = "employee-1") {
	const employee = rows.employees.find((row) => row.id === employeeId);
	return Object.fromEntries(
		(employee?.days ?? [])
			.filter((day) => day.absences.length > 0)
			.map((day) => [
				day.date,
				day.absences.map((mark) => `${mark.categoryId}:${mark.period}:${mark.approvalState}`),
			]),
	);
}

describe("buildPayrollPeriodRows", () => {
	it("marks the days with credited work or an absence as having entries, holidays alone not", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			work: [
				// 22:00-06:00 Berlin on 2/3 November.
				span("2026-11-02T21:00:00Z", "2026-11-03T05:00:00Z", 480),
				// A zero-minute span still records that the employee was there.
				span("2026-11-05T08:00:00Z", "2026-11-05T08:00:00Z", 0),
			],
			absences: [absence({ startDate: "2026-11-10", endDate: "2026-11-10", approvalState: "pending" })],
			holidays: new Map([
				["employee-1", [{ name: "Holiday", startDate: "2026-11-18", endDate: "2026-11-18" }]],
			]),
		});

		const withEntries = (rows.employees[0]?.days ?? [])
			.filter((day) => day.hasEntries)
			.map((day) => day.date);
		expect(withEntries).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-10"]);
	});

	it("splits a 22:00-06:00 night shift at the employee's local midnight", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			// 22:00-06:00 Berlin (UTC+1) on 9/10 November.
			work: [span("2026-11-09T21:00:00Z", "2026-11-10T05:00:00Z", 480)],
			absences: [],
		});

		expect(minutesByDate(rows)).toEqual({ "2026-11-09": 120, "2026-11-10": 360 });
		expect(rows.employees[0]?.totals.creditedMinutes).toBe(480);
	});

	it("splits across the autumn DST change by elapsed time on the 25-hour night", () => {
		const rows = buildPayrollPeriodRows({
			period: { startDate: "2026-10-01", endDate: "2026-10-31" },
			employees: [person()],
			// Berlin leaves summer time at 03:00 on 25 October 2026: 22:00 (UTC+2) to 06:00 (UTC+1)
			// is nine hours of work, two of them before local midnight.
			work: [span("2026-10-24T20:00:00Z", "2026-10-25T05:00:00Z", 540)],
			absences: [],
		});

		expect(minutesByDate(rows)).toEqual({ "2026-10-24": 120, "2026-10-25": 420 });
	});

	it("credits a span clipped to the period window only to the period's own days", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			// Clipped to the period: the night shift into 1 November starts at local midnight.
			work: [span("2026-10-31T23:00:00Z", "2026-11-01T05:00:00Z", 360)],
			absences: [],
		});

		expect(minutesByDate(rows)).toEqual({ "2026-11-01": 360 });
		expect(rows.employees[0]?.totals.creditedMinutes).toBe(360);
	});

	it("never moves work from outside the period onto its first or last day", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			// A span clipped in another zone than the employee's (an export's stored work after
			// the employee changed zones) reaches into 31 October and 1 December in Berlin.
			employees: [person()],
			work: [
				span("2026-10-31T21:00:00Z", "2026-11-01T05:00:00Z", 480),
				span("2026-11-30T21:00:00Z", "2026-12-01T05:00:00Z", 480),
			],
			absences: [],
		});

		// 22:00–24:00 on 31 October and 00:00–06:00 on 1 December are not period days.
		expect(minutesByDate(rows)).toEqual({ "2026-11-01": 360, "2026-11-30": 120 });
		expect(rows.employees[0]?.totals.creditedMinutes).toBe(480);
	});

	it("adds up exactly to the period credit when a long span crosses several local days", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			// 1001 minutes over 50 h 17 min: day shares are fractional and must not drift.
			work: [span("2026-11-03T20:13:00Z", "2026-11-05T22:30:00Z", 1001)],
			absences: [],
		});

		const days = minutesByDate(rows);
		expect(Object.keys(days)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
		expect(Object.values(days).reduce((sum, minutes) => sum + minutes, 0)).toBe(1001);
		expect(rows.employees[0]?.totals.creditedMinutes).toBe(1001);
	});

	it("keeps the credited part of work that crosses the period boundary on the first day", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			// The credit rule clipped a 31 Oct 22:00 - 1 Nov 06:00 shift to its November part.
			work: [span("2026-10-31T23:00:00Z", "2026-11-01T05:00:00Z", 360)],
			absences: [],
		});

		expect(minutesByDate(rows)).toEqual({ "2026-11-01": 360 });
	});

	it("spreads stored minutes with an unlocated break over the days in proportion", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			// 20:00-08:00 Berlin, twelve hours elapsed but only 600 stored minutes.
			work: [span("2026-11-09T19:00:00Z", "2026-11-10T07:00:00Z", 600)],
			absences: [],
		});

		expect(minutesByDate(rows)).toEqual({ "2026-11-09": 200, "2026-11-10": 400 });
	});

	it("uses each employee's own timezone for their days", () => {
		const work = [
			span("2026-11-10T03:00:00Z", "2026-11-10T07:00:00Z", 240),
			span("2026-11-10T03:00:00Z", "2026-11-10T07:00:00Z", 240, { employeeId: "employee-2" }),
		];
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [
				person(),
				person({ id: "employee-2", name: "Ben Ortiz", timezone: "America/New_York" }),
			],
			work,
			absences: [],
		});

		// 04:00-08:00 in Berlin; 22:00-02:00 in New York.
		expect(minutesByDate(rows, "employee-1")).toEqual({ "2026-11-10": 240 });
		expect(minutesByDate(rows, "employee-2")).toEqual({ "2026-11-09": 120, "2026-11-10": 120 });
	});

	it("lays a multi-day absence with half days out on its local days, clipped to the period", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			work: [],
			absences: [
				absence({ startDate: "2026-11-27", endDate: "2026-12-02", startPeriod: "pm" }),
				absence({
					id: "absence-2",
					categoryId: "sick",
					categoryName: "Sick",
					categoryType: "sick",
					startDate: "2026-11-05",
					endDate: "2026-11-05",
					startPeriod: "am",
					endPeriod: "am",
				}),
			],
		});

		expect(absenceMarks(rows)).toEqual({
			"2026-11-05": ["sick:am:approved"],
			"2026-11-27": ["vacation:pm:approved"],
			"2026-11-28": ["vacation:full_day:approved"],
			"2026-11-29": ["vacation:full_day:approved"],
			"2026-11-30": ["vacation:full_day:approved"],
		});
		expect(rows.employees[0]?.totals.absenceDays).toBe(4);
		expect(rows.absences.map((row) => [row.id, row.daysInPeriod])).toEqual([
			["absence-2", 0.5],
			["absence-1", 3.5],
		]);
	});

	it("flags pending absences and leaves them out of the absence days", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			work: [],
			absences: [
				absence({ approvalState: "pending", startDate: "2026-11-12", endDate: "2026-11-13" }),
			],
		});

		expect(absenceMarks(rows)).toEqual({
			"2026-11-12": ["vacation:full_day:pending"],
			"2026-11-13": ["vacation:full_day:pending"],
		});
		expect(rows.employees[0]?.totals.absenceDays).toBe(0);
		expect(rows.absences[0]).toMatchObject({ approvalState: "pending", daysInPeriod: 2 });
	});

	it("shows required hours, the difference and holidays per day", () => {
		const rows = buildPayrollPeriodRows({
			period: { startDate: "2026-12-24", endDate: "2026-12-27" },
			employees: [person()],
			work: [span("2026-12-24T07:00:00Z", "2026-12-24T12:30:00Z", 330)],
			absences: [],
			requirements: new Map([
				[
					"employee-1",
					{
						"2026-12-24": { requiredMinutes: 240 },
						"2026-12-25": { requiredMinutes: 0 },
						"2026-12-26": { requiredMinutes: 0 },
					},
				],
			]),
			holidays: new Map([
				[
					"employee-1",
					[
						{ name: "Christmas Day", startDate: "2026-12-25", endDate: "2026-12-25" },
						{ name: "Boxing Day", startDate: "2026-12-26", endDate: "2026-12-26" },
					],
				],
			]),
		});

		const days = rows.employees[0]?.days ?? [];
		expect(
			days.map((day) => [
				day.date,
				day.requiredMinutes,
				day.differenceMinutes,
				day.holiday?.name ?? null,
			]),
		).toEqual([
			["2026-12-24", 240, 90, null],
			["2026-12-25", 0, 0, "Christmas Day"],
			["2026-12-26", 0, 0, "Boxing Day"],
			// The requirement source lists no Sunday: nothing is required.
			["2026-12-27", 0, 0, null],
		]);
		expect(rows.employees[0]?.totals).toMatchObject({
			creditedMinutes: 330,
			requiredMinutes: 240,
			differenceMinutes: 90,
		});
	});

	it("leaves required hours empty for an employee without a daily requirement", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			work: [span("2026-11-10T08:00:00Z", "2026-11-10T10:00:00Z", 120)],
			absences: [],
		});

		expect(rows.employees[0]?.totals).toMatchObject({
			creditedMinutes: 120,
			requiredMinutes: null,
			differenceMinutes: null,
		});
	});
});

describe("settlement state of the day rows", () => {
	const settled = {
		id: "settled-1",
		employeeId: "employee-1",
		date: "2026-11-10",
		method: "manual" as const,
		payrollExportJobId: null,
		settledAt: "2026-12-01T09:00:00.000Z",
		paid: { creditedMinutes: 480, absences: [] },
	};

	it("marks a settled employee-day settled with what was paid, and every other day unsettled", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person(), person({ id: "employee-2", name: "Ben" })],
			work: [span("2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z", 480)],
			absences: [],
			settledDays: [settled],
		});

		const anna = rows.employees.find((row) => row.id === "employee-1");
		expect(anna?.days.find((day) => day.date === "2026-11-10")?.settlement).toEqual({
			state: "settled",
			settledDayId: "settled-1",
			method: "manual",
			payrollExportJobId: null,
			settledAt: "2026-12-01T09:00:00.000Z",
			paid: { creditedMinutes: 480, absences: [] },
		});
		expect(anna?.days.find((day) => day.date === "2026-11-11")?.settlement).toEqual({
			state: "unsettled",
		});
		const ben = rows.employees.find((row) => row.id === "employee-2");
		expect(ben?.days.every((day) => day.settlement?.state === "unsettled")).toBe(true);
	});

	it("copies a day's credited minutes and approved absences as the values settling pays", () => {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			work: [span("2026-11-10T07:00:00Z", "2026-11-10T11:00:00Z", 240)],
			absences: [
				absence({ id: "a-pm", categoryId: "vacation", startPeriod: "pm", endPeriod: "pm" }),
				absence({
					id: "a-pending",
					categoryId: "sick",
					categoryName: "Sick",
					categoryType: "sick",
					startPeriod: "am",
					endPeriod: "am",
					approvalState: "pending",
				}),
			],
		});

		const day = rows.employees[0]?.days.find((candidate) => candidate.date === "2026-11-10");
		expect(day && settledDayValues(day)).toEqual({
			creditedMinutes: 240,
			absences: [
				{
					categoryId: "vacation",
					categoryName: "Vacation",
					categoryType: "vacation",
					period: "pm",
				},
			],
		});
	});
});

describe("changed since settled", () => {
	const paidVacationAm = {
		categoryId: "vacation",
		categoryName: "Vacation",
		categoryType: "vacation",
		period: "am" as const,
	};

	function settledDay(paid: { creditedMinutes: number; absences: (typeof paidVacationAm)[] }) {
		return {
			id: "settled-1",
			employeeId: "employee-1",
			date: "2026-11-10",
			method: "manual" as const,
			payrollExportJobId: null,
			settledAt: "2026-12-01T09:00:00.000Z",
			paid,
		};
	}

	function settlementOn10th(input: {
		work?: CreditedWorkSpan[];
		absences?: PayrollPeriodAbsenceSource[];
		paid: { creditedMinutes: number; absences: (typeof paidVacationAm)[] };
	}) {
		const rows = buildPayrollPeriodRows({
			period: NOVEMBER,
			employees: [person()],
			work: input.work ?? [],
			absences: input.absences ?? [],
			settledDays: [settledDay(input.paid)],
		});
		return rows.employees[0]?.days.find((day) => day.date === "2026-11-10")?.settlement;
	}

	const fourHours = span("2026-11-10T07:00:00Z", "2026-11-10T11:00:00Z", 240);
	const vacationAm = absence({ startPeriod: "am", endPeriod: "am" });

	it("stays plain settled while the day still has the values that were paid", () => {
		const settlement = settlementOn10th({
			work: [fourHours],
			absences: [vacationAm],
			paid: { creditedMinutes: 240, absences: [paidVacationAm] },
		});

		expect(settlement?.state).toBe("settled");
	});

	it("is changed since settled with the signed difference when the day has more hours", () => {
		const settlement = settlementOn10th({
			work: [span("2026-11-10T07:00:00Z", "2026-11-10T12:30:00Z", 330)],
			paid: { creditedMinutes: 240, absences: [] },
		});

		expect(settlement).toMatchObject({
			state: "changed_since_settled",
			settledDayId: "settled-1",
			paid: { creditedMinutes: 240, absences: [] },
			change: {
				creditedMinutesDifference: 90,
				absencesChanged: false,
				current: { creditedMinutes: 330, absences: [] },
			},
		});
	});

	it("is changed since settled with a negative difference when the day has fewer hours", () => {
		const settlement = settlementOn10th({
			work: [fourHours],
			paid: { creditedMinutes: 480, absences: [] },
		});

		expect(settlement).toMatchObject({
			state: "changed_since_settled",
			change: { creditedMinutesDifference: -240, absencesChanged: false },
		});
	});

	it("is changed since settled when the absence category changed", () => {
		const settlement = settlementOn10th({
			work: [fourHours],
			absences: [
				absence({
					categoryId: "sick",
					categoryName: "Sick",
					categoryType: "sick",
					startPeriod: "am",
					endPeriod: "am",
				}),
			],
			paid: { creditedMinutes: 240, absences: [paidVacationAm] },
		});

		expect(settlement).toMatchObject({
			state: "changed_since_settled",
			change: { creditedMinutesDifference: 0, absencesChanged: true },
		});
	});

	it("is changed since settled when the absence moved to the other half of the day", () => {
		const settlement = settlementOn10th({
			work: [fourHours],
			absences: [absence({ startPeriod: "pm", endPeriod: "pm" })],
			paid: { creditedMinutes: 240, absences: [paidVacationAm] },
		});

		expect(settlement).toMatchObject({
			state: "changed_since_settled",
			change: { absencesChanged: true },
		});
	});

	it("is changed since settled when an absence was added or removed", () => {
		const added = settlementOn10th({
			work: [fourHours],
			absences: [vacationAm],
			paid: { creditedMinutes: 240, absences: [] },
		});
		const removed = settlementOn10th({
			work: [fourHours],
			paid: { creditedMinutes: 240, absences: [paidVacationAm] },
		});

		expect(added).toMatchObject({
			state: "changed_since_settled",
			change: { absencesChanged: true },
		});
		expect(removed).toMatchObject({
			state: "changed_since_settled",
			change: { absencesChanged: true, current: { creditedMinutes: 240, absences: [] } },
		});
	});

	it("ignores a pending absence, which was never paid, and a renamed category", () => {
		const settlement = settlementOn10th({
			work: [fourHours],
			absences: [
				absence({ startPeriod: "am", endPeriod: "am", categoryName: "Annual leave" }),
				absence({
					id: "absence-2",
					categoryId: "sick",
					startPeriod: "pm",
					endPeriod: "pm",
					approvalState: "pending",
				}),
			],
			paid: { creditedMinutes: 240, absences: [paidVacationAm] },
		});

		expect(settlement?.state).toBe("settled");
	});
});
