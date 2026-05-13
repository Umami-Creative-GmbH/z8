import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DateTime, Settings } from "luxon";
import { getDateRangeForPreset } from "./date-ranges";

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

	test("returns the full current fiscal year for current_year when fiscal year starts in April", () => {
		expect(
			dateRangeIsoDates(getDateRangeForPreset("current_year", { fiscalYearStartMonth: 4 })),
		).toEqual({
			start: "2026-04-01",
			end: "2027-03-31",
		});
	});

	test("returns fiscal year to date for ytd when fiscal year starts in April", () => {
		const range = getDateRangeForPreset("ytd", { fiscalYearStartMonth: 4 });

		expect(dateRangeIsoDates(range)).toEqual({
			start: "2026-04-01",
			end: "2026-05-12",
		});
		expect(DateTime.fromJSDate(range.end, { zone: "utc" }).toISO()).toBe("2026-05-12T10:30:00.000Z");
	});

	test("returns the previous fiscal year for last_year when fiscal year starts in April", () => {
		expect(
			dateRangeIsoDates(getDateRangeForPreset("last_year", { fiscalYearStartMonth: 4 })),
		).toEqual({
			start: "2025-04-01",
			end: "2026-03-31",
		});
	});

	test("keeps numeric year argument working for calendar quarter presets", () => {
		expect(dateRangeIsoDates(getDateRangeForPreset("q2", 2024))).toEqual({
			start: "2024-04-01",
			end: "2024-06-30",
		});
	});

	test("uses organization timezone for April fiscal current_year boundaries", () => {
		expect(
			dateRangeIsoTimes(
				getDateRangeForPreset("current_year", {
					fiscalYearStartMonth: 4,
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual({
			start: "2026-03-31T22:00:00.000Z",
			end: "2027-03-31T21:59:59.999Z",
		});
	});

	test("uses organization timezone for April fiscal ytd and last_year boundaries", () => {
		expect(
			dateRangeIsoTimes(
				getDateRangeForPreset("ytd", {
					fiscalYearStartMonth: 4,
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual({
			start: "2026-03-31T22:00:00.000Z",
			end: "2026-05-12T10:30:00.000Z",
		});
		expect(
			dateRangeIsoTimes(
				getDateRangeForPreset("last_year", {
					fiscalYearStartMonth: 4,
					timezone: "Europe/Berlin",
				}),
			),
		).toEqual({
			start: "2025-03-31T22:00:00.000Z",
			end: "2026-03-31T21:59:59.999Z",
		});
	});
});
