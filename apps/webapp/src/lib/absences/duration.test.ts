import { describe, expect, it } from "vitest";
import {
	calculateAbsenceDurationDays,
	mapAbsenceDurationToCanonicalTimestamps,
	normalizeAbsenceDurationInput,
	validateAbsenceDurationInput,
} from "./duration";

describe("absence duration helpers", () => {
	it("normalizes an empty end date to the start date", () => {
		expect(
			normalizeAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "",
				durationKind: "full_day",
				notes: "",
			}),
		).toMatchObject({
			startDate: "2026-05-15",
			endDate: "2026-05-15",
			startPeriod: "full_day",
			endPeriod: "full_day",
		});
	});

	it("counts partial-day absences as half a day", () => {
		const normalized = normalizeAbsenceDurationInput({
			categoryId: "category-1",
			startDate: "2026-05-15",
			endDate: "2026-05-15",
			durationKind: "partial_day",
			startTime: "09:00",
			endTime: "13:00",
			notes: "",
		});

		expect(calculateAbsenceDurationDays(normalized)).toBe(0.5);
	});

	it("excludes explicit partial-day absences on holidays", () => {
		const normalized = normalizeAbsenceDurationInput({
			categoryId: "category-1",
			startDate: "2026-05-15",
			endDate: "2026-05-15",
			durationKind: "partial_day",
			startTime: "09:00",
			endTime: "13:00",
			notes: "",
		});

		expect(
			calculateAbsenceDurationDays(normalized, [
				{
					id: "holiday-1",
					name: "Liberation Day",
					startDate: new Date("2026-05-15T00:00:00.000Z"),
					endDate: new Date("2026-05-15T23:59:59.999Z"),
					categoryId: "public",
				},
			]),
		).toBe(0);
	});

	it("excludes explicit partial-day absences on weekends", () => {
		const normalized = normalizeAbsenceDurationInput({
			categoryId: "category-1",
			startDate: "2026-05-16",
			endDate: "2026-05-16",
			durationKind: "partial_day",
			startTime: "09:00",
			endTime: "13:00",
			notes: "",
		});

		expect(calculateAbsenceDurationDays(normalized)).toBe(0);
	});

	it("maps same-day partial-day times to UTC canonical timestamps", () => {
		const mapped = mapAbsenceDurationToCanonicalTimestamps(
			normalizeAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "13:00",
				notes: "",
			}),
		);

		expect(mapped.startAt.toISOString()).toBe("2026-05-15T09:00:00.000Z");
		expect(mapped.endAt.toISOString()).toBe("2026-05-15T13:00:00.000Z");
	});

	it("maps overnight partial-day times across dates", () => {
		const mapped = mapAbsenceDurationToCanonicalTimestamps(
			normalizeAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-16",
				durationKind: "partial_day",
				startTime: "22:00",
				endTime: "02:00",
				notes: "Night shift",
			}),
		);

		expect(mapped.startAt.toISOString()).toBe("2026-05-15T22:00:00.000Z");
		expect(mapped.endAt.toISOString()).toBe("2026-05-16T02:00:00.000Z");
	});

	it("rejects same-day partial-day end times before the start time", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				durationKind: "partial_day",
				startTime: "13:00",
				endTime: "09:00",
				notes: "",
			}),
		).toBe("Enter an end time after the start time, or choose the next end date for an overnight absence.");
	});

	it("rejects partial-day absences without both times", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				durationKind: "partial_day",
				startTime: "09:00",
				endTime: "",
				notes: "",
			}),
		).toBe("Enter a start time and end time for a partial-day absence.");
	});

	it("rejects explicit partial-day absences without any times", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				durationKind: "partial_day",
				notes: "",
			}),
		).toBe("Enter a start time and end time for a partial-day absence.");
	});

	it("calculates legacy multi-day period-only absences with half-day semantics", () => {
		expect(
			calculateAbsenceDurationDays({
				categoryId: "category-1",
				startDate: "2026-05-11",
				startPeriod: "pm",
				endDate: "2026-05-12",
				endPeriod: "am",
				notes: "",
			}),
		).toBe(1);
	});

	it("validates legacy half-day periods without explicit times", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				startPeriod: "pm",
				endPeriod: "pm",
				notes: "",
			}),
		).toBeNull();
	});

	it("rejects same-day legacy pm to am periods", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				startPeriod: "pm",
				endPeriod: "am",
				notes: "",
			}),
		).toBe("Cannot end in the morning if starting in the afternoon on the same day");
	});

	it("maps legacy pm periods without explicit times to noon through end of day", () => {
		const mapped = mapAbsenceDurationToCanonicalTimestamps({
			categoryId: "category-1",
			startDate: "2026-05-15",
			endDate: "2026-05-15",
			startPeriod: "pm",
			endPeriod: "pm",
			notes: "",
		});

		expect(mapped.startAt.toISOString()).toBe("2026-05-15T12:00:00.000Z");
		expect(mapped.endAt.toISOString()).toBe("2026-05-15T23:59:59.999Z");
	});

	it("rejects full ISO timestamp start dates", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15T09:00:00.000Z",
				endDate: "2026-05-15",
				durationKind: "full_day",
				notes: "",
			}),
		).toBe("Invalid date format");
	});

	it("rejects full ISO timestamp end dates", () => {
		expect(
			validateAbsenceDurationInput({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15T13:00:00.000Z",
				durationKind: "full_day",
				notes: "",
			}),
		).toBe("Invalid date format");
	});

	it("throws when mapping invalid date-shaped input", () => {
		expect(() =>
			mapAbsenceDurationToCanonicalTimestamps({
				categoryId: "category-1",
				startDate: "2026-02-31",
				endDate: "2026-02-31",
				durationKind: "full_day",
				notes: "",
			}),
		).toThrow("Invalid date format");
	});

	it("throws when mapping explicit partial-day input with only one time", () => {
		expect(() =>
			mapAbsenceDurationToCanonicalTimestamps({
				categoryId: "category-1",
				startDate: "2026-05-15",
				endDate: "2026-05-15",
				durationKind: "partial_day",
				startTime: "09:00",
				notes: "",
			}),
		).toThrow("Enter a start time and end time for a partial-day absence.");
	});
});
