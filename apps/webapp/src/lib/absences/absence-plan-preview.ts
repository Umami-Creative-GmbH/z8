import { DateTime } from "luxon";
import { dateRangesOverlap, fromJSDate, toDateKey } from "@/lib/datetime/luxon-utils";
import { calendarYearAt, parseInstant } from "@/lib/datetime/temporal-core";
import {
	type AbsenceDaysRefusal,
	absenceDaysByYear,
	countAbsenceDays,
	type IsWorkingDay,
	refusalForAbsenceDays,
} from "./absence-days";
import { normalizeAbsenceDurationInput, toAbsenceEntryDurationFields } from "./duration";
import type { TimeOffInLieuPreview } from "./time-off-in-lieu-preview";
import type { AbsenceRequest, Holiday } from "./types";
import {
	overdrawnVacationYears,
	type VacationYearBalanceEvidence,
	type VacationYearImpact,
	vacationYearImpacts,
} from "./vacation-year-balance";

export type ApprovalSignal = "likely" | "needs_review" | "risky";

export interface AbsencePlanCategoryInput {
	id: string;
	name: string;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	/** Time off in lieu (#1000). */
	drawsOnWorkBalance?: boolean;
}

export interface ExistingAbsenceInput {
	id: string;
	startDate: string;
	endDate: string;
	status: "pending" | "approved" | "rejected";
	categoryName: string;
}

export interface CoverageRiskInput {
	date: string;
	subareaId: string;
	subareaName: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
	staffCountAfterAbsence: number;
}

export interface CoverageEvaluationInput {
	risks: CoverageRiskInput[];
	hasConfiguredRulesForAffectedShifts: boolean;
}

export interface AbsencePlanPreviewInput {
	category: AbsencePlanCategoryInput;
	request: AbsenceRequest;
	/**
	 * The recorded vacation balance of each calendar year the request touches; empty for a category
	 * that does not count against vacation.
	 */
	vacationBalances: readonly VacationYearBalanceEvidence[];
	/** When the evidence was read, an ISO instant; the balances are estimates as of then. */
	evaluatedAt: string;
	/** The organization's zone, which decides the evaluation time's calendar year. */
	timezone: string;
	/** The employee's assigned holidays, listed in the preview. */
	holidays: Holiday[];
	/** The employee's working days, which already exclude their holidays. */
	isWorkingDay: IsWorkingDay;
	existingAbsences: ExistingAbsenceInput[];
	affectedShifts: unknown[];
	coverage: CoverageEvaluationInput;
	hasManager: boolean;
	/** The projected work balance, for a category that draws on it. */
	workBalance?: TimeOffInLieuPreview | null;
}

export interface AbsencePlanHolidayPreview {
	id: string;
	name: string;
	startDate: string;
	endDate: string;
}

/** One calendar year's charged absence days and estimated vacation balance after the request. */
export type AbsencePlanBalancePreview = VacationYearImpact;

export interface AbsencePlanAffectedShiftPreview {
	id: string;
	subareaId: string;
	date: string;
	startTime: string;
	endTime: string;
}

export interface AbsencePlanPreview {
	requestedAbsenceDays: number;
	/** Set when the request would be refused on submission. */
	refusal: AbsenceDaysRefusal | null;
	countsAgainstVacation: boolean;
	/** Each calendar year the request touches, ascending; empty when it doesn't count against vacation. */
	balances: AbsencePlanBalancePreview[];
	/** When the evidence was read, an ISO instant. */
	evaluatedAt: string;
	/** Set only for a category that draws on the work balance. */
	workBalance: TimeOffInLieuPreview | null;
	holidays: AbsencePlanHolidayPreview[];
	overlaps: ExistingAbsenceInput[];
	affectedShifts: AbsencePlanAffectedShiftPreview[];
	coverage: CoverageEvaluationInput;
	approvalSignal: ApprovalSignal;
	warnings: string[];
	reasons: string[];
}

