import { describe, expect, it } from "vitest";
import { plainDateFromCalendarDate } from "./calendar-date";

describe("plainDateFromCalendarDate", () => {
	it("preserves the civil fields emitted by calendar controls", () => {
		const date = new Date(2026, 6, 14, 23, 30);

		expect(plainDateFromCalendarDate(date).toString()).toBe("2026-07-14");
		expect(() => plainDateFromCalendarDate(new Date(Number.NaN))).toThrow();
	});
});
