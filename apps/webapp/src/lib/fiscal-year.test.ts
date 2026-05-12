import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculateFiscalCarryoverExpiryDate,
	getCurrentFiscalYearLabel,
	getFiscalYearRangeForDate,
	getFiscalYearToDateRange,
	normalizeFiscalYearStartMonth,
} from "./fiscal-year";

describe("fiscal-year utilities", () => {
	it("normalizes invalid fiscal start months to January", () => {
		expect(normalizeFiscalYearStartMonth(undefined)).toBe(1);
		expect(normalizeFiscalYearStartMonth(null)).toBe(1);
		expect(normalizeFiscalYearStartMonth(0)).toBe(1);
		expect(normalizeFiscalYearStartMonth(13)).toBe(1);
		expect(normalizeFiscalYearStartMonth(4.5)).toBe(1);
		expect(normalizeFiscalYearStartMonth(4)).toBe(4);
	});

	it("returns calendar-year boundaries for January fiscal years", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-05-12", { zone: "UTC" }), 1);

		expect(range.labelYear).toBe(2026);
		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("returns current fiscal year spanning two calendar years", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-03-31", { zone: "UTC" }), 4);

		expect(range.labelYear).toBe(2025);
		expect(range.start.toISO()).toBe("2025-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-03-31T23:59:59.999Z");
	});

	it("starts the new fiscal year on the configured month boundary", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-04-01", { zone: "UTC" }), 4);

		expect(range.labelYear).toBe(2026);
		expect(range.start.toISO()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2027-03-31T23:59:59.999Z");
	});

	it("handles December fiscal years", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-11-30", { zone: "UTC" }), 12);

		expect(range.labelYear).toBe(2025);
		expect(range.start.toISO()).toBe("2025-12-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-11-30T23:59:59.999Z");
	});

	it("returns fiscal year-to-date through the provided date", () => {
		const range = getFiscalYearToDateRange(DateTime.fromISO("2026-05-12T15:30:00", { zone: "UTC" }), 4);

		expect(range.start.toISO()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-05-12T15:30:00.000Z");
	});

	it("returns the current fiscal year label", () => {
		expect(getCurrentFiscalYearLabel(DateTime.fromISO("2026-03-31", { zone: "UTC" }), 4)).toBe(2025);
		expect(getCurrentFiscalYearLabel(DateTime.fromISO("2026-04-01", { zone: "UTC" }), 4)).toBe(2026);
	});

	it("calculates carryover expiry from fiscal year start", () => {
		const expiry = calculateFiscalCarryoverExpiryDate(2026, 4, 3);

		expect(expiry.toISO()).toBe("2026-06-30T23:59:59.999Z");
	});
});
