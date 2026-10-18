/**
 * Comparing vacation date ranges (#1342): the employee's original draft and up to two manually
 * chosen alternatives, each previewed as its own hypothetical request. Comparison is ephemeral
 * client state; it never deducts, reserves or records anything.
 */
import { normalizeAbsenceDurationInput, validateAbsenceDurationInput } from "./duration";
import type { AbsenceDurationKind, AbsenceRequest, DayPeriod } from "./types";

/** At most two alternatives besides the original. */
export const MAX_COMPARISON_ALTERNATIVES = 2;

/** The request fields an option chooses: dates, duration and exact partial-day times. */
export interface ComparisonDates {
	startDate: string;
	endDate: string;
	startPeriod: DayPeriod;
	endPeriod: DayPeriod;
	durationKind: AbsenceDurationKind;
	startTime: string;
	endTime: string;
}

interface StoredComparisonOption extends ComparisonDates {
	id: string;
}

export interface VacationComparison {
	/** The organization and user the comparison belongs to; another context discards it. */
	contextKey: string;
	/** The one category every option shares. */
	categoryId: string;
	/** The draft's dates when comparison opened: the baseline, never edited here. */
	original: StoredComparisonOption;
	alternatives: StoredComparisonOption[];
	nextAlternative: number;
}

export interface ComparisonOption extends ComparisonDates {
	id: string;
	kind: "original" | "alternative";
	/** 0 for the original, 1 and 2 for the alternatives in order. */
	position: number;
}

/** Why an option cannot be evaluated or applied, translated by the viewer. */
export type ComparisonOptionIssue =
	| "start_date_required"
	| "invalid_date"
	| "end_before_start"
	| "times_required"
	| "invalid_time"
	| "partial_day_span"
	| "end_time_before_start"
	| "invalid";

/**
 * Only an active vacation-type category that consumes vacation balance can be compared; the
 * balance flag alone is not enough. Callers deliver active categories only; the server re-checks.
 */
export function isComparisonEligibleCategory(
	category: { type: string; countsAgainstVacation: boolean } | null | undefined,
): boolean {
	return category?.type === "vacation" && category.countsAgainstVacation === true;
}

export function startVacationComparison({
	contextKey,
	categoryId,
	draft,
}: {
	contextKey: string;
	categoryId: string;
	draft: ComparisonDates;
}): VacationComparison {
	return {
		contextKey,
		categoryId,
		original: { id: "original", ...pickDates(draft) },
		alternatives: [],
		nextAlternative: 1,
	};
}

/** Reopening comparison: the original follows the draft as it is now; alternatives stay. */
export function resumeVacationComparison(
	comparison: VacationComparison,
	draft: ComparisonDates,
): VacationComparison {
	return { ...comparison, original: { id: comparison.original.id, ...pickDates(draft) } };
}

/** The original first, then the alternatives in order. */
export function comparisonOptions(comparison: VacationComparison): ComparisonOption[] {
	return [
		{ ...comparison.original, kind: "original", position: 0 },
		...comparison.alternatives.map((alternative, index) => ({
			...alternative,
			kind: "alternative" as const,
			position: index + 1,
		})),
	];
}

export function canAddComparisonAlternative(comparison: VacationComparison): boolean {
	return comparison.alternatives.length < MAX_COMPARISON_ALTERNATIVES;
}

/** Adds an alternative without dates; unchanged once the cap is reached. */
export function addComparisonAlternative(comparison: VacationComparison): VacationComparison {
	return withAlternative(comparison, {
		startDate: "",
		endDate: "",
		startPeriod: "full_day",
		endPeriod: "full_day",
		durationKind: "full_day",
		startTime: "",
		endTime: "",
	});
}

/** Copies an option, the original included, as a new alternative; unchanged once the cap is reached. */
export function duplicateComparisonOption(
	comparison: VacationComparison,
	optionId: string,
): VacationComparison {
	const source = [comparison.original, ...comparison.alternatives].find(
		(option) => option.id === optionId,
	);
	return source ? withAlternative(comparison, pickDates(source)) : comparison;
}

export function updateComparisonAlternative(
	comparison: VacationComparison,
	alternativeId: string,
	patch: Partial<ComparisonDates>,
): VacationComparison {
	if (!comparison.alternatives.some((alternative) => alternative.id === alternativeId)) {
		return comparison;
	}
	return {
		...comparison,
		alternatives: comparison.alternatives.map((alternative) =>
			alternative.id === alternativeId
				? { ...alternative, ...pickDates({ ...alternative, ...patch }) }
				: alternative,
		),
	};
}

export function removeComparisonAlternative(
	comparison: VacationComparison,
	alternativeId: string,
): VacationComparison {
	return {
		...comparison,
		alternatives: comparison.alternatives.filter((alternative) => alternative.id !== alternativeId),
	};
}

/** The ordinary request rules decide whether an option is valid; null when it is. */
export function comparisonOptionIssue(option: ComparisonDates): ComparisonOptionIssue | null {
	// The category is shared and checked separately; any id satisfies the ordinary rule here.
	const error = validateAbsenceDurationInput({ ...option, categoryId: "comparison" });
	if (!error) return null;
	return DURATION_ERROR_ISSUES.get(error) ?? "invalid";
}

const DURATION_ERROR_ISSUES = new Map<string, ComparisonOptionIssue>([
	["Start date is required", "start_date_required"],
	["Invalid date format", "invalid_date"],
	["Start date must be before end date", "end_before_start"],
	["Enter a start time and end time for a partial-day absence.", "times_required"],
	["Enter times in HH:mm format.", "invalid_time"],
	["Partial-day absences can only be same-day or overnight.", "partial_day_span"],
	[
		"Enter an end time after the start time, or choose the next end date for an overnight absence.",
		"end_time_before_start",
	],
]);

/** The request the preview evaluates for an option, normalized exactly like the ordinary draft's. */
export function comparisonPreviewRequest(
	categoryId: string,
	option: ComparisonDates,
): AbsenceRequest {
	const normalized = normalizeAbsenceDurationInput({ ...option, categoryId });
	return {
		categoryId: normalized.categoryId,
		startDate: normalized.startDate,
		startPeriod: normalized.startPeriod,
		endDate: normalized.endDate,
		endPeriod: normalized.endPeriod,
		durationKind: normalized.durationKind,
		startTime: normalized.startTime,
		endTime: normalized.endTime,
	};
}

/** The draft fields applying an option sets; category, notes, deputy and the rest stay. */
export function appliedDraftFields(option: ComparisonDates): ComparisonDates {
	return pickDates(option);
}

function withAlternative(
	comparison: VacationComparison,
	dates: ComparisonDates,
): VacationComparison {
	if (!canAddComparisonAlternative(comparison)) return comparison;
	return {
		...comparison,
		alternatives: [
			...comparison.alternatives,
			{ id: `alternative-${comparison.nextAlternative}`, ...dates },
		],
		nextAlternative: comparison.nextAlternative + 1,
	};
}

function pickDates(option: ComparisonDates): ComparisonDates {
	return {
		startDate: option.startDate,
		endDate: option.endDate,
		startPeriod: option.startPeriod,
		endPeriod: option.endPeriod,
		durationKind: option.durationKind,
		startTime: option.startTime,
		endTime: option.endTime,
	};
}
