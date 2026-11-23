"use server";

import { ABSENCES_MAX_YEAR, ABSENCES_MIN_YEAR } from "@/lib/absences/absences-url";
import type { AbsenceRequest } from "@/lib/absences/types";
import type { ServerActionResult } from "@/lib/effect/result";
import type {
	AbsenceWithSickNotes,
	StagedSickNoteInput,
} from "@/lib/personnel-file/sick-note-upload";
import { readAbsenceCalendarYear } from "./calendar-year";
import { getCurrentEmployee as getCurrentEmployeeAction } from "./current-employee";
import { cancelAbsenceRequest as cancelAbsenceRequestAction } from "./mutations";
import {
	getAbsenceComparisonPreview as getAbsenceComparisonPreviewAction,
	getAbsencePlanPreview as getAbsencePlanPreviewAction,
} from "./plan-preview";
import {
	getAbsenceEntries as getAbsenceEntriesAction,
	getHolidays as getHolidaysAction,
	getVacationBalance as getVacationBalanceAction,
	getVacationBalanceResult as getVacationBalanceResultAction,
} from "./queries";
import {
	requestAbsenceEffect as requestAbsenceAction,
	requestAbsenceEffect,
} from "./request-absence-effect";
import { requestAbsenceWithSickNotes } from "./request-with-sick-notes";

export { requestAbsenceEffect };

export async function getCurrentEmployee() {
	return getCurrentEmployeeAction();
}

export async function cancelAbsenceRequest(absenceId: string) {
	return cancelAbsenceRequestAction(absenceId);
}

export async function getAbsenceEntries(
	employeeId: string,
	startDate: string,
	endDate: string,
) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return [];
	}

	return getAbsenceEntriesAction(employeeId, startDate, endDate);
}

export async function getHolidays(
	employeeId: string,
	startDate: Date,
	endDate: Date,
) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return [];
	}

	return getHolidaysAction(employeeId, startDate, endDate);
}

export async function getAbsenceCalendarYearData(year: number) {
	if (
		!Number.isInteger(year) ||
		year < ABSENCES_MIN_YEAR ||
		year > ABSENCES_MAX_YEAR
	) {
		return { absences: [], holidays: [] };
	}

	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee) {
		return { absences: [], holidays: [] };
	}

	return readAbsenceCalendarYear(currentEmployee.id, year);
}

export async function getVacationBalance(
	employeeId: string,
	year: number,
	timezone?: string,
) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return null;
	}

	return timezone === undefined
		? getVacationBalanceAction(employeeId, year)
		: getVacationBalanceAction(employeeId, year, timezone);
}

export async function getVacationBalanceResult(
	employeeId: string,
	year: number,
	timezone?: string,
) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return { balance: null, configuration: null, externalContractor: false };
	}
	return getVacationBalanceResultAction(employeeId, year, timezone);
}

export async function getAbsencePlanPreview(
	...args: Parameters<typeof getAbsencePlanPreviewAction>
) {
	return getAbsencePlanPreviewAction(...args);
}

/** One option of a vacation comparison, refused for ineligible categories (#1342). */
export async function getAbsenceComparisonPreview(
	...args: Parameters<typeof getAbsenceComparisonPreviewAction>
) {
	return getAbsenceComparisonPreviewAction(...args);
}

/**
 * Requests an absence for the signed-in employee. Sick notes staged in the
 * request dialog (#983) are attached once the absence exists.
 */
export async function requestAbsence(
	data: AbsenceRequest,
	stagedSickNotes?: readonly StagedSickNoteInput[],
): Promise<ServerActionResult<AbsenceWithSickNotes>> {
	if (stagedSickNotes === undefined) return requestAbsenceAction(data);
	return requestAbsenceWithSickNotes(data, stagedSickNotes);
}
