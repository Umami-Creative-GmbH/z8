"use server";

import { getCurrentEmployee as getCurrentEmployeeAction } from "./current-employee";
import { cancelAbsenceRequest as cancelAbsenceRequestAction } from "./mutations";
import {
	getAbsenceCategories as getAbsenceCategoriesAction,
	getAbsenceEntries as getAbsenceEntriesAction,
	getHolidays as getHolidaysAction,
	getVacationBalance as getVacationBalanceAction,
} from "./queries";
import {
	requestAbsenceEffect,
	requestAbsenceEffect as requestAbsenceAction,
} from "./request-absence-effect";

export { requestAbsenceEffect };

export async function getCurrentEmployee() {
	return getCurrentEmployeeAction();
}

export async function cancelAbsenceRequest(absenceId: string) {
	return cancelAbsenceRequestAction(absenceId);
}

export async function getAbsenceCategories(organizationId: string) {
	return getAbsenceCategoriesAction(organizationId);
}

export async function getAbsenceEntries(
	employeeId: string,
	startDate: string,
	endDate: string,
) {
	return getAbsenceEntriesAction(employeeId, startDate, endDate);
}

export async function getHolidays(
	organizationId: string,
	startDate: Date,
	endDate: Date,
) {
	return getHolidaysAction(organizationId, startDate, endDate);
}

export async function getVacationBalance(employeeId: string, year: number) {
	return getVacationBalanceAction(employeeId, year);
}

export async function requestAbsence(...args: Parameters<typeof requestAbsenceAction>) {
	return requestAbsenceAction(...args);
}
