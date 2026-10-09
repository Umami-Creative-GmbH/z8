import "server-only";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { managedCategoriesFor, type PersonnelFileAccess } from "./access";
import { loadEmployeeRef } from "./access-store";
import { loadCurrentPersonnelFileAccess } from "./current-access";
import {
	DOCUMENT_CATEGORIES,
	type DocumentCategory,
	EMPLOYEE_UPLOAD_CATEGORIES,
} from "./document.types";
import { loadOrganizationDay } from "./organization-day";

/** What the personnel file panel of one employee may offer the current actor. */
export interface PersonnelFilePanelCapability {
	employeeId: string;
	/** The categories the actor manages for this employee, in display order. */
	categories: DocumentCategory[];
	/** Today in the organization's timezone: the default document date. */
	today: string;
}

/**
 * Resolves the panel for one employee's personnel file. Null when the actor
 * manages none of the employee's documents (or personnel files are off), so
 * pages hide the tab instead of guessing from roles.
 */
export async function loadPersonnelFilePanelCapability(
	employeeId: string,
): Promise<PersonnelFilePanelCapability | null> {
	const current = await loadCurrentPersonnelFileAccess();
	if (current.status !== "resolved") return null;
	return personnelFilePanelCapabilityFor(current.access, employeeId);
}

export async function personnelFilePanelCapabilityFor(
	access: PersonnelFileAccess,
	employeeId: string,
): Promise<PersonnelFilePanelCapability | null> {
	const employee = await loadEmployeeRef(db, { organizationId: access.organizationId, employeeId });
	if (!employee) return null;
	const managed = managedCategoriesFor(access, employee);
	if (managed.size === 0) return null;
	const { today } = await loadOrganizationDay(db, {
		organizationId: access.organizationId,
		now: systemClock.nowInstant(),
	});
	return {
		employeeId: employee.id,
		categories: DOCUMENT_CATEGORIES.filter((category) => managed.has(category)),
		today: today.toString(),
	};
}

/**
 * What the employee may upload into their own file from My documents (#867).
 * Null without a current employee profile or while personnel files are off.
 */
export async function loadOwnUploadCapability(): Promise<PersonnelFilePanelCapability | null> {
	const current = await loadCurrentPersonnelFileAccess();
	if (current.status !== "resolved" || !current.access.selfEmployeeId) return null;
	const { today } = await loadOrganizationDay(db, {
		organizationId: current.access.organizationId,
		now: systemClock.nowInstant(),
	});
	return {
		employeeId: current.access.selfEmployeeId,
		categories: [...EMPLOYEE_UPLOAD_CATEGORIES],
		today: today.toString(),
	};
}
