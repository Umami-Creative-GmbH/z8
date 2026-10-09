import { ValidationError } from "@/lib/effect/errors";
import {
	diffPayrollAccessScope,
	validateId,
	validateIdList,
	validatePayrollAccessScope,
} from "@/lib/payroll-access/grant-scope";
import type { ManageGrant } from "./access";
import { DOCUMENT_CATEGORIES, type DocumentCategory, isDocumentCategory } from "./document.types";

/**
 * Rules of personnel file officer grants (#866, ADR 0001). The scope has the
 * shape of payroll access and expense officer grants (and reuses their
 * checks); the grant also names the document categories it covers. There is
 * no separate view or manage capability: an officer manages everything in
 * scope. Like expense officer grants, a grant may name departed employees, so
 * their personnel file stays manageable.
 */

/**
 * The officer grant's scope kind: all employees, or named employees and
 * teams. Same shape (and check) as payroll access scopes, refused in
 * personnel file terms.
 */
function validatePersonnelFileOfficerScope(value: unknown): "all" | "specific" {
	try {
		return validatePayrollAccessScope(value);
	} catch {
		throw new ValidationError({
			message: "Choose which employees the personnel file officer covers",
			field: "scope",
			value,
		});
	}
}

export interface PersonnelFileOfficerGrantValues {
	scope: "all" | "specific";
	teamIds: string[];
	employeeIds: string[];
	/** Non-empty, in the fixed category order. */
	categories: DocumentCategory[];
}

export interface SavePersonnelFileOfficerGrantInput extends PersonnelFileOfficerGrantValues {
	officerEmployeeId: string;
}

export interface PersonnelFileOfficerGrantOwnership {
	/** Active employees of the organization; only they can be officers. */
	activeEmployeeIds: string[];
	/** Every employee of the organization, departed ones included; any of them can be named. */
	organizationEmployeeIds: string[];
	organizationTeamIds: string[];
}

export interface PersonnelFileOfficerGrantDiff {
	changed: boolean;
	addedTeamIds: string[];
	removedTeamIds: string[];
	addedEmployeeIds: string[];
	removedEmployeeIds: string[];
}

/** A new grant covers every category until the administrator narrows it. */
export const DEFAULT_OFFICER_CATEGORIES: readonly DocumentCategory[] = DOCUMENT_CATEGORIES;

/** The categories in the fixed order, without duplicates. */
export function normalizeCategories(categories: readonly DocumentCategory[]): DocumentCategory[] {
	return DOCUMENT_CATEGORIES.filter((category) => categories.includes(category));
}

function validateCategories(value: unknown): DocumentCategory[] {
	if (value === undefined) return [...DEFAULT_OFFICER_CATEGORIES];
	if (!Array.isArray(value) || !value.every(isDocumentCategory)) {
		throw new ValidationError({
			message: "Document categories must be contract, payslip, certificate, sick note or other",
			field: "categories",
			value,
		});
	}
	if (value.length === 0) {
		throw new ValidationError({
			message: "A personnel file officer needs at least one document category",
			field: "categories",
			value,
		});
	}
	return normalizeCategories(value);
}

export function buildValidatedPersonnelFileOfficerGrant(
	input: SavePersonnelFileOfficerGrantInput,
	ownership: PersonnelFileOfficerGrantOwnership,
): SavePersonnelFileOfficerGrantInput {
	if (!input || typeof input !== "object") {
		throw new ValidationError({ message: "Personnel file officer input is required" });
	}
	const officerEmployeeId = validateId(input.officerEmployeeId, "officerEmployeeId");
	const scope = validatePersonnelFileOfficerScope(input.scope);
	const teamIds = validateIdList(input.teamIds, "teamIds");
	const employeeIds = validateIdList(input.employeeIds, "employeeIds");
	const categories = validateCategories(input.categories);

	if (!ownership.activeEmployeeIds.includes(officerEmployeeId)) {
		throw new ValidationError({
			message: "The personnel file officer must be an active employee of the organization",
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
	if (scope === "all") {
		return { officerEmployeeId, scope, teamIds: [], employeeIds: [], categories };
	}
	if (teamIds.length === 0 && employeeIds.length === 0) {
		throw new ValidationError({
			message: "A specific personnel file officer scope needs at least one team or employee",
			field: "scope",
			value: scope,
		});
	}
	return { officerEmployeeId, scope, teamIds, employeeIds, categories };
}

export function diffPersonnelFileOfficerGrant(
	before: PersonnelFileOfficerGrantValues,
	after: PersonnelFileOfficerGrantValues,
): PersonnelFileOfficerGrantDiff {
	const scopeDiff = diffPayrollAccessScope(before, after);
	const beforeCategories = normalizeCategories(before.categories);
	const afterCategories = normalizeCategories(after.categories);
	return {
		...scopeDiff,
		changed:
			scopeDiff.changed ||
			beforeCategories.length !== afterCategories.length ||
			beforeCategories.some((category, index) => afterCategories[index] !== category),
	};
}

function normalize(values: PersonnelFileOfficerGrantValues): PersonnelFileOfficerGrantValues {
	return {
		scope: values.scope,
		teamIds: [...new Set(values.teamIds)].toSorted(),
		employeeIds: [...new Set(values.employeeIds)].toSorted(),
		categories: normalizeCategories(values.categories),
	};
}

/** The audit `changes` payload; `null` stands for "no active grant" (create and revoke). */
export function personnelFileOfficerGrantAuditChanges(
	from: PersonnelFileOfficerGrantValues | null,
	to: PersonnelFileOfficerGrantValues | null,
): { from: PersonnelFileOfficerGrantValues | null; to: PersonnelFileOfficerGrantValues | null } {
	return { from: from && normalize(from), to: to && normalize(to) };
}

/** The grant as the access resolver sees it. */
export function manageGrantOf(grant: PersonnelFileOfficerGrantValues): ManageGrant {
	return {
		source: "officer_grant",
		scope:
			grant.scope === "all"
				? { kind: "all" }
				: { kind: "specific", teamIds: grant.teamIds, employeeIds: grant.employeeIds },
		categories: new Set(normalizeCategories(grant.categories)),
	};
}
