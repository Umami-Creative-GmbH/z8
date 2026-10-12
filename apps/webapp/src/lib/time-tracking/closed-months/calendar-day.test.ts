import { describe, expect, it } from "vitest";
import { dayTouchesClosedRange } from "./calendar-day";

// March closed in Berlin: 28 February 23:00 UTC to 31 March 22:00 UTC.
const berlinMarch = [{ start: "2026-02-28T23:00:00Z", endExclusive: "2026-03-31T22:00:00Z" }];

describe("dayTouchesClosedRange", () => {
	it("marks the closed month's days in the zone it was closed in", () => {
		expect(dayTouchesClosedRange("2026-03-01", "Europe/Berlin", berlinMarch)).toBe(true);
		expect(dayTouchesClosedRange("2026-03-31", "Europe/Berlin", berlinMarch)).toBe(true);
		expect(dayTouchesClosedRange("2026-04-01", "Europe/Berlin", berlinMarch)).toBe(false);
		expect(dayTouchesClosedRange("2026-02-28", "Europe/Berlin", berlinMarch)).toBe(false);
	});

	it("follows the fixed instants after the employee moved to another zone", () => {
		// In New York, the last Berlin hours of February fall on 28 February.
		expect(dayTouchesClosedRange("2026-02-28", "America/New_York", berlinMarch)).toBe(true);
		expect(dayTouchesClosedRange("2026-04-01", "America/New_York", berlinMarch)).toBe(false);
	});

	it("marks nothing without closed ranges", () => {
		expect(dayTouchesClosedRange("2026-03-15", "UTC", [])).toBe(false);
	});
});
