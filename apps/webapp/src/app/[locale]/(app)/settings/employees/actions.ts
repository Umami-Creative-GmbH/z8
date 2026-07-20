"use server";

import type { employee } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import type {
	AssignManagers,
	CreateEmployee,
	PersonalInformation,
	UpdateEmployee,
	UpdateEmployeeInvitationDraft,
} from "@/lib/validations/employee";
import type {
	EmployeeDetailRecord,
	EmployeeListParams,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeWithRelations,
	PaginatedEmployeeResponse,
	SelectableEmployee,
} from "./employee-action-types";
import {
	deactivateEmployeeAction,
	reactivateEmployeeAction,
	removeEmployeeAccessAction,
} from "./employee-lifecycle.actions";
import {
	assignManagersAction,
	createEmployeeAction,
	deleteEmployeeInvitationDraftAction,
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

export async function createEmployee(
	data: CreateEmployee,
): Promise<ServerActionResult<typeof employee.$inferSelect>> {
	return createEmployeeAction(data);
}

export async function updateEmployee(
	employeeId: string,
	data: UpdateEmployee,
): Promise<ServerActionResult<void>> {
	return updateEmployeeAction(employeeId, data);
}

export async function deactivateEmployee(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return deactivateEmployeeAction(employeeId);
}

export async function reactivateEmployee(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return reactivateEmployeeAction(employeeId);
}

export async function removeEmployeeAccess(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return removeEmployeeAccessAction(employeeId);
}

export async function updateEmployeeInvitationDraft(
	draftEmployeeId: string,
	data: UpdateEmployeeInvitationDraft,
): Promise<ServerActionResult<void>> {
	return updateEmployeeInvitationDraftAction(draftEmployeeId, data);
}

export async function deleteEmployeeInvitationDraft(
	draftEmployeeId: string,
): Promise<ServerActionResult<void>> {
	return deleteEmployeeInvitationDraftAction(draftEmployeeId);
}

export async function updateOwnProfile(
	data: PersonalInformation,
): Promise<ServerActionResult<void>> {
	return updateOwnProfileAction(data);
}

export async function getEmployee(
	employeeId: string,
): Promise<ServerActionResult<EmployeeDetailRecord>> {
	return getEmployeeAction(employeeId);
}

export async function listEmployees(
	params: EmployeeListParams = {},
): Promise<ServerActionResult<PaginatedEmployeeResponse>> {
	return listEmployeesAction(params);
}

export async function assignManagers(
	employeeId: string,
	data: AssignManagers,
): Promise<ServerActionResult<void>> {
	return assignManagersAction(employeeId, data);
}

export async function requestEmployeeWorkBalanceRecalculation(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return requestEmployeeWorkBalanceRecalculationAction(employeeId);
}

export async function listEmployeesForSelect(
	params: EmployeeSelectParams = {},
): Promise<ServerActionResult<EmployeeSelectResponse>> {
	return listEmployeesForSelectAction(params);
}

export async function getEmployeesByIds(
	employeeIds: string[],
): Promise<ServerActionResult<SelectableEmployee[]>> {
	return getEmployeesByIdsAction(employeeIds);
}
