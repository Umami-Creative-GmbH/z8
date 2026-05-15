import { DateTime } from "luxon";
import { calculateBusinessDaysWithHalfDays } from "./date-utils";
import type { AbsenceDurationKind, DayPeriod, Holiday } from "./types";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AbsenceDurationInput {
	categoryId?: string;
	startDate?: string;
	endDate?: string;
	durationKind?: AbsenceDurationKind;
	startPeriod?: DayPeriod;
	endPeriod?: DayPeriod;
	startTime?: string;
	endTime?: string;
	notes?: string;
}

export interface NormalizedAbsenceDurationInput {
	categoryId: string;
	startDate: string;
	endDate: string;
	durationKind: AbsenceDurationKind;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
	startTime?: string;
	endTime?: string;
	notes?: string;
}

export function normalizeAbsenceDurationInput(
	input: AbsenceDurationInput,
): NormalizedAbsenceDurationInput {
	const startDate = input.startDate?.trim() ?? "";
	const endDate = input.endDate?.trim() || startDate;
	const startPeriod = input.startPeriod ?? "full_day";
	const endPeriod = input.endPeriod ?? "full_day";
	const durationKind = input.durationKind ?? inferDurationKind(startPeriod, endPeriod);

	if (durationKind === "full_day") {
		return {
			categoryId: input.categoryId?.trim() ?? "",
			startDate,
			endDate,
			durationKind,
			startPeriod: "full_day",
			endPeriod: "full_day",
			notes: input.notes,
		};
	}

	return {
		categoryId: input.categoryId?.trim() ?? "",
		startDate,
		endDate,
		durationKind,
		startPeriod: "am",
		endPeriod: "am",
		startTime: input.startTime?.trim() ?? "",
		endTime: input.endTime?.trim() ?? "",
		notes: input.notes,
	};
}

export function validateAbsenceDurationInput(input: AbsenceDurationInput): string | null {
	const normalized = normalizeAbsenceDurationInput(input);

	if (!normalized.categoryId) {
		return "Category is required";
	}

	if (!normalized.startDate) {
		return "Start date is required";
	}

	const start = DateTime.fromISO(normalized.startDate, { zone: "utc" });
	const end = DateTime.fromISO(normalized.endDate, { zone: "utc" });

	if (!start.isValid || !end.isValid) {
		return "Invalid date format";
	}

	if (end < start) {
		return "Start date must be before end date";
	}

	if (normalized.durationKind === "full_day") {
		return null;
	}

	if (!normalized.startTime || !normalized.endTime) {
		return "Enter a start time and end time for a partial-day absence.";
	}

	if (!TIME_PATTERN.test(normalized.startTime) || !TIME_PATTERN.test(normalized.endTime)) {
		return "Enter times in HH:mm format.";
	}

	const startAt = DateTime.fromISO(`${normalized.startDate}T${normalized.startTime}`, { zone: "utc" });
	const endAt = DateTime.fromISO(`${normalized.endDate}T${normalized.endTime}`, { zone: "utc" });

	if (endAt <= startAt) {
		return "Enter an end time after the start time, or choose the next end date for an overnight absence.";
	}

	return null;
}

export function calculateAbsenceDurationDays(
	input: AbsenceDurationInput,
	holidays: Holiday[] = [],
): number {
	const normalized = normalizeAbsenceDurationInput(input);

	if (normalized.durationKind === "partial_day") {
		return 0.5;
	}

	return calculateBusinessDaysWithHalfDays(
		normalized.startDate,
		"full_day",
		normalized.endDate,
		"full_day",
		holidays,
	);
}

export function mapAbsenceDurationToCanonicalTimestamps(input: AbsenceDurationInput): {
	startAt: Date;
	endAt: Date;
} {
	const normalized = normalizeAbsenceDurationInput(input);

	if (normalized.durationKind === "partial_day") {
		return {
			startAt: DateTime.fromISO(`${normalized.startDate}T${normalized.startTime}`, {
				zone: "utc",
			}).toJSDate(),
			endAt: DateTime.fromISO(`${normalized.endDate}T${normalized.endTime}`, {
				zone: "utc",
			}).toJSDate(),
		};
	}

	return {
		startAt: DateTime.fromISO(normalized.startDate, { zone: "utc" }).startOf("day").toJSDate(),
		endAt: DateTime.fromISO(normalized.endDate, { zone: "utc" }).endOf("day").toJSDate(),
	};
}

function inferDurationKind(startPeriod: DayPeriod, endPeriod: DayPeriod): AbsenceDurationKind {
	return startPeriod === "full_day" && endPeriod === "full_day" ? "full_day" : "partial_day";
}
