import { ValidationError } from "@/lib/effect/errors";
import {
	diffPayrollAccessScope,
	validateId,
	validateIdList,
	validatePayrollAccessScope,
} from "@/lib/payroll-access/grant-scope";
import { ALL_OFFICER_SCOPE, type OfficerScope } from "./officer-scope";

/**
 * Rules of expense officer grants (#747, ADR 0001). The scope has the shape of
 * a payroll access grant (and reuses its checks), plus two capabilities. Unlike
 * payroll access, a grant may name departed employees: their last reports are
 * still owed, and reports keep the scope they had at approval (ADR 0002).
 */

export interface ExpenseOfficerGrantValues {
	scope: "all" | "specific";
	teamIds: string[];
	employeeIds: string[];
	canExport: boolean;
	canRecordReimbursements: boolean;
}

export interface SaveExpenseOfficerGrantInput extends ExpenseOfficerGrantValues {
	officerEmployeeId: string;
}

export interface ExpenseOfficerGrantOwnership {
	/** Active employees of the organization; only they can be officers. */
	activeEmployeeIds: string[];
	/** Every employee of the organization, departed ones included; any of them can be named. */
	organizationEmployeeIds: string[];
	organizationTeamIds: string[];
}

export interface ExpenseOfficerGrantDiff {
	changed: boolean;
	addedTeamIds: string[];
	removedTeamIds: string[];
	addedEmployeeIds: string[];
	removedEmployeeIds: string[];
}

function validateCapability(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw new ValidationError({ message: `${field} must be true or false`, field, value });
	}
	return value;
}

export function buildValidatedExpenseOfficerGrant(
	input: SaveExpenseOfficerGrantInput,
	ownership: ExpenseOfficerGrantOwnership,
): SaveExpenseOfficerGrantInput {
	if (!input || typeof input !== "object") {
		throw new ValidationError({ message: "Expense officer input is required" });
	}
	const officerEmployeeId = validateId(input.officerEmployeeId, "officerEmployeeId");
	const scope = validatePayrollAccessScope(input.scope);
	const teamIds = validateIdList(input.teamIds, "teamIds");
	const employeeIds = validateIdList(input.employeeIds, "employeeIds");
	const canExport = validateCapability(input.canExport, "canExport");
	const canRecordReimbursements = validateCapability(
		input.canRecordReimbursements,
		"canRecordReimbursements",
	);

	if (!ownership.activeEmployeeIds.includes(officerEmployeeId)) {
		throw new ValidationError({
			message: "The expense officer must be an active employee of the organization",
			field: "officerEmployeeId",
			value: officerEmployeeId,
		});
	}
	const teams = new Set(ownership.organizationTeamIds);
	if (teamIds.some((teamId) => !teams.has(teamId))) {
		throw new ValidationError({
			message: "All teams must belong to the active organization",
			field: "teamIds",
		});
	}
	const employees = new Set(ownership.organizationEmployeeIds);
	if (employeeIds.some((employeeId) => !employees.has(employeeId))) {
		throw new ValidationError({
			message: "All employees must belong to the active organization",
			field: "employeeIds",
		});
	}
	const capabilities = { canExport, canRecordReimbursements };
	if (scope === "all") {
		return { officerEmployeeId, scope, teamIds: [], employeeIds: [], ...capabilities };
	}
	if (teamIds.length === 0 && employeeIds.length === 0) {
		throw new ValidationError({
			message: "A specific expense officer scope needs at least one team or employee",
			field: "scope",
			value: scope,
		});
	}
	return { officerEmployeeId, scope, teamIds, employeeIds, ...capabilities };
}

export function diffExpenseOfficerGrant(
	before: ExpenseOfficerGrantValues,
	after: ExpenseOfficerGrantValues,
): ExpenseOfficerGrantDiff {
	const scopeDiff = diffPayrollAccessScope(before, after);
	return {
		...scopeDiff,
		changed:
			scopeDiff.changed ||
			before.canExport !== after.canExport ||
			before.canRecordReimbursements !== after.canRecordReimbursements,
	};
}

function normalize(values: ExpenseOfficerGrantValues): ExpenseOfficerGrantValues {
	return {
		scope: values.scope,
		teamIds: [...new Set(values.teamIds)].toSorted(),
		employeeIds: [...new Set(values.employeeIds)].toSorted(),
		canExport: values.canExport,
		canRecordReimbursements: values.canRecordReimbursements,
	};
}

/** The audit `changes` payload; `null` stands for "no active grant" (create and revoke). */
export function expenseOfficerGrantAuditChanges(
	from: ExpenseOfficerGrantValues | null,
	to: ExpenseOfficerGrantValues | null,
): { from: ExpenseOfficerGrantValues | null; to: ExpenseOfficerGrantValues | null } {
	return { from: from && normalize(from), to: to && normalize(to) };
}

export function officerScopeOf(
	grant: Pick<ExpenseOfficerGrantValues, "scope" | "teamIds" | "employeeIds">,
): OfficerScope {
	return grant.scope === "all"
		? ALL_OFFICER_SCOPE
		: { kind: "specific", teamIds: grant.teamIds, employeeIds: grant.employeeIds };
}
