"use server";

import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";
import {
	cancelEmployeeEmploymentHistoryAction as cancelEmployeeEmploymentHistory,
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
