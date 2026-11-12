"use server";

import {
	cancelEmployeeEmploymentHistoryAction as cancelEmployeeEmploymentHistory,
	changeEmployeeWageAction as changeEmployeeWage,
	confirmEmployeeEmploymentHistoryAction as confirmEmployeeEmploymentHistory,
	createEmployeeEmploymentHistoryAction as createEmployeeEmploymentHistory,
	listEmployeeEmploymentHistoryAction as listEmployeeEmploymentHistory,
} from "./employment-history-actions";

// The employment history actions for client components; each is an `organizationAction`.
export const listEmployeeEmploymentHistoryAction = listEmployeeEmploymentHistory;
export const createEmployeeEmploymentHistoryAction = createEmployeeEmploymentHistory;
export const confirmEmployeeEmploymentHistoryAction = confirmEmployeeEmploymentHistory;
export const cancelEmployeeEmploymentHistoryAction = cancelEmployeeEmploymentHistory;
export const changeEmployeeWageAction = changeEmployeeWage;
