import { describe, expect, it } from "vitest";
import { formatClosedMonthLabel, monthsOfDateRange } from "./month-label";

describe("closed month labels", () => {
	it("names a month in the reader's language", () => {
		expect(formatClosedMonthLabel("2026-03", "en")).toBe("March 2026");
		expect(formatClosedMonthLabel("2026-03", "de")).toBe("März 2026");
	});

	it("lists the months a date range touches, across a year", () => {
		expect(monthsOfDateRange("2026-11-15", "2027-02-01")).toEqual([
			"2026-11",
			"2026-12",
			"2027-01",
			"2027-02",
		]);
		expect(monthsOfDateRange("2026-03-01", "2026-03-31")).toEqual(["2026-03"]);
	});
});
