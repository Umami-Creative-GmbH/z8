import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	getWeekBounds,
	normalizeWeekStartDay,
	WEEK_START_OPTIONS,
	weekStartDayToDayPickerValue,
} from "./week-start";

describe("week start preferences", () => {
	it("defaults unknown values to sunday", () => {
		expect(normalizeWeekStartDay(null)).toBe("sunday");
		expect(normalizeWeekStartDay("friday")).toBe("sunday");
	});

	it("accepts sunday and monday", () => {
		expect(normalizeWeekStartDay("sunday")).toBe("sunday");
		expect(normalizeWeekStartDay("monday")).toBe("monday");
	});

	it("converts to react-day-picker week start numbers", () => {
		expect(weekStartDayToDayPickerValue("sunday")).toBe(0);
		expect(weekStartDayToDayPickerValue("monday")).toBe(1);
	});

	it("exposes translation keys while preserving fallback labels", () => {
		expect(WEEK_START_OPTIONS).toEqual([
			{ value: "sunday", label: "Sunday", labelKey: "settings.weekStart.options.sunday" },
			{ value: "monday", label: "Monday", labelKey: "settings.weekStart.options.monday" },
		]);
	});

	it("computes sunday-based week bounds", () => {
		const { start, end } = getWeekBounds(DateTime.fromISO("2026-05-06T12:00:00"), "sunday");

		expect(start.toISODate()).toBe("2026-05-03");
		expect(end.toISODate()).toBe("2026-05-09");
	});

	it("computes monday-based week bounds", () => {
		const { start, end } = getWeekBounds(DateTime.fromISO("2026-05-06T12:00:00"), "monday");

		expect(start.toISODate()).toBe("2026-05-04");
		expect(end.toISODate()).toBe("2026-05-10");
	});
});
