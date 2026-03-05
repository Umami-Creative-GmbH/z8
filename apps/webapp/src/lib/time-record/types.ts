import type { DateTime } from "luxon";

export type TimeRecordKind = "work" | "absence" | "break" | "adjustment";

export interface TimeRecordValidationInput {
	recordKind: TimeRecordKind;
	startAt: DateTime;
	endAt?: DateTime | null;
	durationMinutes?: number | null;
}

export const TIME_RECORD_VALIDATION_MESSAGES = {
	NEGATIVE_DURATION: "Duration cannot be negative",
	INVALID_TIME_WINDOW: "End time must be on or after start time",
	BREAK_END_REQUIRED: "Break records require an end time",
} as const;

export type TimeRecordValidationCode = keyof typeof TIME_RECORD_VALIDATION_MESSAGES;
