import { DateTime, Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { formatDateRangeLabel, getDateRangeForPreset } from "./date-ranges";

function dateRangeIsoDates(range: ReturnType<typeof getDateRangeForPreset>) {
	return {
		start: DateTime.fromJSDate(range.start, { zone: "utc" }).toISODate(),
		end: DateTime.fromJSDate(range.end, { zone: "utc" }).toISODate(),
	};
}

function dateRangeIsoTimes(range: ReturnType<typeof getDateRangeForPreset>) {
	return {
		start: DateTime.fromJSDate(range.start, { zone: "utc" }).toISO(),
		end: DateTime.fromJSDate(range.end, { zone: "utc" }).toISO(),
	};
}

describe("getDateRangeForPreset", () => {
	beforeEach(() => {
		Settings.defaultZone = "utc";
		Settings.now = () => Date.parse("2026-05-12T10:30:00.000Z");
	});

	afterEach(() => {
		Settings.now = () => Date.now();
		Settings.defaultZone = "system";
	});

	test("returns the full current calendar year for current_year", () => {
		expect(dateRangeIsoDates(getDateRangeForPreset("current_year"))).toEqual({
			start: "2026-01-01",
			end: "2026-12-31",
		});
	});

	test("returns calendar year to date for ytd", () => {
		const range = getDateRangeForPreset("ytd");

		expect(dateRangeIsoDates(range)).toEqual({
			start: "2026-01-01",
			end: "2026-05-12",
		});
		expect(DateTime.fromJSDate(range.end, { zone: "utc" }).toISO()).toBe(
			"2026-05-12T10:30:00.000Z",
		);
	});

	test("returns the previous calendar year for last_year", () => {
		expect(dateRangeIsoDates(getDateRangeForPreset("last_year"))).toEqual({
			start: "2025-01-01",
			end: "2025-12-31",
		});
	});

	test("keeps numeric year argument working for calendar quarter presets", () => {
		expect(dateRangeIsoDates(getDateRangeForPreset("q2", 2024))).toEqual({
			start: "2024-04-01",
			end: "2024-06-30",
		});
	});

	test("uses the current instant as the ytd end", () => {
		expect(dateRangeIsoTimes(getDateRangeForPreset("ytd"))).toEqual({
			start: "2026-01-01T00:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
		});
	});

	test("uses the configured timezone for calendar-year preset boundaries", () => {
		expect(
			dateRangeIsoTimes(getDateRangeForPreset("current_year", { timezone: "Europe/Berlin" })),
		).toEqual({
			start: "2025-12-31T23:00:00.000Z",
			end: "2026-12-31T22:59:59.999Z",
		});
		expect(
			dateRangeIsoTimes(getDateRangeForPreset("last_year", { timezone: "Europe/Berlin" })),
		).toEqual({
			start: "2024-12-31T23:00:00.000Z",
			end: "2025-12-31T22:59:59.999Z",
		});
		expect(dateRangeIsoTimes(getDateRangeForPreset("ytd", { timezone: "Europe/Berlin" }))).toEqual({
			start: "2025-12-31T23:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
		});
	});

	test("uses the configured timezone for quarter preset boundaries", () => {
		expect(
			dateRangeIsoTimes(getDateRangeForPreset("q2", { year: 2024, timezone: "Europe/Berlin" })),
		).toEqual({
			start: "2024-03-31T22:00:00.000Z",
			end: "2024-06-30T21:59:59.999Z",
		});
	});

	test("formats date range labels in the configured timezone", () => {
		expect(
			formatDateRangeLabel(
				new Date("2025-12-31T23:00:00.000Z"),
				new Date("2026-12-31T22:59:59.999Z"),
				"Europe/Berlin",
			),
		).toBe("Jan 1, 2026 - Dec 31, 2026");
	});
});
