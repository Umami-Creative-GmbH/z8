import { describe, expect, it } from "vitest";
import { calculateCarryoverExpiryDate, getYearRange } from "./date-utils";

describe("absence date utilities", () => {
	it("returns calendar-year boundaries by default", () => {
		const range = getYearRange(2026);

		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("returns April fiscal-year boundaries for a fiscal label year", () => {
		const range = getYearRange(2026, 4);

		expect(range.start.toISO()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2027-03-31T23:59:59.999Z");
	});

	it("calculates fiscal carryover expiry from the fiscal year start", () => {
		const expiry = calculateCarryoverExpiryDate(2026, 3, 4);

		expect(expiry.toISO()).toBe("2026-06-30T23:59:59.999Z");
	});
});
