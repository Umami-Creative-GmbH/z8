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
});
