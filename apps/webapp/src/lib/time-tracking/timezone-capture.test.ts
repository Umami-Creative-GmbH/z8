import { describe, expect, it } from "vitest";
import {
	formatUtcOffset,
	getBrowserTimezone,
	getUtcOffsetMinutesForZone,
	isValidIanaTimezone,
	resolveTimeEntryTimezoneCapture,
} from "./timezone-capture";

describe("timezone capture utilities", () => {
	it("derives offsets for the exact timestamp", () => {
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T08:00:00.000Z"), "Europe/Berlin")).toBe(120);
		expect(getUtcOffsetMinutesForZone(new Date("2026-01-29T08:00:00.000Z"), "Europe/Berlin")).toBe(60);
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T12:00:00.000Z"), "America/New_York")).toBe(-240);
		expect(getUtcOffsetMinutesForZone(new Date("2026-01-29T12:00:00.000Z"), "America/New_York")).toBe(-300);
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
		expect(getBrowserTimezone({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Europe/Berlin" }) }) } as unknown as typeof Intl)).toBe("Europe/Berlin");
		expect(getBrowserTimezone({ DateTimeFormat: () => ({ resolvedOptions: () => ({}) }) } as unknown as typeof Intl)).toBeNull();
	});
});
