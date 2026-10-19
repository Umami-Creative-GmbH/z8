import { DateTime } from "luxon";
import { countAbsenceDays, type IsWorkingDay } from "./absence-days";
import type { AbsenceDurationKind, DayPeriod } from "./types";

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

export type AbsenceEntryDurationFields = Pick<
	NormalizedAbsenceDurationInput,
	"startDate" | "startPeriod" | "endDate" | "endPeriod"
>;

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
	const isLegacyPeriodOnly = hasLegacyPeriodOnlyIntent({
		...input,
		startPeriod,
		endPeriod,
		startTime,
		endTime,
	});

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
		startPeriod: hasTimes || !isLegacyPeriodOnly ? "am" : startPeriod,
		endPeriod: hasTimes || !isLegacyPeriodOnly ? "am" : endPeriod,
		startTime,
		endTime,
		notes: input.notes,
	};
}

/** Why an absence's dates, duration or partial-day times are invalid; translated by the viewer. */
export type AbsenceDurationIssueCode =
	| "start_date_required"
	| "invalid_date"
	| "end_before_start"
	/** Legacy half days: an afternoon start cannot end that same morning. */
	| "afternoon_start_morning_end"
	| "times_required"
	| "invalid_time"
	| "partial_day_span"
	| "end_time_before_start";

export interface AbsenceDurationIssue {
	code: AbsenceDurationIssueCode;
	/** The English message, for server errors and logs. */
	message: string;
}

const DURATION_ISSUE_MESSAGES: Record<AbsenceDurationIssueCode, string> = {
	start_date_required: "Start date is required",
	invalid_date: "Invalid date format",
	end_before_start: "Start date must be before end date",
	afternoon_start_morning_end:
		"Cannot end in the morning if starting in the afternoon on the same day",
	times_required: "Enter a start time and end time for a partial-day absence.",
	invalid_time: "Enter times in HH:mm format.",
	partial_day_span: "Partial-day absences can only be same-day or overnight.",
	end_time_before_start:
		"Enter an end time after the start time, or choose the next end date for an overnight absence.",
};

/** The request's category, dates, duration and times by the ordinary request rules. */
export function validateAbsenceDurationInput(input: AbsenceDurationInput): string | null {
	if (!input.categoryId?.trim()) {
		return "Category is required";
	}
	return findAbsenceDurationIssue(input)?.message ?? null;
}

/**
 * The ordinary request rules for dates, duration and partial-day times only; the category is not
 * checked. Null when they hold.
 */
export function findAbsenceDurationIssue(input: AbsenceDurationInput): AbsenceDurationIssue | null {
	const code = durationIssueCode(input);
	return code ? { code, message: DURATION_ISSUE_MESSAGES[code] } : null;
}

function durationIssueCode(input: AbsenceDurationInput): AbsenceDurationIssueCode | null {
	const normalized = normalizeAbsenceDurationInput(input);

	if (!normalized.startDate) {
		return "start_date_required";
	}

	if (!isDateOnly(normalized.startDate) || !isDateOnly(normalized.endDate)) {
		return "invalid_date";
	}

	const start = DateTime.fromISO(normalized.startDate, { zone: "utc" });
	const end = DateTime.fromISO(normalized.endDate, { zone: "utc" });

	if (end < start) {
		return "end_before_start";
	}

	if (normalized.durationKind === "full_day") {
		return null;
	}

	if (hasInvalidSameDayLegacyPeriodRange(input, normalized)) {
		return "afternoon_start_morning_end";
	}

	if (hasLegacyPeriodOnlyIntent(input)) {
		return null;
	}

	if (!normalized.startTime || !normalized.endTime) {
		return "times_required";
	}

	if (!TIME_PATTERN.test(normalized.startTime) || !TIME_PATTERN.test(normalized.endTime)) {
		return "invalid_time";
	}

	const dateDeltaDays = end.diff(start, "days").days;
	if (
		hasExplicitPartialTimes(normalized) &&
		(dateDeltaDays > 1 || (dateDeltaDays === 1 && normalized.endTime >= normalized.startTime))
	) {
		return "partial_day_span";
	}

	const startAt = DateTime.fromISO(`${normalized.startDate}T${normalized.startTime}`, {
		zone: "utc",
	});
	const endAt = DateTime.fromISO(`${normalized.endDate}T${normalized.endTime}`, { zone: "utc" });

	if (!startAt.isValid || !endAt.isValid) {
		return "invalid_date";
	}

	if (endAt <= startAt) {
		return "end_time_before_start";
	}

	return null;
}

