import { DateTime } from "luxon";
import { dateRangesOverlap, fromJSDate, toDateKey } from "@/lib/datetime/luxon-utils";
import { type AbsenceDaysRefusal, type IsWorkingDay, refusalForAbsenceDays } from "./absence-days";
import type { AffectedShiftEvidence, CoverageEvaluation } from "./coverage-evidence";
import { countRequestedAbsenceDays, normalizeAbsenceDurationInput } from "./duration";
import type { TimeOffInLieuPreview } from "./time-off-in-lieu-preview";
import type { AbsenceRequest, Holiday, VacationBalance } from "./types";

export type {
	CoverageEvaluation,
	CoverageEvidenceGap,
	CoverageRisk,
} from "./coverage-evidence";

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

export interface AbsencePlanPreviewInput {
	category: AbsencePlanCategoryInput;
	request: AbsenceRequest;
	vacationBalance: VacationBalance | null;
	/** The employee's assigned holidays, listed in the preview. */
	holidays: Holiday[];
	/** The employee's working days, which already exclude their holidays. */
	isWorkingDay: IsWorkingDay;
	existingAbsences: ExistingAbsenceInput[];
	/** The requester's own published shifts the absence overlaps (#1341). */
	affectedShifts: AbsencePlanAffectedShiftPreview[];
	/** Published-schedule coverage evidence; colleagues' absences are not considered. */
	coverage: CoverageEvaluation;
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

export interface AbsencePlanBalancePreview {
	year: number;
	remainingDays: number;
	remainingAfterRequest: number;
	countsAgainstVacation: boolean;
}

/** One of the requester's own published shifts, with the part the absence takes. */
export type AbsencePlanAffectedShiftPreview = AffectedShiftEvidence;

export interface AbsencePlanPreview {
	requestedAbsenceDays: number;
	/** Set when the request would be refused on submission. */
	refusal: AbsenceDaysRefusal | null;
	balance: AbsencePlanBalancePreview | null;
	/** Set only for a category that draws on the work balance. */
	workBalance: TimeOffInLieuPreview | null;
	holidays: AbsencePlanHolidayPreview[];
	overlaps: ExistingAbsenceInput[];
	affectedShifts: AbsencePlanAffectedShiftPreview[];
	coverage: CoverageEvaluation;
	warnings: string[];
	reasons: string[];
}

export function buildAbsencePlanPreview(input: AbsencePlanPreviewInput): AbsencePlanPreview {
	const normalizedRequest = normalizeAbsenceDurationInput(input.request);
	const holidays = findHolidaysInRequestRange(normalizedRequest, input.holidays).map((holiday) => ({
		...holiday,
		endDate: fromJSDate(holiday.endDate, "utc").endOf("day").toJSDate(),
	}));
	const requestedAbsenceDays = countRequestedAbsenceDays(normalizedRequest, input.isWorkingDay);
	const refusal = refusalForAbsenceDays({
		countsAgainstVacation: input.category.countsAgainstVacation,
		absenceDays: requestedAbsenceDays,
	});
	const overlaps = findAbsenceOverlaps(normalizedRequest, input.existingAbsences);
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
					(input.category.countsAgainstVacation ? requestedAbsenceDays : 0),
				countsAgainstVacation: input.category.countsAgainstVacation,
			}
		: null;

	// The dialog shows the refusal itself, in the viewer's language.
	if (refusal) {
		hasRisk = true;
	}

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

	// The panel explains coverage from the structured evidence, in the viewer's language (#1341).
	if (input.coverage.risks.length > 0) {
		hasRisk = true;
	}

	if (input.coverage.status === "incomplete") {
		needsReview = true;
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
		balance,
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
		warnings,
		reasons,
	};
}

/** Picks the requester's own shift fields, so no other data reaches the response. */
function normalizeAffectedShifts(
	affectedShifts: readonly AbsencePlanAffectedShiftPreview[],
): AbsencePlanAffectedShiftPreview[] {
	return affectedShifts.map((affectedShift) => ({
		id: affectedShift.id,
		subareaId: affectedShift.subareaId,
		subareaName: affectedShift.subareaName,
		date: affectedShift.date,
		startTime: affectedShift.startTime,
		endTime: affectedShift.endTime,
		affectedStartTime: affectedShift.affectedStartTime,
		affectedEndTime: affectedShift.affectedEndTime,
	}));
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
