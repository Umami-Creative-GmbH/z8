import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { monthStartsAt } from "./month-starts";

describe("monthStartsAt", () => {
	it("starts this and last month at midnight in the organization's time zone", () => {
		const starts = monthStartsAt(parseInstant("2026-03-15T12:00:00Z"), "Europe/Berlin");

		expect(starts.thisMonth.toISOString()).toBe("2026-02-28T23:00:00.000Z");
		expect(starts.lastMonth.toISOString()).toBe("2026-01-31T23:00:00.000Z");
	});

	it("reads the month in the organization's zone, not UTC", () => {
		// Still February in New York while March has begun in UTC.
		const starts = monthStartsAt(parseInstant("2026-03-01T03:00:00Z"), "America/New_York");

		expect(starts.thisMonth.toISOString()).toBe("2026-02-01T05:00:00.000Z");
		expect(starts.lastMonth.toISOString()).toBe("2026-01-01T05:00:00.000Z");
	});
});
