import { DateTime } from "luxon";
import { dateRangesOverlap } from "@/lib/absences/date-utils";
import { validateSickDetailForCategory } from "@/lib/absences/sick-details";
import type { AbsenceWithCategory, DayPeriod } from "@/lib/absences/types";
import { mapAbsenceRangeToCanonicalTimestamps } from "../../absences/actions.canonical";
import type {
	ManagerAbsenceListParams,
	ManagerAbsenceRowAbsence,
	RecordAbsenceForEmployeeInput,
} from "./manager-absence-types";

const PAGE_SIZES = [10, 25, 50] as const;

type ApprovedCanonicalAbsenceInput = {
	organizationId: string;
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	countsAgainstVacation: boolean;
	createdBy: string;
};

export function normalizeManagerAbsenceListParams(
	params: Partial<ManagerAbsenceListParams>,
): ManagerAbsenceListParams {
	const pageSize = (PAGE_SIZES as readonly number[]).includes(params.pageSize ?? 0)
		? (params.pageSize as number)
		: 25;

	return {
		search: (params.search ?? "").trim(),
		page: Number.isInteger(params.page) && params.page && params.page > 0 ? params.page : 1,
		pageSize,
		year:
			Number.isInteger(params.year) && params.year && params.year > 1900
				? params.year
				: DateTime.local().year,
	};
}

export function validateRecordAbsenceDateRange(input: {
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
}): string | null {
	const start = DateTime.fromISO(input.startDate);
	const end = DateTime.fromISO(input.endDate);

	if (!start.isValid || !end.isValid) {
		return "Invalid date format";
	}

	if (start > end) {
		return "Start date must be before end date";
	}

	if (input.startDate === input.endDate && input.startPeriod === "pm" && input.endPeriod === "am") {
		return "Cannot end in the morning if starting in the afternoon on the same day";
	}

	return null;
}

export function managerAbsenceAdvisoryLockKey(employeeId: string): string {
	return `manager_absence:${employeeId}`;
}

export function getAbsenceOverlapConflictMessage(status: "pending" | "approved"): string {
	return status === "pending"
		? "Absence request overlaps with an existing pending request"
		: "Absence request overlaps with an existing approved absence";
}

export function validateManagerAbsenceSickDetail(input: {
	categoryType: string;
	sickDetail?: RecordAbsenceForEmployeeInput["sickDetail"] | null;
}): string | null {
	return validateSickDetailForCategory(input);
}

export function buildManagerAbsenceRowAbsences(
	absences: AbsenceWithCategory[],
	year: number,
): ManagerAbsenceRowAbsence[] {
	const yearStart = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;

	return absences
		.filter((absence) => dateRangesOverlap(yearStart, yearEnd, absence.startDate, absence.endDate))
		.map((absence) => ({
			id: absence.id,
			category: {
				name: absence.category.name,
				type: absence.category.type,
				color: absence.category.color,
			},
			sickDetail: absence.category.type === "sick" ? absence.sickDetail : null,
		}));
}

export function buildCanonicalAbsenceRecordValues(input: ApprovedCanonicalAbsenceInput) {
	const { startAt, endAt } = mapAbsenceRangeToCanonicalTimestamps({
		startDate: input.startDate,
		startPeriod: input.startPeriod,
		endDate: input.endDate,
		endPeriod: input.endPeriod,
	});

	return {
		timeRecord: {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			recordKind: "absence" as const,
			startAt,
			endAt,
			durationMinutes: Math.max(0, Math.floor((endAt.getTime() - startAt.getTime()) / 60000)),
			approvalState: "approved" as const,
			origin: "manual" as const,
			createdBy: input.createdBy,
			updatedBy: input.createdBy,
		},
		timeRecordAbsence: {
			organizationId: input.organizationId,
			recordKind: "absence" as const,
			absenceCategoryId: input.categoryId,
			startPeriod: input.startPeriod,
			endPeriod: input.endPeriod,
			countsAgainstVacation: input.countsAgainstVacation,
		},
	};
}
