import { ValidationError } from "@/lib/effect/errors";

/** Who a payroll officer covers: everyone, or the named teams and employees. */
export interface PayrollAccessScope {
	scope: "all" | "specific";
	teamIds: string[];
	employeeIds: string[];
}

export interface SavePayrollAccessInput extends PayrollAccessScope {
	payrollEmployeeId: string;
}

export interface PayrollAccessOwnershipInput {
	activeEmployeeIds: string[];
	organizationTeamIds: string[];
	/**
	 * Employees already named on the officer's active grant. They stay valid after they
	 * leave, so re-saving an unchanged grant never fails on a departure.
	 */
	retainedEmployeeIds?: string[];
}

export interface PayrollAccessScopeDiff {
	changed: boolean;
	addedTeamIds: string[];
	removedTeamIds: string[];
	addedEmployeeIds: string[];
	removedEmployeeIds: string[];
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
	const nameableEmployeeIds = new Set([
		...ownership.activeEmployeeIds,
		...(ownership.retainedEmployeeIds ?? []),
	]);
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

	if (employeeIds.some((employeeId) => !nameableEmployeeIds.has(employeeId))) {
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

export function diffPayrollAccessScope(
	before: PayrollAccessScope,
	after: PayrollAccessScope,
): PayrollAccessScopeDiff {
	const addedTeamIds = difference(after.teamIds, before.teamIds);
	const removedTeamIds = difference(before.teamIds, after.teamIds);
	const addedEmployeeIds = difference(after.employeeIds, before.employeeIds);
	const removedEmployeeIds = difference(before.employeeIds, after.employeeIds);

	return {
		changed:
			before.scope !== after.scope ||
			addedTeamIds.length + removedTeamIds.length > 0 ||
			addedEmployeeIds.length + removedEmployeeIds.length > 0,
		addedTeamIds,
		removedTeamIds,
		addedEmployeeIds,
		removedEmployeeIds,
	};
}

/** The audit `changes` payload; `null` stands for "no active grant" (create and revoke). */
export function payrollAccessGrantAuditChanges(
	from: PayrollAccessScope | null,
	to: PayrollAccessScope | null,
): { from: PayrollAccessScope | null; to: PayrollAccessScope | null } {
	return { from: from && normalizeScope(from), to: to && normalizeScope(to) };
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

function normalizeScope(scope: PayrollAccessScope): PayrollAccessScope {
	return {
		scope: scope.scope,
		teamIds: [...new Set(scope.teamIds)].toSorted(),
		employeeIds: [...new Set(scope.employeeIds)].toSorted(),
	};
}

function difference(values: string[], excluded: string[]): string[] {
	const excludedSet = new Set(excluded);
	return [...new Set(values)].filter((value) => !excludedSet.has(value)).toSorted();
}