/** The absence days a requested absence takes; an explicit partial day counts ½ on its start day. */
export function countRequestedAbsenceDays(
	input: AbsenceDurationInput,
	isWorkingDay: IsWorkingDay,
): number {
	return countAbsenceDays(
		toAbsenceEntryDurationFields(normalizeAbsenceDurationInput(input)),
		isWorkingDay,
	);
}

export function toAbsenceEntryDurationFields(
	normalizedInput: NormalizedAbsenceDurationInput,
): AbsenceEntryDurationFields {
	if (normalizedInput.durationKind === "partial_day" && hasExplicitPartialTimes(normalizedInput)) {
		return {
			startDate: normalizedInput.startDate,
			startPeriod: "am",
			endDate: normalizedInput.startDate,
			endPeriod: "am",
		};
	}

	return {
		startDate: normalizedInput.startDate,
		startPeriod: normalizedInput.startPeriod,
		endDate: normalizedInput.endDate,
		endPeriod: normalizedInput.endPeriod,
	};
}

export function mapAbsenceDurationToCanonicalTimestamps(input: AbsenceDurationInput): {
	startAt: Date;
	endAt: Date;
} {
	const validationError = validateAbsenceDurationInput(input);

	if (validationError) {
		throw new Error(validationError);
	}

	const normalized = normalizeAbsenceDurationInput(input);

	if (normalized.durationKind === "partial_day" && hasExplicitPartialTimes(normalized)) {
		const startAt = DateTime.fromISO(`${normalized.startDate}T${normalized.startTime}`, {
			zone: "utc",
		});
		const endAt = DateTime.fromISO(`${normalized.endDate}T${normalized.endTime}`, {
			zone: "utc",
		});

		if (!startAt.isValid || !endAt.isValid) {
			throw new Error("Invalid date format");
		}

		return {
			startAt: startAt.toJSDate(),
			endAt: endAt.toJSDate(),
		};
	}

	if (normalized.durationKind === "partial_day") {
		const startOfStartDate = DateTime.fromISO(normalized.startDate, { zone: "utc" }).startOf("day");
		const endOfEndDate = DateTime.fromISO(normalized.endDate, { zone: "utc" }).endOf("day");

		if (!startOfStartDate.isValid || !endOfEndDate.isValid) {
			throw new Error("Invalid date format");
		}

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

	const startAt = DateTime.fromISO(normalized.startDate, { zone: "utc" }).startOf("day");
	const endAt = DateTime.fromISO(normalized.endDate, { zone: "utc" }).endOf("day");

	if (!startAt.isValid || !endAt.isValid) {
		throw new Error("Invalid date format");
	}

	return {
		startAt: startAt.toJSDate(),
		endAt: endAt.toJSDate(),
	};
}

function inferDurationKind(startPeriod: DayPeriod, endPeriod: DayPeriod): AbsenceDurationKind {
	return startPeriod === "full_day" && endPeriod === "full_day" ? "full_day" : "partial_day";
}

function hasExplicitPartialTimes(
	input: Pick<AbsenceDurationInput, "durationKind" | "startTime" | "endTime">,
): boolean {
	return (
		input.durationKind === "partial_day" && (hasText(input.startTime) || hasText(input.endTime))
	);
}

function hasLegacyPeriodOnlyIntent(input: AbsenceDurationInput): boolean {
	return (
		input.durationKind === undefined &&
		(input.startPeriod === "am" ||
			input.startPeriod === "pm" ||
			input.endPeriod === "am" ||
			input.endPeriod === "pm") &&
		!hasText(input.startTime) &&
		!hasText(input.endTime)
	);
}

function hasInvalidSameDayLegacyPeriodRange(
	input: AbsenceDurationInput,
	normalized: NormalizedAbsenceDurationInput,
): boolean {
	return (
		hasLegacyPeriodOnlyIntent(input) &&
		normalized.startDate === normalized.endDate &&
		normalized.startPeriod === "pm" &&
		normalized.endPeriod === "am"
	);
}

function hasText(value: string | undefined): boolean {
	return !!value?.trim();
}

function isDateOnly(value: string): boolean {
	return DATE_ONLY_PATTERN.test(value) && DateTime.fromISO(value, { zone: "utc" }).isValid;
}
