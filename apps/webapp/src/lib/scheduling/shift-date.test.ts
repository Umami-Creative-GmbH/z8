import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate, shiftDateBounds, shiftDateRangeBounds } from "./shift-date";

describe("shift date", () => {
	it.each([
		{ timezone: "Europe/Berlin", stored: "2026-10-08T22:00:00.000Z" },
		{ timezone: "America/New_York", stored: "2026-10-09T04:00:00.000Z" },
		{ timezone: "UTC", stored: "2026-10-09T00:00:00.000Z" },
	])(
		"reads the $timezone organization's stored midnight as its calendar date",
		({ timezone, stored }) => {
			expect(shiftCalendarDate(new Date(stored), timezone).toString()).toBe("2026-10-09");
			expect(shiftDateBounds("2026-10-09", timezone).start.toISOString()).toBe(stored);
		},
	);

	it("bounds a range of organization-local days half-open", () => {
		const bounds = shiftDateRangeBounds("2026-10-09", "2026-10-12", "Europe/Berlin");

		expect(bounds.start.toISOString()).toBe("2026-10-08T22:00:00.000Z");
		expect(bounds.endExclusive.toISOString()).toBe("2026-10-11T22:00:00.000Z");
	});

	it("bounds a range across a DST change by each day's own midnight", () => {
		const bounds = shiftDateRangeBounds("2026-10-24", "2026-10-26", "Europe/Berlin");

		expect(bounds.start.toISOString()).toBe("2026-10-23T22:00:00.000Z");
		expect(bounds.endExclusive.toISOString()).toBe("2026-10-25T23:00:00.000Z");
	});

	it("accepts plain dates for the range ends", () => {
		const bounds = shiftDateRangeBounds(
			parsePlainDate("2026-10-09"),
			parsePlainDate("2026-10-10"),
			"America/New_York",
		);

		expect(bounds).toEqual(shiftDateBounds("2026-10-09", "America/New_York"));
	});

	it("rejects a range that ends before it starts", () => {
		expect(() => shiftDateRangeBounds("2026-10-09", "2026-10-09", "UTC")).toThrow(RangeError);
	});
});
