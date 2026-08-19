import { describe, expect, it } from "vitest";
import {
	getTimeCorrectionDefaultValues,
	getTimeCorrectionEndpointValues,
	hasTimeCorrectionChanges,
	isDirectSameDayEdit,
	isValidClockRange,
} from "./time-correction-dialog-utils";

const workPeriod = {
	id: "work-period-1",
	startTime: new Date("2026-06-04T07:00:00.000Z"),
	endTime: new Date("2026-06-04T15:00:00.000Z"),
	workLocationType: "home",
	workCategoryId: "category-1",
} as const;

describe("getTimeCorrectionDefaultValues", () => {
	it("defaults endpoint dates in the employee timezone across UTC/local boundaries", () => {
		const values = getTimeCorrectionDefaultValues(
			{
				id: "work-period-1",
				startTime: new Date("2026-06-03T22:30:00.000Z"),
				endTime: new Date("2026-06-04T01:15:00.000Z"),
				clockOut: { notes: "Fix missed checkout" },
				workLocationType: "other",
				workCategoryId: "category-1",
			},
			"Europe/Berlin",
		);

		expect(values).toEqual({
			clockInDate: "2026-06-04",
			clockInTime: "00:30",
			clockOutDate: "2026-06-04",
			clockOutTime: "03:15",
			reason: "Fix missed checkout",
			workLocationType: "other",
			workCategoryId: "category-1",
		});
	});

	it.each([
		["field", "remote"],
		[null, "office"],
	] as const)(
		"normalizes historical location %s to %s",
		(workLocationType, expected) => {
			const values = getTimeCorrectionDefaultValues(
				{ ...workPeriod, workLocationType, workCategoryId: null },
				"Europe/Berlin",
			);

			expect(values.workLocationType).toBe(expected);
			expect(values.workCategoryId).toBeNull();
		},
	);

	it("formats exact instants through a DST overlap without losing the explicit zone", () => {
		expect(
			getTimeCorrectionEndpointValues(
				new Date("2026-10-25T00:30:42.123Z"),
				"Europe/Berlin",
			),
		).toEqual({ date: "2026-10-25", time: "02:30" });
		expect(
			getTimeCorrectionEndpointValues(
				new Date("2026-10-25T01:30:42.123Z"),
				"Europe/Berlin",
			),
		).toEqual({ date: "2026-10-25", time: "02:30" });
	});
});

describe("hasTimeCorrectionChanges", () => {
	const unchangedValues = {
		clockInDate: "2026-06-04",
		clockInTime: "09:00",
		clockOutDate: "2026-06-04",
		clockOutTime: "17:00",
		reason: "",
		workLocationType: "home" as const,
		workCategoryId: "category-1",
	};

	it("returns false when endpoint instants and metadata are unchanged", () => {
		expect(
			hasTimeCorrectionChanges({
				workPeriod,
				employeeTimezone: "Europe/Berlin",
				values: unchangedValues,
			}),
		).toBe(false);
	});

	it("ignores hidden endpoint seconds and milliseconds", () => {
		expect(
			hasTimeCorrectionChanges({
				workPeriod: {
					...workPeriod,
					startTime: new Date("2026-06-04T07:00:42.123Z"),
					endTime: new Date("2026-06-04T15:00:42.123Z"),
				},
				employeeTimezone: "Europe/Berlin",
				values: unchangedValues,
			}),
		).toBe(false);
	});

	it.each([
		["metadata-only", { workLocationType: "remote" as const }],
		["timestamp-only", { clockInTime: "09:15" }],
		["mixed", { clockOutTime: "17:15", workLocationType: "office" as const }],
		["category removal", { workCategoryId: null }],
	])("detects a %s change", (_name, changes) => {
		expect(
			hasTimeCorrectionChanges({
				workPeriod,
				employeeTimezone: "Europe/Berlin",
				values: { ...unchangedValues, ...changes },
			}),
		).toBe(true);
	});

	it("compares an optional clock-out with empty endpoint values", () => {
		expect(
			hasTimeCorrectionChanges({
				workPeriod: { ...workPeriod, endTime: null },
				employeeTimezone: "Europe/Berlin",
				values: { ...unchangedValues, clockOutDate: "", clockOutTime: "" },
			}),
		).toBe(false);
	});
});

describe("isValidClockRange", () => {
	it("validates clock ranges using date and time together", () => {
		expect(
			isValidClockRange("2026-06-04", "09:00", "2026-06-04", "17:00"),
		).toBe(true);
		expect(
			isValidClockRange("2026-06-04", "17:00", "2026-06-04", "09:00"),
		).toBe(false);
		expect(
			isValidClockRange("2026-06-04", "22:00", "2026-06-05", "01:00"),
		).toBe(true);
	});
});

describe("isDirectSameDayEdit", () => {
	it("allows direct same-day edits for time-only changes on the original local dates", () => {
		expect(
			isDirectSameDayEdit({
				isSameDay: true,
				workPeriod,
				employeeTimezone: "Europe/Berlin",
				values: {
					clockInDate: "2026-06-04",
					clockInTime: "08:30",
					clockOutDate: "2026-06-04",
					clockOutTime: "17:30",
					reason: "Adjusted times",
					workLocationType: "home",
					workCategoryId: "category-1",
				},
			}),
		).toBe(true);
	});

	it("requires approval when a same-day edit changes endpoint dates", () => {
		expect(
			isDirectSameDayEdit({
				isSameDay: true,
				workPeriod,
				employeeTimezone: "Europe/Berlin",
				values: {
					clockInDate: "2026-06-03",
					clockInTime: "09:00",
					clockOutDate: "2026-06-04",
					clockOutTime: "17:00",
					reason: "Moved start date",
					workLocationType: "home",
					workCategoryId: "category-1",
				},
			}),
		).toBe(false);
		expect(
			isDirectSameDayEdit({
				isSameDay: true,
				workPeriod,
				employeeTimezone: "Europe/Berlin",
				values: {
					clockInDate: "2026-06-04",
					clockInTime: "09:00",
					clockOutDate: "2026-06-05",
					clockOutTime: "17:00",
					reason: "Moved end date",
					workLocationType: "home",
					workCategoryId: "category-1",
				},
			}),
		).toBe(false);
	});
});
