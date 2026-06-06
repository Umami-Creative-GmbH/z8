import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";

export interface SavePayrollAccessInput {
	payrollEmployeeId: string;
	scope: "all" | "specific";
	teamIds: string[];
	employeeIds: string[];
}

export interface PayrollOfficerSettingsContextInput {
	userId?: string;
	employeeOrganizationId: string | null;
	activeOrganizationId: string | null;
	canManagePayrollOfficerSettings: boolean;
}

export interface PayrollAccessOwnershipInput {
	activeEmployeeIds: string[];
	organizationTeamIds: string[];
}

export function assertPayrollOfficerSettingsContext(
	context: PayrollOfficerSettingsContextInput,
	action: "read" | "write",
): void {
	if (!context.activeOrganizationId) {
		throw new AuthenticationError({ message: "Authentication required", userId: context.userId });
	}

	if (
		context.employeeOrganizationId !== null &&
		context.employeeOrganizationId !== context.activeOrganizationId
	) {
		throw new AuthorizationError({
			message: "Active organization employee context is required",
			userId: context.userId,
			resource: "PayrollOfficerSettings",
			action,
		});
	}

	if (!context.canManagePayrollOfficerSettings) {
		throw new AuthorizationError({
			message: "Payroll officer settings access required",
			userId: context.userId,
			resource: "PayrollOfficerSettings",
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
	const scope = validatePayrollAccessScope(input.scope);
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

	if (scope === "all") {
		return { payrollEmployeeId, scope, teamIds: [], employeeIds: [] };
	}

	if (teamIds.length === 0 && employeeIds.length === 0) {
		throw new ValidationError({
			message: "Specific payroll access requires at least one team or employee",
			field: "scope",
			value: scope,
		});
	}

	return { payrollEmployeeId, scope, teamIds, employeeIds };
}

export function validatePayrollAccessScope(value: unknown): "all" | "specific" {
	if (value === "all" || value === "specific") {
		return value;
	}

	throw new ValidationError({ message: "Payroll access scope is required", field: "scope", value });
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
