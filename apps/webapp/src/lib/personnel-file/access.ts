import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import {
	DOCUMENT_CATEGORIES,
	type DocumentCategory,
	type DocumentVisibility,
	EMPLOYEE_UPLOAD_CATEGORIES,
} from "./document.types";

/**
 * Who may see and manage which employee documents (ADR 0001). One resolver
 * (`resolvePersonnelFileAccess` in access-store.ts) turns an actor into a
 * `PersonnelFileAccess`; every query, page, action and download decides with
 * it, never with roles directly.
 *
 * - A **manage grant** covers an employee scope and a set of document
 *   categories. Owners and admins hold the organization-wide grant for every
 *   category; a personnel file officer grant (#866, `officer-grant.ts`) adds
 *   a scoped one.
 *   Whoever holds a grant sees shared and HR-only documents in it.
 * - The **employee** sees their own shared documents and manages none. They
 *   may upload certificates and other documents into their own file (#867).
 * - **Own file**: no grant covers the actor's own employee record. Owners,
 *   admins and officers see and upload into their own file only as the
 *   employee; another officer or admin manages it (user decision A, #767).
 *
 * Managers, payroll access and expense officer grants confer nothing.
 */

export type EmployeeScope =
	| { kind: "all" }
	/** Named employees plus everyone currently in the named teams (live membership). */
	| { kind: "specific"; employeeIds: readonly string[]; teamIds: readonly string[] };

export interface ManageGrant {
	source: "organization_admin" | "officer_grant";
	scope: EmployeeScope;
	categories: ReadonlySet<DocumentCategory>;
}

export interface PersonnelFileAccess {
	organizationId: string;
	userId: string;
	/** The actor's own employee profile while they still have organization access. */
	selfEmployeeId: string | null;
	grants: readonly ManageGrant[];
}

/** An employee as access decisions see them: identity and current teams. */
export interface EmployeeRef {
	id: string;
	teamIds: readonly string[];
}

export const ORGANIZATION_ADMIN_GRANT: ManageGrant = Object.freeze({
	source: "organization_admin",
	scope: Object.freeze({ kind: "all" }),
	categories: new Set<DocumentCategory>(DOCUMENT_CATEGORIES),
});

export function isEmployeeInScope(scope: EmployeeScope, employee: EmployeeRef): boolean {
	if (scope.kind === "all") return true;
	const teamIds = new Set(scope.teamIds);
	return (
		scope.employeeIds.includes(employee.id) ||
		employee.teamIds.some((teamId) => teamIds.has(teamId))
	);
}

/**
 * The categories of the employee's documents the actor may see and manage.
 * None for the actor's own file: there, owners, admins and officers are just
 * the employee (their HR-only documents are another officer's or admin's).
 */
export function managedCategoriesFor(
	access: PersonnelFileAccess,
	employee: EmployeeRef,
): ReadonlySet<DocumentCategory> {
	const categories = new Set<DocumentCategory>();
	if (isOwnDocument(access, employee.id)) return categories;
	for (const grant of access.grants) {
		if (!isEmployeeInScope(grant.scope, employee)) continue;
		for (const category of grant.categories) categories.add(category);
	}
	return categories;
}

export function canManageDocument(
	access: PersonnelFileAccess,
	employee: EmployeeRef,
	category: DocumentCategory,
): boolean {
	return managedCategoriesFor(access, employee).has(category);
}

export function isOwnDocument(access: PersonnelFileAccess, employeeId: string): boolean {
	return access.selfEmployeeId !== null && access.selfEmployeeId === employeeId;
}

/**
 * Whether the actor may upload a document of the category into the employee's
 * file as that employee (#867): only into their own file, and only the
 * categories in `EMPLOYEE_UPLOAD_CATEGORIES`. Such documents are always shared.
 */
export function canUploadOwnDocument(
	access: PersonnelFileAccess,
	employeeId: string,
	category: DocumentCategory,
): boolean {
	return isOwnDocument(access, employeeId) && EMPLOYEE_UPLOAD_CATEGORIES.includes(category);
}

/** Why an employee may not attach a sick note to an absence (#982, ADR 0002). */
export type SickNoteAttachRefusal = "setting_off" | "not_own" | "not_sick" | "rejected";

/**
 * Whether the actor may upload a sick note to the absence as its employee: only
 * to their own sick-leave absence that is pending or approved, and only while
 * the organization lets employees attach sick notes. This is the one way an
 * employee uploads a sick note; `EMPLOYEE_UPLOAD_CATEGORIES` stays the rule for
 * My documents. Null when allowed. A former employee or a disabled personnel
 * file has no access to begin with.
 */
export function sickNoteAttachRefusal(
	access: PersonnelFileAccess,
	input: {
		employeeSickNoteUpload: boolean;
		absence: {
			employeeId: string;
			/** The absence category's type; sick leave is "sick". */
			categoryType: string;
			status: "pending" | "approved" | "rejected";
		};
	},
): SickNoteAttachRefusal | null {
	if (!input.employeeSickNoteUpload) return "setting_off";
	if (!isOwnDocument(access, input.absence.employeeId)) return "not_own";
	if (input.absence.categoryType !== "sick") return "not_sick";
	if (input.absence.status === "rejected") return "rejected";
	return null;
}

/** How long an employee may delete a sick note they uploaded themselves. */
export const OWN_SICK_NOTE_DELETE_WINDOW_HOURS = 24;

/**
 * Whether the employee may delete their own sick note: one they uploaded
 * themselves and still see (shared), within 24 hours of uploading it (to fix
 * a mistake). After that, only whoever manages the employee's sick notes may.
 */
export function canDeleteOwnSickNote(
	access: PersonnelFileAccess,
	document: {
		employeeId: string;
		category: DocumentCategory;
		visibility: DocumentVisibility;
		uploadedBy: string | null;
		createdAt: Instant;
	},
	now: Instant,
): boolean {
	return (
		isOwnDocument(access, document.employeeId) &&
		document.category === "sick_note" &&
		document.visibility === "shared" &&
		document.uploadedBy === access.userId &&
		compareInstants(now, document.createdAt.add({ hours: OWN_SICK_NOTE_DELETE_WINDOW_HOURS })) < 0
	);
}

export function canViewDocument(
	access: PersonnelFileAccess,
	document: { employee: EmployeeRef; category: DocumentCategory; visibility: DocumentVisibility },
): boolean {
	return (
		canManageDocument(access, document.employee, document.category) ||
		(isOwnDocument(access, document.employee.id) && document.visibility === "shared")
	);
}

/** Whether the actor manages documents of the category for at least one employee. */
export function managesCategory(access: PersonnelFileAccess, category: DocumentCategory): boolean {
	return access.grants.some((grant) => grant.categories.has(category));
}

/** Whether the actor manages any employee documents at all. */
export function managesAnyDocuments(access: PersonnelFileAccess): boolean {
	return access.grants.some((grant) => grant.categories.size > 0);
}
