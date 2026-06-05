import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";

export interface SavePayrollAccessInput {
	payrollEmployeeId: string;
	teamIds: string[];
	employeeIds: string[];
}

export interface PayrollAccessAdminContextInput {
	userId?: string;
	role: "admin" | "manager" | "employee" | null;
	employeeOrganizationId: string | null;
	activeOrganizationId: string | null;
}

export interface PayrollAccessOwnershipInput {
	activeEmployeeIds: string[];
	organizationTeamIds: string[];
}

export function assertPayrollAccessAdminContext(
	context: PayrollAccessAdminContextInput,
	action: "read" | "write",
): void {
	if (!context.activeOrganizationId || !context.employeeOrganizationId) {
		throw new AuthenticationError({ message: "Authentication required", userId: context.userId });
	}

	if (context.role !== "admin") {
		throw new AuthorizationError({
			message: "Admin access required",
			userId: context.userId,
			resource: "payroll_access",
			action,
		});
	}

	if (context.employeeOrganizationId !== context.activeOrganizationId) {
		throw new AuthorizationError({
			message: "Active organization employee context is required",
			userId: context.userId,
			resource: "payroll_access",
			action,
		});
	}
}

export function buildValidatedPayrollAccessInput(
	input: SavePayrollAccessInput,
	ownership: PayrollAccessOwnershipInput,
): SavePayrollAccessInput {
	if (!input || typeof input !== "object") {
		throw new ValidationError({ message: "Payroll access input is required" });
	}

	const payrollEmployeeId = validateId(input.payrollEmployeeId, "payrollEmployeeId");
	const teamIds = validateIdList(input.teamIds, "teamIds");
	const employeeIds = validateIdList(input.employeeIds, "employeeIds");
	const activeEmployeeIds = new Set(ownership.activeEmployeeIds);
	const organizationTeamIds = new Set(ownership.organizationTeamIds);

	if (!activeEmployeeIds.has(payrollEmployeeId)) {
		throw new ValidationError({
			message: "Payroll employee must belong to the active organization",
			field: "payrollEmployeeId",
			value: payrollEmployeeId,
		});
	}

	if (teamIds.some((teamId) => !organizationTeamIds.has(teamId))) {
		throw new ValidationError({
			message: "All teams must belong to the active organization",
			field: "teamIds",
		});
	}

	if (employeeIds.some((employeeId) => !activeEmployeeIds.has(employeeId))) {
		throw new ValidationError({
			message: "All employees must belong to the active organization",
			field: "employeeIds",
		});
	}

	return { payrollEmployeeId, teamIds, employeeIds };
}

export function validateId(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new ValidationError({ message: `${field} is required`, field, value });
	}
	return value.trim();
}

export function validateIdList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new ValidationError({ message: `${field} must be an array`, field, value });
	}

	return [...new Set(value.map((item) => validateId(item, field)))];
}
