"use server";

import { getCurrentEmployee as getCurrentEmployeeAction } from "./current-employee";
import {
	cancelAbsenceRequest as cancelAbsenceRequestAction,
	cancelAbsenceRequestForEmployee as cancelAbsenceRequestForEmployeeAction,
} from "./mutations";
import { getAbsencePlanPreview as getAbsencePlanPreviewAction } from "./plan-preview";
import {
	getAbsenceCategories as getAbsenceCategoriesAction,
	getAbsenceEntries as getAbsenceEntriesAction,
	getHolidays as getHolidaysAction,
	getVacationBalance as getVacationBalanceAction,
} from "./queries";
import {
	requestAbsenceEffect as requestAbsenceAction,
	requestAbsenceEffect,
	requestAbsenceForEmployeeEffect,
} from "./request-absence-effect";

export { requestAbsenceEffect };

export async function getCurrentEmployee() {
	return getCurrentEmployeeAction();
}

export async function cancelAbsenceRequest(absenceId: string) {
	return cancelAbsenceRequestAction(absenceId);
}

export async function cancelAbsenceRequestForEmployee(
	...args: Parameters<typeof cancelAbsenceRequestForEmployeeAction>
) {
	return cancelAbsenceRequestForEmployeeAction(...args);
}

export async function getAbsenceCategories(organizationId: string) {
	return getAbsenceCategoriesAction(organizationId);
}

export async function getAbsenceEntries(employeeId: string, startDate: string, endDate: string) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return [];
	}

	return getAbsenceEntriesAction(employeeId, startDate, endDate);
}

export async function getHolidays(employeeId: string, startDate: Date, endDate: Date) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return [];
	}

	return getHolidaysAction(employeeId, startDate, endDate);
}

export async function getVacationBalance(
	employeeId: string,
	year: number,
	fiscalYearStartMonth?: number | null,
) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return null;
	}

	return getVacationBalanceAction(employeeId, year, fiscalYearStartMonth);
}

export async function getAbsencePlanPreview(
	...args: Parameters<typeof getAbsencePlanPreviewAction>
) {
	return getAbsencePlanPreviewAction(...args);
}

export async function requestAbsence(...args: Parameters<typeof requestAbsenceAction>) {
	return requestAbsenceAction(...args);
}

export async function requestAbsenceForEmployee(
	...args: Parameters<typeof requestAbsenceForEmployeeEffect>
) {
	return requestAbsenceForEmployeeEffect(...args);
}
