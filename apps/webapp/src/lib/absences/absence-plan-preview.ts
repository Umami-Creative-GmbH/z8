import { DateTime } from "luxon";
import { dateRangesOverlap, fromJSDate, toDateKey } from "@/lib/datetime/luxon-utils";
import { calculateBusinessDaysWithHalfDays } from "./date-utils";
import type { AbsenceRequest, Holiday, VacationBalance } from "./types";

export type ApprovalSignal = "likely" | "needs_review" | "risky";

export interface AbsencePlanCategoryInput {
	id: string;
	name: string;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
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
	vacationBalance: VacationBalance | null;
	holidays: Holiday[];
	existingAbsences: ExistingAbsenceInput[];
	affectedShifts: unknown[];
	coverage: CoverageEvaluationInput;
	hasManager: boolean;
}

export interface AbsencePlanHolidayPreview {
	id: string;
	name: string;
	startDate: string;
	endDate: string;
}

export interface AbsencePlanBalancePreview {
	year: number;
	remainingDays: number;
	remainingAfterRequest: number;
}

export interface AbsencePlanPreview {
	requestedDays: number;
	balance: AbsencePlanBalancePreview | null;
	holidays: AbsencePlanHolidayPreview[];
	overlaps: ExistingAbsenceInput[];
	coverage: CoverageEvaluationInput;
	approvalSignal: ApprovalSignal;
	warnings: string[];
	reasons: string[];
}

export function buildAbsencePlanPreview(input: AbsencePlanPreviewInput): AbsencePlanPreview {
	const holidays = findHolidaysInRequestRange(input.request, input.holidays);
	const calculationHolidays = holidays.map((holiday) => ({
		...holiday,
		endDate: fromJSDate(holiday.endDate, "utc").endOf("day").toJSDate(),
	}));
	const requestedDays = calculateBusinessDaysWithHalfDays(
		input.request.startDate,
		input.request.startPeriod,
		input.request.endDate,
		input.request.endPeriod,
		calculationHolidays,
	);
	const overlaps = findAbsenceOverlaps(input.request, input.existingAbsences);
	const warnings: string[] = [];
	const reasons: string[] = [];
	let hasRisk = false;
	let needsReview = false;

	const balance = input.vacationBalance
		? {
				year: input.vacationBalance.year,
				remainingDays: input.vacationBalance.remainingDays,
				remainingAfterRequest:
					input.vacationBalance.remainingDays -
					(input.category.countsAgainstVacation ? requestedDays : 0),
			}
		: null;

	if (input.category.countsAgainstVacation && !balance) {
		needsReview = true;
		reasons.push("Vacation balance is unavailable for this year.");
	}

	if (!input.category.countsAgainstVacation) {
		reasons.push("This absence type does not reduce vacation balance.");
	}

	if (balance && input.category.countsAgainstVacation && balance.remainingAfterRequest < 0) {
		hasRisk = true;
		warnings.push("Vacation balance would be negative after this request.");
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
		requestedDays,
		balance,
		holidays: holidays.map((holiday) => ({
			id: holiday.id,
			name: holiday.name,
			startDate: toDateKey(fromJSDate(holiday.startDate, "utc")),
			endDate: toDateKey(fromJSDate(holiday.endDate, "utc")),
		})),
		overlaps,
		coverage: input.coverage,
		approvalSignal: determineApprovalSignal({ hasRisk, needsReview }),
		warnings,
		reasons,
	};
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

function findHolidaysInRequestRange(request: AbsenceRequest, holidays: Holiday[]): Holiday[] {
	const requestStart = DateTime.fromISO(request.startDate, { zone: "utc" });
	const requestEnd = DateTime.fromISO(request.endDate, { zone: "utc" }).endOf("day");

	return holidays.filter((holiday) => {
		const holidayStart = fromJSDate(holiday.startDate, "utc");
		const holidayEnd = fromJSDate(holiday.endDate, "utc");
		return dateRangesOverlap(requestStart, requestEnd, holidayStart, holidayEnd);
	});
}

function findAbsenceOverlaps(
	request: AbsenceRequest,
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
