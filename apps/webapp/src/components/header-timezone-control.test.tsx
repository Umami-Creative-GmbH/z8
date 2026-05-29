/* @vitest-environment jsdom */

import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { formatHeaderTimezone } from "./header-timezone-control";

describe("formatHeaderTimezone", () => {
	it("formats 24-hour local time without seconds and includes the current UTC offset", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Europe/Berlin", timeFormat: "24h" })).toEqual({
			displayTimezone: "Europe/Berlin",
			offsetLabel: "UTC+02:00",
			timeLabel: "14:34",
		});
	});

	it("formats 12-hour local time without seconds", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "America/New_York", timeFormat: "12h" })).toEqual({
			displayTimezone: "America/New_York",
			offsetLabel: "UTC-04:00",
			timeLabel: "8:34 AM",
		});
	});

	it("falls back to UTC when the stored timezone is invalid", () => {
		const now = DateTime.fromISO("2026-05-29T12:34:56.000Z", { zone: "utc" });

		expect(formatHeaderTimezone({ now, timezone: "Not/AZone", timeFormat: "24h" })).toEqual({
			displayTimezone: "UTC",
			offsetLabel: "UTC+00:00",
			timeLabel: "12:34",
		});
	});
});
