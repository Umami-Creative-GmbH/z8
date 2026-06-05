import { intersectPayrollScope } from "@/lib/payroll-access/permissions";

type PayrollWorkspaceActorRole = "admin" | "manager" | "employee";

export interface ScopedPayrollEmployeeIdsForAction {
	employeeIds: string[];
	hasScope: boolean;
}

export function resolveScopedPayrollEmployeeIdsForAction(input: {
	role: PayrollWorkspaceActorRole;
	requestedEmployeeIds?: string[];
	allowedEmployeeIds: string[];
}): ScopedPayrollEmployeeIdsForAction {
	const employeeIds = intersectPayrollScope({
		allowedEmployeeIds: input.allowedEmployeeIds,
		requestedEmployeeIds: input.requestedEmployeeIds,
	});

	return { employeeIds, hasScope: employeeIds.length > 0 };
}
