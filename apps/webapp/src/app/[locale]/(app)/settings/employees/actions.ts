"use server";

import {
	deactivateEmployeeAction,
	previewEmployeeDeactivationAction,
	reactivateEmployeeAction,
	removeEmployeeAccessAction,
} from "./employee-lifecycle.actions";
import {
	cancelEmployeeDepartureAction,
	offboardEmployeeNowAction,
	rehireEmployeeAction,
	scheduleEmployeeDepartureAction,
} from "./employee-offboarding.actions";
import {
	assignManagersAction,
	createEmployeeAction,
	deleteEmployeeInvitationDraftAction,
	previewEmployeeTeamChangeDrivingImpact,
	requestEmployeeWorkBalanceRecalculationAction,
	updateEmployeeAction,
	updateEmployeeInvitationDraftAction,
	updateOwnProfileAction,
} from "./employee-mutations.actions";
import {
	getEmployeeAction,
	getEmployeesByIdsAction,
	listEmployeesAction,
	listEmployeesForSelectAction,
} from "./employee-queries.actions";

export type {
	EmployeeDetailRecord,
	EmployeeListParams,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeWithRelations,
	PaginatedEmployeeResponse,
	SelectableEmployee,
} from "./employee-action-types";

// The employee settings actions under their client names; each is an `organizationAction`.
export const createEmployee = createEmployeeAction;
export const updateEmployee = updateEmployeeAction;
/** The driving licence warning a Team field change confirmed (#1425), read before the save. */
export const previewEmployeeTeamChange = previewEmployeeTeamChangeDrivingImpact;
/** `{ employeeId, requestId, replacementManagers }`; a retry with the same request ID replays. */
export const deactivateEmployee = deactivateEmployeeAction;
/** What Deactivate would change now, for the dialog (#1440). */
export const previewEmployeeDeactivation = previewEmployeeDeactivationAction;
export const reactivateEmployee = reactivateEmployeeAction;
export const scheduleEmployeeDeparture = scheduleEmployeeDepartureAction;
export const cancelEmployeeDeparture = cancelEmployeeDepartureAction;
export const offboardEmployeeNow = offboardEmployeeNowAction;
export const rehireEmployee = rehireEmployeeAction;
export const removeEmployeeAccess = removeEmployeeAccessAction;
export const updateEmployeeInvitationDraft = updateEmployeeInvitationDraftAction;
export const deleteEmployeeInvitationDraft = deleteEmployeeInvitationDraftAction;
export const updateOwnProfile = updateOwnProfileAction;
export const getEmployee = getEmployeeAction;
export const listEmployees = listEmployeesAction;
export const assignManagers = assignManagersAction;
export const requestEmployeeWorkBalanceRecalculation =
	requestEmployeeWorkBalanceRecalculationAction;
export const listEmployeesForSelect = listEmployeesForSelectAction;
export const getEmployeesByIds = getEmployeesByIdsAction;
