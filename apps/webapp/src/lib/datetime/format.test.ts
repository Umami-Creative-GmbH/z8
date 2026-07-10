import { describe, expect, it } from "vitest";
import { formatDateOnly, formatDateTime, formatTimeOnly } from "./format";

const INSTANT = new Date("2026-07-10T00:30:00.000Z");

describe("explicit date and time formatting", () => {
	it("uses the requested timezone for calendar dates", () => {
		expect(formatDateOnly(INSTANT, { locale: "en", timezone: "America/New_York" })).toBe(
			"Jul 9, 2026",
		);
		expect(formatDateOnly(INSTANT, { locale: "en", timezone: "Europe/Berlin" })).toBe(
			"Jul 10, 2026",
		);
	});

	it("uses the requested timezone and locale for time output", () => {
		expect(formatTimeOnly(INSTANT, { locale: "en", timezone: "America/New_York" })).toBe(
			"08:30 PM",
		);
		expect(formatDateTime(INSTANT, { locale: "en", timezone: "Europe/Berlin" })).toContain(
			"02:30 AM",
		);
	});

	it("accepts ISO strings and returns a placeholder for invalid values", () => {
		expect(
			formatDateOnly("2026-07-10T00:30:00.000Z", {
				locale: "en",
				timezone: "America/New_York",
			}),
		).toBe("Jul 9, 2026");
		expect(formatDateOnly("not-a-date", { locale: "en", timezone: "UTC" })).toBe("-");
	});
});