export function buildAbsencePlanPreview(input: AbsencePlanPreviewInput): AbsencePlanPreview {
	const normalizedRequest = normalizeAbsenceDurationInput(input.request);
	const holidays = findHolidaysInRequestRange(normalizedRequest, input.holidays).map((holiday) => ({
		...holiday,
		endDate: fromJSDate(holiday.endDate, "utc").endOf("day").toJSDate(),
	}));
	// Counted from the request once normalized: normalizing it again would drop legacy half days.
	const absenceDayRange = toAbsenceEntryDurationFields(normalizedRequest);
	const requestedAbsenceDays = countAbsenceDays(absenceDayRange, input.isWorkingDay);
	const refusal = refusalForAbsenceDays({
		countsAgainstVacation: input.category.countsAgainstVacation,
		absenceDays: requestedAbsenceDays,
	});
	const overlaps = findAbsenceOverlaps(normalizedRequest, input.existingAbsences);
	const warnings: string[] = [];
	const reasons: string[] = [];
	let hasRisk = false;
	let needsReview = false;

	const balances = input.category.countsAgainstVacation
		? vacationYearImpacts({
				charges: absenceDaysByYear(absenceDayRange, input.isWorkingDay),
				evidence: input.vacationBalances,
				currentYear: calendarYearAt(parseInstant(input.evaluatedAt), input.timezone),
			})
		: [];

	// The dialog shows the refusal itself, in the viewer's language.
	if (refusal) {
		hasRisk = true;
	}

	// The panel names each year's balance and its availability in the viewer's language.
	if (balances.some((year) => year.status === "unavailable")) {
		needsReview = true;
	}

	if (!input.category.countsAgainstVacation) {
		reasons.push("This absence type does not reduce vacation balance.");
	}

	if (overdrawnVacationYears(balances).length > 0) {
		hasRisk = true;
	}

	const workBalance = input.category.drawsOnWorkBalance ? (input.workBalance ?? null) : null;
	if (input.category.drawsOnWorkBalance) {
		reasons.push(
			workBalance
				? "This absence draws on the work balance."
				: "Work balance is unavailable right now.",
		);
	}
	if (workBalance?.wouldBeNegative) {
		hasRisk = true;
		warnings.push("Work balance would be negative after this request.");
	}

	for (const overlap of overlaps) {
		hasRisk = true;
		warnings.push(`Request overlaps an existing ${overlap.status} absence.`);
	}

	if (input.coverage.risks.length > 0) {
		hasRisk = true;
		warnings.push("Published coverage would drop below the configured minimum.");
	}

	if (input.affectedShifts.length > 0 && !input.coverage.hasConfiguredRulesForAffectedShifts) {
		needsReview = true;
		reasons.push("Coverage rules are not configured for the affected scheduled work.");
	}

	if (!input.category.requiresApproval) {
		reasons.push("This absence type does not require approval.");
	} else if (!input.hasManager) {
		reasons.push(
			"No manager is assigned, so this request follows the current auto-approval behavior.",
		);
	} else if (!hasRisk && !needsReview) {
		reasons.push("Request follows the normal approval path.");
	}

	return {
		requestedAbsenceDays,
		refusal,
		countsAgainstVacation: input.category.countsAgainstVacation,
		balances,
		evaluatedAt: input.evaluatedAt,
		workBalance,
		holidays: holidays.map((holiday) => ({
			id: holiday.id,
			name: holiday.name,
			startDate: toDateKey(fromJSDate(holiday.startDate, "utc")),
			endDate: toDateKey(fromJSDate(holiday.endDate, "utc")),
		})),
		overlaps,
		affectedShifts: normalizeAffectedShifts(input.affectedShifts),
		coverage: input.coverage,
		approvalSignal: determineApprovalSignal({ hasRisk, needsReview }),
		warnings,
		reasons,
	};
}

function normalizeAffectedShifts(affectedShifts: unknown[]): AbsencePlanAffectedShiftPreview[] {
	return affectedShifts.flatMap((affectedShift) => {
		if (!isAffectedShiftLike(affectedShift)) {
			return [];
		}

		const date = normalizeAffectedShiftDate(affectedShift.date);
		if (!date) {
			return [];
		}

		return [
			{
				id: affectedShift.id,
				subareaId: affectedShift.subareaId,
				date,
				startTime: affectedShift.startTime,
				endTime: affectedShift.endTime,
			},
		];
	});
}

function isAffectedShiftLike(affectedShift: unknown): affectedShift is {
	id: string;
	subareaId: string;
	date: Date | string;
	startTime: string;
	endTime: string;
} {
	return (
		typeof affectedShift === "object" &&
		affectedShift !== null &&
		"id" in affectedShift &&
		"subareaId" in affectedShift &&
		"date" in affectedShift &&
		"startTime" in affectedShift &&
		"endTime" in affectedShift &&
		typeof affectedShift.id === "string" &&
		typeof affectedShift.subareaId === "string" &&
		(typeof affectedShift.date === "string" || affectedShift.date instanceof Date) &&
		typeof affectedShift.startTime === "string" &&
		typeof affectedShift.endTime === "string"
	);
}

function normalizeAffectedShiftDate(date: Date | string): string | null {
	if (date instanceof Date) {
		return toDateKey(fromJSDate(date, "utc"));
	}

	const parsedDate = DateTime.fromISO(date, { zone: "utc" });
	return parsedDate.isValid ? toDateKey(parsedDate) : null;
}

function determineApprovalSignal({
	hasRisk,
	needsReview,
}: {
	hasRisk: boolean;
	needsReview: boolean;
}): ApprovalSignal {
	if (hasRisk) {
		return "risky";
	}

	if (needsReview) {
		return "needs_review";
	}

	return "likely";
}

function findHolidaysInRequestRange(
	request: Pick<AbsenceRequest, "startDate" | "endDate">,
	holidays: Holiday[],
): Holiday[] {
	const requestStart = DateTime.fromISO(request.startDate, { zone: "utc" });
	const requestEnd = DateTime.fromISO(request.endDate, { zone: "utc" }).endOf("day");

	return holidays.filter((holiday) => {
		const holidayStart = fromJSDate(holiday.startDate, "utc");
		const holidayEnd = fromJSDate(holiday.endDate, "utc");
		return dateRangesOverlap(requestStart, requestEnd, holidayStart, holidayEnd);
	});
}

function findAbsenceOverlaps(
	request: Pick<AbsenceRequest, "startDate" | "endDate">,
	existingAbsences: ExistingAbsenceInput[],
): ExistingAbsenceInput[] {
	const requestStart = DateTime.fromISO(request.startDate, { zone: "utc" });
	const requestEnd = DateTime.fromISO(request.endDate, { zone: "utc" }).endOf("day");

	return existingAbsences.filter((absence) => {
		if (absence.status === "rejected") {
			return false;
		}

		return dateRangesOverlap(
			requestStart,
			requestEnd,
			DateTime.fromISO(absence.startDate, { zone: "utc" }),
			DateTime.fromISO(absence.endDate, { zone: "utc" }).endOf("day"),
		);
	});
}
