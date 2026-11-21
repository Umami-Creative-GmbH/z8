import { describe, expect, it } from "vitest";
import { buildPayrollAbsenceDetails } from "./absence-details";
import { absenceRecordDates, type StoredAbsenceRecord } from "./absence-record-dates";

const period = { start: "2026-11-01", end: "2026-11-30" };

/** The days the payroll Absences tab marks for one stored absence record. */
function markedDays(record: StoredAbsenceRecord) {
	return buildPayrollAbsenceDetails(
		[
			{
				employeeId: "employee-1",
				categoryId: "category-1",
				categoryName: "Sick leave",
				startPeriod: record.startPeriod,
				endPeriod: record.endPeriod,
				...absenceRecordDates(record),
			},
		],
		period,
	).map((detail) => `${detail.date}:${detail.period}`);
}

const fullDay = { startPeriod: "full_day", endPeriod: "full_day" } as const;

describe("absenceRecordDates", () => {
	describe("the canonical backfill encoding (end at the next day's midnight, exclusive)", () => {
		it("keeps a Friday sick day on Friday only", () => {
			// Friday 2026-11-20, as runCanonicalBackfill stores an absence_entry without a record.
			const record = {
				...fullDay,
				startAt: new Date("2026-11-20T00:00:00.000Z"),
				endAt: new Date("2026-11-21T00:00:00.000Z"),
			};

			expect(absenceRecordDates(record)).toEqual({
				startDate: "2026-11-20",
				endDate: "2026-11-20",
			});
			expect(markedDays(record)).toEqual(["2026-11-20:full_day"]);
		});

		it("keeps a Monday-to-Friday vacation on its five days", () => {
			const record = {
				...fullDay,
				startAt: new Date("2026-11-16T00:00:00.000Z"),
				endAt: new Date("2026-11-21T00:00:00.000Z"),
			};

			expect(markedDays(record)).toEqual([
				"2026-11-16:full_day",
				"2026-11-17:full_day",
				"2026-11-18:full_day",
				"2026-11-19:full_day",
				"2026-11-20:full_day",
			]);
		});

		it("keeps an afternoon half day on its own day", () => {
			const record = {
				startPeriod: "pm",
				endPeriod: "pm",
				startAt: new Date("2026-11-20T12:00:00.000Z"),
				endAt: new Date("2026-11-21T00:00:00.000Z"),
			} as const;

			expect(markedDays(record)).toEqual(["2026-11-20:pm"]);
		});

		it("keeps a morning half day (ending at noon) on its own day", () => {
			const record = {
				startPeriod: "am",
				endPeriod: "am",
				startAt: new Date("2026-11-20T00:00:00.000Z"),
				endAt: new Date("2026-11-20T12:00:00.000Z"),
			} as const;

			expect(absenceRecordDates(record)).toEqual({
				startDate: "2026-11-20",
				endDate: "2026-11-20",
			});
			expect(markedDays(record)).toEqual(["2026-11-20:am"]);
		});

		it("ends a vacation that ends with an afternoon on that afternoon's day", () => {
			const record = {
				startPeriod: "full_day",
				endPeriod: "pm",
				startAt: new Date("2026-11-18T00:00:00.000Z"),
				endAt: new Date("2026-11-21T00:00:00.000Z"),
			} as const;

			expect(markedDays(record)).toEqual([
				"2026-11-18:full_day",
				"2026-11-19:full_day",
				"2026-11-20:full_day",
			]);
		});
	});

	describe("the request encoding (end inclusive at 23:59:59.999)", () => {
		it("keeps a Friday sick day on Friday only", () => {
			const record = {
				...fullDay,
				startAt: new Date("2026-11-20T00:00:00.000Z"),
				endAt: new Date("2026-11-20T23:59:59.999Z"),
			};

			expect(absenceRecordDates(record)).toEqual({
				startDate: "2026-11-20",
				endDate: "2026-11-20",
			});
			expect(markedDays(record)).toEqual(["2026-11-20:full_day"]);
		});

		it("keeps a multi-day vacation on its days", () => {
			const record = {
				...fullDay,
				startAt: new Date("2026-11-16T00:00:00.000Z"),
				endAt: new Date("2026-11-18T23:59:59.999Z"),
			};

			expect(markedDays(record)).toEqual([
				"2026-11-16:full_day",
				"2026-11-17:full_day",
				"2026-11-18:full_day",
			]);
		});

		it("keeps legacy half days on their day without wall-clock times", () => {
			const morning = {
				startPeriod: "am",
				endPeriod: "am",
				startAt: new Date("2026-11-20T00:00:00.000Z"),
				endAt: new Date("2026-11-20T11:59:59.999Z"),
			} as const;
			const afternoon = {
				startPeriod: "pm",
				endPeriod: "pm",
				startAt: new Date("2026-11-20T12:00:00.000Z"),
				endAt: new Date("2026-11-20T23:59:59.999Z"),
			} as const;

			expect(absenceRecordDates(morning)).toEqual({
				startDate: "2026-11-20",
				endDate: "2026-11-20",
			});
			expect(markedDays(morning)).toEqual(["2026-11-20:am"]);
			expect(markedDays(afternoon)).toEqual(["2026-11-20:pm"]);
		});

		it("carries the wall-clock times of a timed partial day", () => {
			const record = {
				startPeriod: "am",
				endPeriod: "am",
				startAt: new Date("2026-11-20T09:00:00.000Z"),
				endAt: new Date("2026-11-20T11:30:00.000Z"),
			} as const;

			expect(absenceRecordDates(record)).toEqual({
				startDate: "2026-11-20",
				endDate: "2026-11-20",
				startTime: "09:00:00",
				endTime: "11:30:00",
			});
			expect(markedDays(record)).toEqual(["2026-11-20:am"]);
		});

		it("keeps an overnight timed partial ending at midnight on its start day", () => {
			const record = {
				startPeriod: "am",
				endPeriod: "am",
				startAt: new Date("2026-11-20T20:00:00.000Z"),
				endAt: new Date("2026-11-21T00:00:00.000Z"),
			} as const;

			expect(markedDays(record)).toEqual(["2026-11-20:partial_day"]);
		});
	});

	it("reads an absence without an end on its start day", () => {
		expect(
			absenceRecordDates({
				...fullDay,
				startAt: new Date("2026-11-20T00:00:00.000Z"),
				endAt: null,
			}),
		).toEqual({ startDate: "2026-11-20", endDate: "2026-11-20" });
	});
});
