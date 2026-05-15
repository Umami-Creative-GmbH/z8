import { DateTime } from "luxon";
import { calculateBusinessDaysWithHalfDays } from "./date-utils";
import type { AbsenceDurationKind, DayPeriod, Holiday } from "./types";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
	const startTime = input.startTime?.trim() ?? "";
	const endTime = input.endTime?.trim() ?? "";
	const hasTimes = hasExplicitPartialTimes({ ...input, startTime, endTime });

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
		startPeriod: hasTimes ? "am" : startPeriod,
		endPeriod: hasTimes ? "am" : endPeriod,
		startTime,
		endTime,
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

	if (!isDateOnly(normalized.startDate) || !isDateOnly(normalized.endDate)) {
		return "Invalid date format";
	}

	const start = DateTime.fromISO(normalized.startDate, { zone: "utc" });
	const end = DateTime.fromISO(normalized.endDate, { zone: "utc" });

	if (end < start) {
		return "Start date must be before end date";
	}

	if (normalized.durationKind === "full_day") {
		return null;
	}

	if (!hasExplicitPartialTimes(normalized)) {
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

	if (!startAt.isValid || !endAt.isValid) {
		return "Invalid date format";
	}

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

	if (normalized.durationKind === "partial_day" && hasExplicitPartialTimes(normalized)) {
		return {
			startAt: DateTime.fromISO(`${normalized.startDate}T${normalized.startTime}`, {
				zone: "utc",
			}).toJSDate(),
			endAt: DateTime.fromISO(`${normalized.endDate}T${normalized.endTime}`, {
				zone: "utc",
			}).toJSDate(),
		};
	}

	if (normalized.durationKind === "partial_day") {
		const startOfStartDate = DateTime.fromISO(normalized.startDate, { zone: "utc" }).startOf("day");
		const endOfEndDate = DateTime.fromISO(normalized.endDate, { zone: "utc" }).endOf("day");

		return {
			startAt: (normalized.startPeriod === "pm"
				? startOfStartDate.plus({ hours: 12 })
				: startOfStartDate
			).toJSDate(),
			endAt: (normalized.endPeriod === "am"
				? endOfEndDate.minus({ hours: 12 })
				: endOfEndDate
			).toJSDate(),
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

function hasExplicitPartialTimes(input: Pick<AbsenceDurationInput, "durationKind" | "startTime" | "endTime">): boolean {
	return input.durationKind === "partial_day" && (!!input.startTime || !!input.endTime);
}

function isDateOnly(value: string): boolean {
	return DATE_ONLY_PATTERN.test(value) && DateTime.fromISO(value, { zone: "utc" }).isValid;
}
