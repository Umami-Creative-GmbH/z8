"use server";

import {
	getLocationsWithSubareas as getLocationsWithSubareasAction,
	type LocationWithSubareas,
} from "./actions/location-actions";
import {
	deleteShift as deleteShiftAction,
	getIncompleteDays as getIncompleteDaysAction,
	getOpenShifts as getOpenShiftsAction,
	getScheduleComplianceSummary as getScheduleComplianceSummaryAction,
	getShifts as getShiftsAction,
	publishShifts as publishShiftsAction,
	upsertShift as upsertShiftAction,
} from "./actions/shift-actions";
import {
	approveShiftRequest as approveShiftRequestAction,
	cancelShiftRequest as cancelShiftRequestAction,
	getPendingShiftRequests as getPendingShiftRequestsAction,
	rejectShiftRequest as rejectShiftRequestAction,
	requestShiftPickup as requestShiftPickupAction,
	requestShiftSwap as requestShiftSwapAction,
} from "./actions/shift-request-actions";
import {
	createShiftTemplate as createShiftTemplateAction,
	deleteShiftTemplate as deleteShiftTemplateAction,
	getShiftTemplates as getShiftTemplatesAction,
	updateShiftTemplate as updateShiftTemplateAction,
} from "./actions/template-actions";

export type { LocationWithSubareas };

export async function getLocationsWithSubareas() {
	return getLocationsWithSubareasAction();
}

export async function deleteShift(...args: Parameters<typeof deleteShiftAction>) {
	return deleteShiftAction(...args);
}

export async function getIncompleteDays(...args: Parameters<typeof getIncompleteDaysAction>) {
	return getIncompleteDaysAction(...args);
}

export async function getOpenShifts(...args: Parameters<typeof getOpenShiftsAction>) {
	return getOpenShiftsAction(...args);
}

export async function getScheduleComplianceSummary(
	...args: Parameters<typeof getScheduleComplianceSummaryAction>
) {
	return getScheduleComplianceSummaryAction(...args);
}

export async function getShifts(...args: Parameters<typeof getShiftsAction>) {
	return getShiftsAction(...args);
}

export async function publishShifts(...args: Parameters<typeof publishShiftsAction>) {
	return publishShiftsAction(...args);
}

export async function upsertShift(...args: Parameters<typeof upsertShiftAction>) {
	return upsertShiftAction(...args);
}

export async function approveShiftRequest(...args: Parameters<typeof approveShiftRequestAction>) {
	return approveShiftRequestAction(...args);
}

export async function cancelShiftRequest(...args: Parameters<typeof cancelShiftRequestAction>) {
	return cancelShiftRequestAction(...args);
}

export async function getPendingShiftRequests(
	...args: Parameters<typeof getPendingShiftRequestsAction>
) {
	return getPendingShiftRequestsAction(...args);
}

export async function rejectShiftRequest(...args: Parameters<typeof rejectShiftRequestAction>) {
	return rejectShiftRequestAction(...args);
}

export async function requestShiftPickup(...args: Parameters<typeof requestShiftPickupAction>) {
	return requestShiftPickupAction(...args);
}

export async function requestShiftSwap(...args: Parameters<typeof requestShiftSwapAction>) {
	return requestShiftSwapAction(...args);
}

export async function createShiftTemplate(...args: Parameters<typeof createShiftTemplateAction>) {
	return createShiftTemplateAction(...args);
}

export async function deleteShiftTemplate(...args: Parameters<typeof deleteShiftTemplateAction>) {
	return deleteShiftTemplateAction(...args);
}

export async function getShiftTemplates(...args: Parameters<typeof getShiftTemplatesAction>) {
	return getShiftTemplatesAction(...args);
}

export async function updateShiftTemplate(...args: Parameters<typeof updateShiftTemplateAction>) {
	return updateShiftTemplateAction(...args);
}
