import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "./temporal-core";
import {
	formatCapturedOffsetInstant,
	formatInstant,
	formatPlainDate,
	formatUtcOffset,
	offsetMinutesToTimeZoneId,
} from "./temporal-format";

const instant = parseInstant("2026-07-10T12:30:00Z");
const execFileAsync = promisify(execFile);

function normalizeWhitespace(value: string): string {
	return value.replace(/\s/gu, " ").replace(/ +/gu, " ");
}

function numericParts(value: string): number[] {
	return value.match(/\d+/gu)?.map(Number) ?? [];
}

describe("formatInstant", () => {
	it("formats the same instant in the requested named timezone", () => {
		const berlin = formatInstant(
			instant,
			{ locale: "en-GB", timezone: "Europe/Berlin", timeFormat: "24h" },
			"time",
		);
		const newYork = formatInstant(
			instant,
			{ locale: "en-US", timezone: "America/New_York", timeFormat: "12h" },
			"time",
		);

		expect(normalizeWhitespace(berlin)).toContain("14:30");
		expect(normalizeWhitespace(newYork)).toContain("8:30 AM");
	});

	it("formats the instant in named Asia/Kathmandu rather than a captured fixed offset", () => {
		const kathmandu = formatInstant(
			instant,
			{ locale: "en-GB", timezone: "Asia/Kathmandu", timeFormat: "24h" },
			"time",
		);

		expect(normalizeWhitespace(kathmandu)).toContain("18:15");
	});

	it("honors locale and 12-hour or 24-hour preferences", () => {
		const english = formatInstant(
			instant,
			{ locale: "en-US", timezone: "UTC", timeFormat: "12h" },
			"dateTimeMedium",
		);
		const german = formatInstant(
			instant,
			{ locale: "de-DE", timezone: "UTC", timeFormat: "24h" },
			"dateTimeMedium",
		);

		expect(normalizeWhitespace(english)).toContain("12:30 PM");
		expect(english).toContain("Jul");
		expect(normalizeWhitespace(german)).toContain("12:30");
		expect(german).not.toMatch(/\b(?:AM|PM)\b/u);
		expect(german).toContain("Juli");
		expect(german).not.toBe(english);
	});

	it("supports each date and time preset with named fields", () => {
		const context = {
			locale: "en-US",
			timezone: "America/New_York",
			timeFormat: "12h",
		} as const;
		const instantWithSeconds = parseInstant("2026-07-10T12:30:45Z");
		const dateShort = formatInstant(instant, context, "dateShort");
		const dateMedium = formatInstant(instant, context, "dateMedium");
		const dateTimeMedium = formatInstant(instant, context, "dateTimeMedium");
		const time = formatInstant(instant, context, "time");
		const timeWithSeconds = formatInstant(instantWithSeconds, context, "timeWithSeconds");

		expect(numericParts(dateShort)).toEqual([7, 10, 2026]);
		expect(dateMedium).toContain("Jul");
		expect(numericParts(dateMedium)).toEqual([10, 2026]);
		expect(dateTimeMedium).toContain("Jul");
		expect(numericParts(dateTimeMedium)).toEqual([10, 2026, 8, 30]);
		expect(numericParts(time)).toEqual([8, 30]);
		expect(numericParts(timeWithSeconds)).toEqual([8, 30, 45]);
	});

	it("rejects invalid timezones instead of falling back to the host timezone", () => {
		expect(() =>
			formatInstant(
				instant,
				{ locale: "en-US", timezone: "Not/A_Zone", timeFormat: "24h" },
				"time",
			),
		).toThrow(RangeError);
	});
});

