import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	autoClockOutCutoff,
	effectiveAutoClockOutSettings,
	isAutoClockOutDue,
	parseAutoClockOutDuration,
} from "./policy";

describe("automatic clock-out limit policy", () => {
	it("enforces the enabled twelve-hour default without a settings row", () => {
		expect(effectiveAutoClockOutSettings(null)).toEqual({
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 720,
			revision: 0,
		});
	});

	it("parses integral hours and minutes through the PostgreSQL integer boundary", () => {
		expect(parseAutoClockOutDuration(12, 0)).toBe(720);
		expect(parseAutoClockOutDuration(0, 1)).toBe(1);
		expect(parseAutoClockOutDuration(35_791_394, 7)).toBe(2_147_483_647);
	});

	it.each([
		[0, 0],
		[-1, 0],
		[0, -1],
		[1.5, 0],
		[1, 0.5],
		[NaN, 0],
		[0, NaN],
		[Infinity, 0],
		[0, Infinity],
		[0, 60],
		[35_791_394, 8],
		[Number.MAX_SAFE_INTEGER, 0],
	])(
		"rejects invalid duration components %s hours, %s minutes",
		(hours, minutes) => {
			expect(() => parseAutoClockOutDuration(hours, minutes)).toThrow(
				RangeError,
			);
		},
	);

	it("preserves stored settings and produces no cutoff while disabled", () => {
		const settings = {
			autoClockOutEnabled: false,
			maxUninterruptedMinutes: 90,
			revision: 4,
		};
		expect(effectiveAutoClockOutSettings(settings)).toEqual(settings);
		expect(
			autoClockOutCutoff(parseInstant("2026-10-03T08:00:00Z"), settings),
		).toBeNull();
		expect(
			isAutoClockOutDue(
				parseInstant("2026-10-03T08:00:00Z"),
				settings,
				parseInstant("2026-10-04T08:00:00Z"),
			),
		).toBe(false);
	});

	it("becomes due exactly at the cutoff", () => {
		const start = parseInstant("2026-10-03T08:00:00Z");
		const settings = effectiveAutoClockOutSettings(null);
		expect(autoClockOutCutoff(start, settings)?.toString()).toBe(
			"2026-10-03T20:00:00Z",
		);
		expect(
			isAutoClockOutDue(
				start,
				settings,
				parseInstant("2026-10-03T19:59:59.999Z"),
			),
		).toBe(false);
		expect(
			isAutoClockOutDue(start, settings, parseInstant("2026-10-03T20:00:00Z")),
		).toBe(true);
	});

	it("gives resumed work a fresh allowance after a recorded break", () => {
		const settings = effectiveAutoClockOutSettings(null);
		const now = parseInstant("2026-10-03T20:00:00Z");
		expect(
			isAutoClockOutDue(parseInstant("2026-10-03T08:00:00Z"), settings, now),
		).toBe(true);
		expect(
			isAutoClockOutDue(parseInstant("2026-10-03T14:30:00Z"), settings, now),
		).toBe(false);
		expect(
			autoClockOutCutoff(
				parseInstant("2026-10-03T14:30:00Z"),
				settings,
			)?.toString(),
		).toBe("2026-10-04T02:30:00Z");
	});

	it.each([
		["2026-03-29T00:30:00+01:00", "2026-03-29T11:30:00Z"],
		["2026-10-25T00:30:00+02:00", "2026-10-25T10:30:00Z"],
		["2026-10-03T23:30:00Z", "2026-10-04T11:30:00Z"],
	])(
		"measures twelve elapsed UTC hours across DST or midnight from %s",
		(start, expected) => {
			expect(
				autoClockOutCutoff(
					parseInstant(start),
					effectiveAutoClockOutSettings(null),
				)?.toString(),
			).toBe(expected);
		},
	);
});
