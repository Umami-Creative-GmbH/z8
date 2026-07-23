import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	allDayDateKeyForDate,
	calendarDateKeyForDate,
	calendarDateKeyForInstant,
	calendarWeekDateKeyRange,
	todayCalendarDateKey,
} from "./date-keys";

describe("calendar date keys", () => {
	it("derives a local date key from an explicit instant and employee timezone", () => {
		const instant = Temporal.Instant.from("2026-06-01T00:30:00Z");

		expect(calendarDateKeyForInstant(instant, "America/New_York")).toBe("2026-05-31");
		expect(calendarDateKeyForInstant(instant, "Asia/Kathmandu")).toBe("2026-06-01");
	});

	it("derives today from the supplied instant rather than the runtime timezone", () => {
		expect(
			todayCalendarDateKey("America/New_York", Temporal.Instant.from("2026-06-01T00:30:00Z")),
		).toBe("2026-05-31");
	});

	it("uses the employee timezone for timed events while retaining all-day logical dates", () => {
		const eventDate = new Date("2026-06-01T02:00:00Z");

		expect(calendarDateKeyForDate(eventDate, "America/New_York")).toBe("2026-05-31");
		expect(allDayDateKeyForDate(eventDate)).toBe("2026-06-01");
	});

	it("returns an inclusive Monday-start week across a month boundary", () => {
		expect(calendarWeekDateKeyRange("2026-09-03", "monday")).toEqual({
			startDateKey: "2026-08-31",
			endDateKey: "2026-09-06",
		});
	});

	it("returns an inclusive Sunday-start week across a year boundary", () => {
		expect(calendarWeekDateKeyRange("2027-01-01", "sunday")).toEqual({
			startDateKey: "2026-12-27",
			endDateKey: "2027-01-02",
		});
	});
});