describe("formatPlainDate", () => {
	const date = parsePlainDate("2026-07-10");

	it("preserves the calendar date without host-timezone conversion", () => {
		const formatted = formatPlainDate(date, "en-US", "dateShort");

		expect(numericParts(formatted)).toEqual([7, 10, 2026]);
	});

	it("preserves the calendar date in an isolated non-UTC host timezone", async () => {
		const formatted = formatPlainDate(date, "en-US", "dateShort");
		expect(numericParts(formatted)).toEqual([7, 10, 2026]);

		if (process.env.TEMPORAL_FORMAT_NON_UTC_HOST === "1") return;

		// The marker lets the child run this assertion once without recursively spawning another runner.
		await execFileAsync(
			"pnpm",
			["exec", "vitest", "run", "src/lib/datetime/temporal-format.test.ts", "--reporter=dot"],
			{
				cwd: process.cwd(),
				env: {
					...process.env,
					TEMPORAL_FORMAT_NON_UTC_HOST: "1",
					TZ: "America/New_York",
				},
			},
		);
	});

	it("supports medium date, month-day, month-year, and short-weekday presets", () => {
		const dateMedium = formatPlainDate(date, "en-US", "dateMedium");
		const monthDay = formatPlainDate(date, "en-US", "monthDay");
		const monthDayLong = formatPlainDate(date, "en-US", "monthDayLong");
		const monthYear = formatPlainDate(date, "en-US", "monthYear");
		const weekday = formatPlainDate(date, "en-US", "weekdayShort");

		expect(dateMedium).toContain("Jul");
		expect(numericParts(dateMedium)).toEqual([10, 2026]);
		expect(monthDay).toContain("Jul");
		expect(numericParts(monthDay)).toEqual([10]);
		expect(monthDayLong).toContain("July");
		expect(numericParts(monthDayLong)).toEqual([10]);
		expect(monthYear).toContain("July");
		expect(numericParts(monthYear)).toEqual([2026]);
		expect(weekday).toContain("Fri");
	});
});

describe("fixed-offset formatting", () => {
	it("formats valid minute offsets as labels and Temporal timezone identifiers", () => {
		expect(formatUtcOffset(345)).toBe("UTC+05:45");
		expect(formatUtcOffset(-240)).toBe("UTC-04:00");
		expect(formatUtcOffset(0)).toBe("UTC+00:00");
		expect(offsetMinutesToTimeZoneId(345)).toBe("+05:45");
		expect(offsetMinutesToTimeZoneId(-1439)).toBe("-23:59");
		expect(offsetMinutesToTimeZoneId(1439)).toBe("+23:59");
	});

	it("formats captured Kathmandu time in the exact stored offset", () => {
		const formatted = formatCapturedOffsetInstant(instant, {
			locale: "en-GB",
			timeFormat: "24h",
			offsetMinutes: 345,
		});

		expect(normalizeWhitespace(formatted)).toContain("18:15");
	});

	it("uses a historic captured offset even when it differs from IANA rules", () => {
		const winterInstant = parseInstant("2026-01-10T12:30:00Z");
		const captured = formatCapturedOffsetInstant(winterInstant, {
			locale: "en-GB",
			timeFormat: "24h",
			offsetMinutes: 120,
			preset: "dateTimeMedium",
		});
		const berlinRules = formatInstant(
			winterInstant,
			{ locale: "en-GB", timezone: "Europe/Berlin", timeFormat: "24h" },
			"dateTimeMedium",
		);

		expect(normalizeWhitespace(captured)).toContain("14:30");
		expect(normalizeWhitespace(berlinRules)).toContain("13:30");
	});

	it.each([
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects non-integer offset %s", (offsetMinutes) => {
		expect(() => formatUtcOffset(offsetMinutes)).toThrow(RangeError);
		expect(() => offsetMinutesToTimeZoneId(offsetMinutes)).toThrow(RangeError);
		expect(() =>
			formatCapturedOffsetInstant(instant, {
				locale: "en-US",
				timeFormat: "24h",
				offsetMinutes,
			}),
		).toThrow(RangeError);
	});

	it.each([-1440, 1440])("rejects out-of-range offset %s", (offsetMinutes) => {
		expect(() => formatUtcOffset(offsetMinutes)).toThrow(RangeError);
		expect(() => offsetMinutesToTimeZoneId(offsetMinutes)).toThrow(RangeError);
		expect(() =>
			formatCapturedOffsetInstant(instant, {
				locale: "en-US",
				timeFormat: "24h",
				offsetMinutes,
			}),
		).toThrow(RangeError);
	});
});
