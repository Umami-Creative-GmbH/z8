import { afterEach, describe, expect, it } from "vitest";
import type { HolidayPreview } from "./date-holidays-service";
import {
	isHolidayDuplicate,
	mapToHolidayFormValues,
} from "./date-holidays-service";

const originalTimezone = process.env.TZ;

afterEach(() => {
	process.env.TZ = originalTimezone;
});

function preview(overrides: Partial<HolidayPreview> = {}): HolidayPreview {
	return {
		date: "2026-03-29 00:00:00",
		endDate: new Date("2026-03-29T22:00:00.000Z"),
		name: "Calendar Holiday",
		startDate: new Date("2026-03-28T23:00:00.000Z"),
		type: "public",
		...overrides,
	};
}

describe.each([
	"UTC",
	"America/Los_Angeles",
	"Asia/Tokyo",
])("date-holidays calendar semantics in %s", (timezone) => {
	it("uses the holiday date key for yearly recurrence", () => {
		process.env.TZ = timezone;

		const result = mapToHolidayFormValues(preview(), "category-1");

		expect(JSON.parse(result.recurrenceRule ?? "{}")).toEqual({
			day: 29,
			month: 3,
		});
	});

	it("detects duplicate month and day independently of the host timezone", () => {
		process.env.TZ = timezone;

		expect(
			isHolidayDuplicate(preview(), [
				{
					name: "Different name",
					recurrenceRule: null,
					startDate: new Date("2020-03-29T00:00:00.000Z"),
				},
			]),
		).toBe(true);
	});
});

describe("mapToHolidayFormValues duration", () => {
	it("uses calendar-day duration across a long DST day", () => {
		const result = mapToHolidayFormValues(
			preview({
				date: "2026-10-25 00:00:00",
				endDate: new Date("2026-10-26T23:00:00.000Z"),
				startDate: new Date("2026-10-24T22:00:00.000Z"),
			}),
			"category-1",
		);

		expect(JSON.parse(result.recurrenceRule ?? "{}")).toEqual({
			day: 25,
			duration: 2,
			month: 10,
		});
	});

	it("rejects a holiday whose end precedes its start", () => {
		expect(() =>
			mapToHolidayFormValues(
				preview({
					endDate: new Date("2026-03-28T22:00:00.000Z"),
				}),
				"category-1",
			),
		).toThrow("Holiday end date must not precede its start date");
	});
});
