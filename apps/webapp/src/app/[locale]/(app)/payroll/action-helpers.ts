import { intersectPayrollScope } from "@/lib/payroll-access/permissions";

type PayrollWorkspaceActorRole = "admin" | "manager" | "employee";

export interface ScopedPayrollEmployeeIdsForAction {
	employeeIds: string[] | undefined;
	hasScope: boolean;
}

export function resolveScopedPayrollEmployeeIdsForAction(input: {
	role: PayrollWorkspaceActorRole;
	requestedEmployeeIds?: string[];
	allowedEmployeeIds: string[];
}): ScopedPayrollEmployeeIdsForAction {
	if (input.role === "admin") {
		return {
			employeeIds: input.requestedEmployeeIds,
			hasScope: input.requestedEmployeeIds === undefined || input.requestedEmployeeIds.length > 0,
		};
	}

	const employeeIds = intersectPayrollScope({
		allowedEmployeeIds: input.allowedEmployeeIds,
		requestedEmployeeIds: input.requestedEmployeeIds,
	});

	return { employeeIds, hasScope: employeeIds.length > 0 };
}
