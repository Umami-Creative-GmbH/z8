import { type AppAbility, asAppSubject } from "@/lib/authorization";
import type { HistoricalWorkViewerAccess } from "./historical-work-diagnostics";

/** Subject-scoped: a manager's TimeEntry grant covers direct reports only. */
export function canManageEntriesOf(
	ability: AppAbility | null,
	employeeId: string,
	organizationId: string,
): boolean {
	return Boolean(ability?.can("manage", asAppSubject("TimeEntry", { employeeId, organizationId })));
}

/**
 * Who receives record-level diagnostics (#324, #319). Every role self-manages its
 * own time entries, so that alone does not make an operator: record-level access
 * needs management of another employee's entries, or organization administration,
 * which also covers the viewer's own history and organization-level work.
 */
export function historicalWorkViewerAccess(
	ability: AppAbility | null,
	viewer: { organizationId: string; employeeId: string },
): HistoricalWorkViewerAccess {
	const organizationWide = Boolean(ability?.can("manage", "OrgSettings"));
	return {
		organizationWide,
		canDiagnose: (employeeId) =>
			organizationWide ||
			(employeeId !== viewer.employeeId &&
				canManageEntriesOf(ability, employeeId, viewer.organizationId)),
	};
}
