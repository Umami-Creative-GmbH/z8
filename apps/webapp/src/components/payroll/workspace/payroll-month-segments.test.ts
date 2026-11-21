import { describe, expect, it } from "vitest";
import { payrollMonthSegments, startsNewMonth } from "./payroll-month-segments";

describe("payrollMonthSegments", () => {
	it("spans one segment over the days of a single month", () => {
		expect(payrollMonthSegments(["2026-11-01", "2026-11-02", "2026-11-03"])).toEqual([
			{ month: "2026-11", firstDate: "2026-11-01", start: 0, length: 3 },
		]);
	});

	it("splits a range across months and years at each month's first day", () => {
		expect(
			payrollMonthSegments(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-31", "2027-01-01"]),
		).toEqual([
			{ month: "2026-11", firstDate: "2026-11-29", start: 0, length: 2 },
			{ month: "2026-12", firstDate: "2026-12-01", start: 2, length: 2 },
			{ month: "2027-01", firstDate: "2027-01-01", start: 4, length: 1 },
		]);
	});

	it("has no segments without dates", () => {
		expect(payrollMonthSegments([])).toEqual([]);
	});
});

describe("startsNewMonth", () => {
	const dates = ["2026-11-30", "2026-12-01", "2026-12-02"];

	it("marks the first day column of every month after the first", () => {
		expect(dates.map((_, index) => startsNewMonth(dates, index))).toEqual([false, true, false]);
	});

	it("never marks the first column, even on a month's first day", () => {
		expect(startsNewMonth(["2026-12-01", "2026-12-02"], 0)).toBe(false);
	});
});
