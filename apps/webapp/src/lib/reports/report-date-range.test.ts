import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { resolveReportDateRange } from "./report-date-range";

describe("resolveReportDateRange", () => {
	it("uses the organization timezone for inclusive calendar dates", () => {
		const range = resolveReportDateRange("2026-05-01", "2026-05-31", "Europe/Berlin");

		expect(range.start.toString()).toBe("2026-04-30T22:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-05-31T22:00:00Z");
	});

	it("preserves local-day boundaries across New York daylight saving time", () => {
		const range = resolveReportDateRange("2026-03-08", "2026-03-08", "America/New_York");

		expect(range.start.toString()).toBe("2026-03-08T05:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-03-09T04:00:00Z");
	});

	it("preserves Berlin local-day boundaries across daylight saving time", () => {
		const range = resolveReportDateRange("2026-03-29", "2026-03-29", "Europe/Berlin");

		expect(range.start.toString()).toBe("2026-03-28T23:00:00Z");
		expect(range.endExclusive.toString()).toBe("2026-03-29T22:00:00Z");
	});

	it("counts a DST fallback date as one inclusive calendar day", () => {
		const range = resolveReportDateRange("2026-10-25", "2026-10-25", "Europe/Berlin");

		expect(range.dayCount).toBe(1);
	});

	it("supports non-hour organization offsets", () => {
		const range = resolveReportDateRange("2026-05-01", "2026-05-01", "Asia/Kathmandu");

		expect(range.start.toString()).toBe("2026-04-30T18:15:00Z");
		expect(range.endExclusive.toString()).toBe("2026-05-01T18:15:00Z");
	});

	it("rejects invalid and reversed dates", () => {
		expect(() => resolveReportDateRange("2026-02-30", "2026-03-01", "UTC")).toThrow();
		expect(() => resolveReportDateRange("2026-05-02", "2026-05-01", "UTC")).toThrow();
	});

	it("clips a period crossing the May boundary in Berlin to the selected local date", () => {
		const range = resolveReportDateRange("2026-05-01", "2026-05-01", "Europe/Berlin");
		const pieces = range.splitPeriod(
			parseInstant("2026-04-30T21:00:00Z"),
			parseInstant("2026-05-01T23:00:00Z"),
		);

		expect(pieces).toEqual([{ date: "2026-05-01", minutes: 1440 }]);
	});

	it("splits a project period at the May-to-June boundary in Berlin", () => {
		const range = resolveReportDateRange("2026-05-31", "2026-06-01", "Europe/Berlin");
		const pieces = range.splitPeriod(
			parseInstant("2026-05-31T21:30:00Z"),
			parseInstant("2026-05-31T22:30:00Z"),
		);

		expect(pieces).toEqual([
			{ date: "2026-05-31", minutes: 30 },
			{ date: "2026-06-01", minutes: 30 },
		]);
	});

	it("preserves the clipped minute total when a one-minute period crosses Berlin midnight", () => {
		const range = resolveReportDateRange("2026-05-01", "2026-05-02", "Europe/Berlin");
		const pieces = range.splitPeriod(
			parseInstant("2026-05-01T21:59:30Z"),
			parseInstant("2026-05-01T22:00:30Z"),
		);

		expect(pieces).toEqual([
			{ date: "2026-05-01", minutes: 0 },
			{ date: "2026-05-02", minutes: 1 },
		]);
		expect(pieces.reduce((total, piece) => total + piece.minutes, 0)).toBe(1);
	});
});
