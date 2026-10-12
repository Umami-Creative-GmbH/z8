/**
 * What a viewer may see about an absence's deputy and, as deputy, about the
 * absence (#802, #1012). Being named deputy grants no extra visibility.
 */

import type { EmployeeRole } from "@/lib/validations/employee";

/** An absence's deputy as a viewer sees them. */
export interface DeputyDisplay {
	id: string;
	name: string;
	/** The viewer may open the deputy's profile, so the name is a link. */
	canOpenProfile: boolean;
}

/** The signed-in employee looking at absences. */
export interface DeputyViewer {
	role: EmployeeRole;
	/** The employees the viewer is an eligible manager of. */
	managedEmployeeIds: ReadonlySet<string>;
}

/**
 * The team absence page's rule: admins, and managers of the absent employee,
 * see an absence's category. Everyone else sees only that the person is away.
 * Sick details are never part of what this unlocks.
 */
export function canSeeAbsenceCategory(viewer: DeputyViewer, absentEmployeeId: string): boolean {
	if (viewer.role === "admin") return true;
	return viewer.role === "manager" && viewer.managedEmployeeIds.has(absentEmployeeId);
}

/**
 * Whether the viewer may open an employee's profile (`/settings/employees/<id>`):
 * an organization admin or owner, or a manager of that employee. The profile
 * page enforces the same rule; this only decides whether a name is a link.
 */
export function canOpenEmployeeProfile(input: {
	viewerIsOrganizationAdmin: boolean;
	viewerRole: EmployeeRole;
	managesEmployee: boolean;
}): boolean {
	if (input.viewerIsOrganizationAdmin) return true;
	return input.viewerRole === "manager" && input.managesEmployee;
}
