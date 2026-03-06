import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	TIME_RECORD_VALIDATION_MESSAGES,
	type TimeRecordValidationInput,
} from "@/lib/time-record/types";
import {
	TimeRecordValidationError,
	validateTimeRecordInput,
} from "@/lib/time-record/validation";

function createInput(overrides: Partial<TimeRecordValidationInput> = {}): TimeRecordValidationInput {
	return {
		recordKind: "work",
		startAt: DateTime.fromISO("2026-01-10T09:00:00Z"),
		endAt: DateTime.fromISO("2026-01-10T17:00:00Z"),
		durationMinutes: 480,
		...overrides,
	};
}

describe("time-record validation", () => {
	it("accepts a valid time record", () => {
		expect(() => validateTimeRecordInput(createInput())).not.toThrow();
	});

	it("rejects negative durations", () => {
		expect(() => validateTimeRecordInput(createInput({ durationMinutes: -1 }))).toThrowError(
			TIME_RECORD_VALIDATION_MESSAGES.NEGATIVE_DURATION,
		);
	});

	it("rejects non-finite durations", () => {
		expect(() => validateTimeRecordInput(createInput({ durationMinutes: Number.NaN }))).toThrowError(
			TIME_RECORD_VALIDATION_MESSAGES.INVALID_DURATION,
		);
		expect(() => validateTimeRecordInput(createInput({ durationMinutes: Number.POSITIVE_INFINITY }))).toThrowError(
			TIME_RECORD_VALIDATION_MESSAGES.INVALID_DURATION,
		);
		expect(() => validateTimeRecordInput(createInput({ durationMinutes: Number.NEGATIVE_INFINITY }))).toThrowError(
			TIME_RECORD_VALIDATION_MESSAGES.INVALID_DURATION,
		);
	});

	it("rejects invalid time windows where end is before start", () => {
		expect(() =>
			validateTimeRecordInput(
				createInput({
					startAt: DateTime.fromISO("2026-01-10T17:00:00Z"),
					endAt: DateTime.fromISO("2026-01-10T09:00:00Z"),
				}),
			),
		).toThrowError(TIME_RECORD_VALIDATION_MESSAGES.INVALID_TIME_WINDOW);
	});

	it("requires endAt for break records", () => {
		expect(() =>
			validateTimeRecordInput(
				createInput({
					recordKind: "break",
					endAt: null,
				}),
		),
		).toThrowError(TIME_RECORD_VALIDATION_MESSAGES.BREAK_END_REQUIRED);
	});

	it("rejects invalid startAt DateTime", () => {
		expect(() =>
			validateTimeRecordInput(
				createInput({
					startAt: DateTime.fromISO("not-a-date"),
				}),
			),
		).toThrowError(TIME_RECORD_VALIDATION_MESSAGES.INVALID_START_TIME);
	});

	it("rejects invalid endAt DateTime when provided", () => {
		expect(() =>
			validateTimeRecordInput(
				createInput({
					endAt: DateTime.fromISO("not-a-date"),
				}),
			),
		).toThrowError(TIME_RECORD_VALIDATION_MESSAGES.INVALID_END_TIME);
	});

	it("throws typed validation error with a stable code", () => {
		try {
			validateTimeRecordInput(createInput({ durationMinutes: -5 }));
			throw new Error("Expected validateTimeRecordInput to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(TimeRecordValidationError);
			expect((error as TimeRecordValidationError).code).toBe("NEGATIVE_DURATION");
		}
	});
});
