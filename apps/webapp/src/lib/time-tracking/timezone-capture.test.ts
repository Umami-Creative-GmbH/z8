import { describe, expect, expectTypeOf, it } from "vitest";
import {
	formatUtcOffset,
	getBrowserTimezone,
	getUtcOffsetMinutesForZone,
	isValidIanaTimezone,
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
	type TimeEntryTimezoneCapture,
} from "./timezone-capture";

describe("timezone capture utilities", () => {
	it("accepts historical inference only for non-browser fallback sources", () => {
		expectTypeOf(
			resolveFallbackTimezoneCapture({
				timestamp: new Date("2026-05-29T12:00:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "historical_inference",
			}),
		).toEqualTypeOf<TimeEntryTimezoneCapture>();
	});

	it("derives offsets for the exact timestamp", () => {
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T12:00:00.000Z"), "UTC")).toBe(0);
		expect(
			getUtcOffsetMinutesForZone(new Date("2026-05-29T12:00:00.000Z"), "Pacific/Honolulu"),
		).toBe(-600);
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T08:00:00.000Z"), "Europe/Berlin")).toBe(
			120,
		);
		expect(getUtcOffsetMinutesForZone(new Date("2026-01-29T08:00:00.000Z"), "Europe/Berlin")).toBe(
			60,
		);
		expect(
			getUtcOffsetMinutesForZone(new Date("2026-05-29T12:00:00.000Z"), "America/New_York"),
		).toBe(-240);
		expect(
			getUtcOffsetMinutesForZone(new Date("2026-01-29T12:00:00.000Z"), "America/New_York"),
		).toBe(-300);
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T12:00:00.000Z"), "Asia/Kathmandu")).toBe(
			345,
		);
		expect(getUtcOffsetMinutesForZone(new Date("1985-01-01T12:00:00.000Z"), "Asia/Kathmandu")).toBe(
			330,
		);
	});

	it("uses UTC for an invalid fallback zone without host timezone dependence", () => {
		expect(
			resolveFallbackTimezoneCapture({
				timestamp: new Date("2026-05-29T12:00:00.000Z"),
				timezone: "Invalid/Timezone",
				timezoneSource: "backfill",
			}),
		).toEqual({ timezone: "UTC", timezoneSource: "backfill", utcOffsetMinutes: 0 });
	});

	it("rejects invalid IANA timezone names", () => {
		expect(isValidIanaTimezone("Europe/Berlin")).toBe(true);
		expect(isValidIanaTimezone("UTC")).toBe(true);
		expect(isValidIanaTimezone("UTC+02:00")).toBe(false);
		expect(isValidIanaTimezone("Not/AZone")).toBe(false);
	});

	it("formats UTC offsets for display", () => {
		expect(formatUtcOffset(120)).toBe("UTC+02:00");
		expect(formatUtcOffset(60)).toBe("UTC+01:00");
		expect(formatUtcOffset(0)).toBe("UTC+00:00");
		expect(formatUtcOffset(-240)).toBe("UTC-04:00");
		expect(formatUtcOffset(-330)).toBe("UTC-05:30");
	});

	it("uses browser timezone when valid", () => {
		expect(
			resolveTimeEntryTimezoneCapture({
				timestamp: new Date("2026-05-29T08:00:00.000Z"),
				browserTimezone: "America/New_York",
				fallbackTimezone: "Europe/Berlin",
				browserSource: "browser",
				fallbackSource: "user_setting",
			}),
		).toEqual({ timezone: "America/New_York", timezoneSource: "browser", utcOffsetMinutes: -240 });
	});

	it("falls back when browser timezone is invalid or missing", () => {
		expect(
			resolveTimeEntryTimezoneCapture({
				timestamp: new Date("2026-05-29T08:00:00.000Z"),
				browserTimezone: "Not/AZone",
				fallbackTimezone: "Europe/Berlin",
				browserSource: "browser",
				fallbackSource: "user_setting",
			}),
		).toEqual({ timezone: "Europe/Berlin", timezoneSource: "user_setting", utcOffsetMinutes: 120 });
	});

	it("reads browser timezone defensively", () => {
		expect(
			getBrowserTimezone({
				DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Europe/Berlin" }) }),
			} as unknown as typeof Intl),
		).toBe("Europe/Berlin");
		expect(
			getBrowserTimezone({
				DateTimeFormat: () => ({ resolvedOptions: () => ({}) }),
			} as unknown as typeof Intl),
		).toBeNull();
	});

	it("returns null when Intl is missing or unavailable", () => {
		expect(getBrowserTimezone(null)).toBeNull();

		const intlDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Intl");

		try {
			Object.defineProperty(globalThis, "Intl", {
				configurable: true,
				get: () => {
					throw new ReferenceError("Intl is unavailable");
				},
			});

			expect(getBrowserTimezone()).toBeNull();
		} finally {
			if (intlDescriptor) {
				Object.defineProperty(globalThis, "Intl", intlDescriptor);
			}
		}
	});

	it("returns null when Intl timezone lookup throws", () => {
		expect(
			getBrowserTimezone({
				DateTimeFormat: () => {
					throw new Error("DateTimeFormat failed");
				},
			} as unknown as typeof Intl),
		).toBeNull();

		expect(
			getBrowserTimezone({
				DateTimeFormat: () => ({
					resolvedOptions: () => {
						throw new Error("resolvedOptions failed");
					},
				}),
			} as unknown as typeof Intl),
		).toBeNull();
	});

	it("resolves fallback timezone capture with valid timezone", () => {
		expect(
			resolveFallbackTimezoneCapture({
				timestamp: new Date("2026-05-29T08:00:00.000Z"),
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
			}),
		).toEqual({ timezone: "Europe/Berlin", timezoneSource: "user_setting", utcOffsetMinutes: 120 });
	});

	it("resolves fallback timezone capture to UTC when timezone is invalid", () => {
		expect(
			resolveFallbackTimezoneCapture({
				timestamp: new Date("2026-05-29T08:00:00.000Z"),
				timezone: "Not/AZone",
				timezoneSource: "backfill",
			}),
		).toEqual({ timezone: "UTC", timezoneSource: "backfill", utcOffsetMinutes: 0 });
	});
});
