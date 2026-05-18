"use server";

import { DateTime } from "luxon";
import { db } from "@/db";
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

export async function getAbsenceCalendarYearData(year: number) {
	if (!Number.isInteger(year) || year < 1900 || year > 2100) {
		return { absences: [], holidays: [] };
	}

	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee) {
		return { absences: [], holidays: [] };
	}

	const org = await db.query.organization.findFirst({
		where: (organization, { eq }) => eq(organization.id, currentEmployee.organizationId),
		columns: { timezone: true },
	});
	const timezone = org?.timezone || "UTC";
	const calendarStart = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: timezone }).startOf(
		"day",
	);
	const calendarEnd = calendarStart.endOf("year");
	const calendarStartDate = calendarStart.toISODate() ?? `${year}-01-01`;
	const calendarEndDate = calendarEnd.toISODate() ?? `${year}-12-31`;

	const [absences, holidays] = await Promise.all([
		getAbsenceEntriesAction(currentEmployee.id, calendarStartDate, calendarEndDate),
		getHolidaysAction(currentEmployee.id, calendarStart.toJSDate(), calendarEnd.toJSDate()),
	]);

	return { absences, holidays };
}

export async function getVacationBalance(employeeId: string, year: number, timezone?: string) {
	const currentEmployee = await getCurrentEmployeeAction();
	if (!currentEmployee || currentEmployee.id !== employeeId) {
		return null;
	}

	return timezone === undefined
		? getVacationBalanceAction(employeeId, year)
		: getVacationBalanceAction(employeeId, year, timezone);
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
