import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	latestAutoCloseMonth,
	type ClosedRange,
	closedMonthTouchedByDays,
	closedRangeTouchedByWork,
	employeeMonthRange,
	monthOfFirstDay,
	parseClosedMonth,
} from "./rules";

const at = parseInstant;

function range(month: string, timezone: string): ClosedRange {
	return { month, ...employeeMonthRange(month, timezone) };
}

describe("employeeMonthRange", () => {
	it("is the calendar month in the employee's timezone, as UTC instants", () => {
		const march = employeeMonthRange("2026-03", "Europe/Berlin");

		// Berlin is UTC+1 on 1 March and UTC+2 on 1 April (DST starts 29 March).
		expect(march.start.toString()).toBe("2026-02-28T23:00:00Z");
		expect(march.endExclusive.toString()).toBe("2026-03-31T22:00:00Z");
	});

	it("differs per timezone for the same month", () => {
		const newYork = employeeMonthRange("2026-03", "America/New_York");

		expect(newYork.start.toString()).toBe("2026-03-01T05:00:00Z");
		expect(newYork.endExclusive.toString()).toBe("2026-04-01T04:00:00Z");
	});
});

describe("parseClosedMonth", () => {
	it("accepts YYYY-MM and the month's first day", () => {
		expect(parseClosedMonth("2026-03")).toBe("2026-03");
		expect(parseClosedMonth("2026-03-01")).toBe("2026-03");
	});

	it("refuses anything that is not a calendar month", () => {
		expect(() => parseClosedMonth("2026-13")).toThrow(RangeError);
		expect(() => parseClosedMonth("2026-03-15")).toThrow(RangeError);
		expect(() => parseClosedMonth("March")).toThrow(RangeError);
	});

	it("maps the stored first day back to the month", () => {
		expect(monthOfFirstDay("2026-03-01")).toBe("2026-03");
	});
});

describe("closedRangeTouchedByWork", () => {
	const march = range("2026-03", "Europe/Berlin");

	it("freezes a night shift crossing into the closed month", () => {
		// 31 March 22:00 to 1 April 02:00, Berlin (UTC+2).
		const nightShift = { start: at("2026-03-31T20:00:00Z"), end: at("2026-04-01T00:00:00Z") };

		expect(closedRangeTouchedByWork([nightShift], [march])?.month).toBe("2026-03");
	});

	it("freezes work crossing out of the month before into the closed month", () => {
		const crossing = { start: at("2026-02-28T21:00:00Z"), end: at("2026-02-28T23:30:00Z") };

		expect(closedRangeTouchedByWork([crossing], [march])?.month).toBe("2026-03");
	});

	it("leaves work entirely outside the closed range alone", () => {
		const april = { start: at("2026-04-01T06:00:00Z"), end: at("2026-04-01T14:00:00Z") };

		expect(closedRangeTouchedByWork([april], [march])).toBeNull();
	});

	it("freezes when either the work before or after the change touches the range", () => {
		const before = { start: at("2026-03-31T06:00:00Z"), end: at("2026-03-31T14:00:00Z") };
		const after = { start: at("2026-04-02T06:00:00Z"), end: at("2026-04-02T14:00:00Z") };

		expect(closedRangeTouchedByWork([before, after], [march])?.month).toBe("2026-03");
		expect(closedRangeTouchedByWork([after, before], [march])?.month).toBe("2026-03");
	});

	it("treats live work as reaching forward without end", () => {
		const live = { start: at("2026-02-27T08:00:00Z"), end: null };

		expect(closedRangeTouchedByWork([live], [march])?.month).toBe("2026-03");
	});

	it("counts a moment exactly at the range start as inside, and at its end as outside", () => {
		expect(
			closedRangeTouchedByWork([{ start: march.start, end: march.start }], [march])?.month,
		).toBe("2026-03");
		expect(
			closedRangeTouchedByWork([{ start: march.endExclusive, end: march.endExclusive }], [march]),
		).toBeNull();
	});
});

describe("closedMonthTouchedByDays", () => {
	it("freezes an absence crossing into the closed month", () => {
		// A vacation from 28 March to 3 April while March is closed.
		expect(
			closedMonthTouchedByDays({ startDate: "2026-03-28", endDate: "2026-04-03" }, ["2026-03"]),
		).toBe("2026-03");
	});

	it("freezes an absence starting before the month and ending in it", () => {
		expect(
			closedMonthTouchedByDays({ startDate: "2026-02-27", endDate: "2026-03-01" }, ["2026-03"]),
		).toBe("2026-03");
	});

	it("leaves absences in other months alone", () => {
		expect(
			closedMonthTouchedByDays({ startDate: "2026-04-01", endDate: "2026-04-03" }, ["2026-03"]),
		).toBeNull();
		expect(
			closedMonthTouchedByDays({ startDate: "2026-02-20", endDate: "2026-02-28" }, ["2026-03"]),
		).toBeNull();
	});
});

describe("latestAutoCloseMonth", () => {
	it("is the month before once N days have passed since it ended", () => {
		expect(latestAutoCloseMonth(parsePlainDate("2026-04-06"), 5)).toBe("2026-03");
		expect(latestAutoCloseMonth(parsePlainDate("2026-04-30"), 5)).toBe("2026-03");
	});

	it("is the month before that while the last month's N days are still running", () => {
		expect(latestAutoCloseMonth(parsePlainDate("2026-04-05"), 5)).toBe("2026-02");
		expect(latestAutoCloseMonth(parsePlainDate("2026-04-01"), 1)).toBe("2026-02");
	});

	it("reaches back more than a month for long delays", () => {
		// March ended on 1 April; 45 days later is 16 May.
		expect(latestAutoCloseMonth(parsePlainDate("2026-05-15"), 45)).toBe("2026-02");
		expect(latestAutoCloseMonth(parsePlainDate("2026-05-16"), 45)).toBe("2026-03");
		expect(latestAutoCloseMonth(parsePlainDate("2026-03-03"), 31)).toBe("2025-12");
		expect(latestAutoCloseMonth(parsePlainDate("2026-03-04"), 31)).toBe("2026-01");
	});

	it("crosses the year", () => {
		expect(latestAutoCloseMonth(parsePlainDate("2027-01-03"), 2)).toBe("2026-12");
	});
});
