"use server";

import type { ServerActionResult } from "@/lib/effect/result";
import type {
	AssignManagers,
	CreateEmployee,
	PersonalInformation,
	UpdateEmployee,
} from "@/lib/validations/employee";
import type {
	EmployeeListParams,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeWithRelations,
	PaginatedEmployeeResponse,
	SelectableEmployee,
} from "./employee-action-types";
import {
	assignManagersAction,
	createEmployeeAction,
	updateEmployeeAction,
	updateOwnProfileAction,
} from "./employee-mutations.actions";
import {
	getEmployeeAction,
	getEmployeesByIdsAction,
	listEmployeesAction,
	listEmployeesForSelectAction,
} from "./employee-queries.actions";

export type {
	EmployeeListParams,
	EmployeeSelectParams,
	EmployeeSelectResponse,
	EmployeeWithRelations,
	PaginatedEmployeeResponse,
	SelectableEmployee,
} from "./employee-action-types";

export async function createEmployee(
	data: CreateEmployee,
): Promise<ServerActionResult<typeof import("@/db/schema").employee.$inferSelect>> {
	return createEmployeeAction(data);
}

export async function updateEmployee(
	employeeId: string,
	data: UpdateEmployee,
): Promise<ServerActionResult<void>> {
	return updateEmployeeAction(employeeId, data);
}

export async function updateOwnProfile(
	data: PersonalInformation,
): Promise<ServerActionResult<void>> {
	return updateOwnProfileAction(data);
}

export async function getEmployee(
	employeeId: string,
): Promise<ServerActionResult<EmployeeWithRelations>> {
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
