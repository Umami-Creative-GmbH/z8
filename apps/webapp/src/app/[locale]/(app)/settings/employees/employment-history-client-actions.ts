"use server";

import type {
	ChangeHourlyWage,
	UpsertEmploymentHistory,
} from "@/lib/validations/employment-history";
import {
	cancelEmployeeEmploymentHistoryAction as cancelEmployeeEmploymentHistory,
	changeEmployeeWageAction as changeEmployeeWage,
	confirmEmployeeEmploymentHistoryAction as confirmEmployeeEmploymentHistory,
	createEmployeeEmploymentHistoryAction as createEmployeeEmploymentHistory,
	listEmployeeEmploymentHistoryAction as listEmployeeEmploymentHistory,
} from "./employment-history-actions";

export async function listEmployeeEmploymentHistoryAction(employeeId: string) {
	return listEmployeeEmploymentHistory(employeeId);
}

export async function createEmployeeEmploymentHistoryAction(
	employeeId: string,
	data: UpsertEmploymentHistory,
) {
	return createEmployeeEmploymentHistory(employeeId, data);
}

export async function confirmEmployeeEmploymentHistoryAction(
	employeeId: string,
	historyId: string,
) {
	return confirmEmployeeEmploymentHistory(employeeId, historyId);
}

export async function cancelEmployeeEmploymentHistoryAction(employeeId: string, historyId: string) {
	return cancelEmployeeEmploymentHistory(employeeId, historyId);
}

export async function changeEmployeeWageAction(employeeId: string, data: ChangeHourlyWage) {
	return changeEmployeeWage(employeeId, data);
}
