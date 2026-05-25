import { describe, expect, it } from "vitest";
import {
	getClosedMonthRange,
	getHotWindowRange,
	getMonthPeriodsBetween,
	getYearPeriodForDate,
} from "./periods";

describe("work balance period helpers", () => {
	it("uses current UTC month plus previous two months as the hot window", () => {
		expect(getHotWindowRange(new Date("2026-05-25T13:00:00.000Z"))).toEqual({
			startDate: "2026-03-01",
			endDate: "2026-05-25",
		});
	});

	it("throws for an invalid hot window date", () => {
		expect(() => getHotWindowRange(new Date(Number.NaN))).toThrow(RangeError);
	});

	it("normalizes a date to its closed month range", () => {
		expect(getClosedMonthRange("2026-02-14")).toEqual({
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
		});
	});

	it("throws for an invalid closed month date", () => {
		expect(() => getClosedMonthRange("not-a-date")).toThrow(RangeError);
	});

	it("lists month periods between two dates", () => {
		expect(getMonthPeriodsBetween("2025-12-15", "2026-02-02")).toEqual([
			{ periodStart: "2025-12-01", periodEnd: "2025-12-31" },
			{ periodStart: "2026-01-01", periodEnd: "2026-01-31" },
			{ periodStart: "2026-02-01", periodEnd: "2026-02-28" },
		]);
	});

	it("returns no month periods for an invalid range", () => {
		expect(getMonthPeriodsBetween("not-a-date", "2026-02-01")).toEqual([]);
	});

	it("returns no month periods for a reversed range", () => {
		expect(getMonthPeriodsBetween("2026-03-01", "2026-02-01")).toEqual([]);
	});

	it("normalizes a date to its year range", () => {
		expect(getYearPeriodForDate("2026-05-25")).toEqual({
			periodStart: "2026-01-01",
			periodEnd: "2026-12-31",
		});
	});

	it("throws for an invalid year date", () => {
		expect(() => getYearPeriodForDate("not-a-date")).toThrow(RangeError);
	});
});
