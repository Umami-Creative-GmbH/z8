import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { employee, subareaEmployee, teamPermissions } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";

/**
 * The locations and subareas a location settings reader reaches: an org admin
 * the whole organization; a scoped manager whose employee role is manager the
 * subareas they work in, and the locations and subareas the members of the teams
 * whose settings they manage are assigned to. Anyone else reaches none.
 */
export type LocationScope =
	| { readonly organizationWide: true }
	| {
			readonly organizationWide: false;
			readonly locationIds: ReadonlySet<string>;
			readonly subareaIds: ReadonlySet<string>;
	  };

const NO_LOCATIONS: LocationScope = {
	organizationWide: false,
	locationIds: new Set(),
	subareaIds: new Set(),
};

export function loadLocationScope(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		if (meetsSettingsAccess(actor.settingsAccess, "orgAdmin")) {
			return { organizationWide: true } as LocationScope;
		}
		const managerId = actor.employee?.role === "manager" ? actor.employee.id : null;
		if (!managerId) return NO_LOCATIONS;

		const dbService = yield* DatabaseService;
		const [permissions, ownSubareas] = yield* dbService.query("locations.scope", () =>
			Promise.all([
				dbService.db.query.teamPermissions.findMany({
					where: and(
						eq(teamPermissions.employeeId, managerId),
						eq(teamPermissions.organizationId, organizationId),
					),
					columns: { teamId: true, canManageTeamSettings: true },
				}),
				dbService.db.query.subareaEmployee.findMany({
					where: eq(subareaEmployee.employeeId, managerId),
					columns: { subareaId: true },
				}),
			]),
		);
		const teamIds = permissions.flatMap((permission) =>
			permission.canManageTeamSettings && permission.teamId ? [permission.teamId] : [],
		);
		const teamEmployees =
			teamIds.length === 0
				? []
				: yield* dbService.query("locations.scope.teamEmployees", () =>
						dbService.db.query.employee.findMany({
							where: and(
								eq(employee.organizationId, organizationId),
								inArray(employee.teamId, teamIds),
							),
							columns: {},
							with: {
								subareaAssignments: { columns: { subareaId: true } },
								locationAssignments: { columns: { locationId: true } },
							},
						}),
					);

		return {
			organizationWide: false,
			locationIds: new Set(
				teamEmployees.flatMap((row) =>
					(row.locationAssignments ?? []).map((assignment) => assignment.locationId),
				),
			),
			subareaIds: new Set([
				...ownSubareas.map((assignment) => assignment.subareaId),
				...teamEmployees.flatMap((row) =>
					row.subareaAssignments.map((assignment) => assignment.subareaId),
				),
			]),
		} as LocationScope;
	});
}

/** The subareas of `locationId` within the scope: all of them when it reaches the whole location. */
export function subareasInScope<T extends { id: string }>(
	scope: LocationScope,
	locationId: string,
	subareas: T[],
): T[] {
	if (scope.organizationWide || scope.locationIds.has(locationId)) return subareas;
	return subareas.filter((subarea) => scope.subareaIds.has(subarea.id));
}

/** True when the scope reaches the location itself or one of its subareas. */
export function reachesLocation(
	scope: LocationScope,
	locationId: string,
	scopedSubareas: readonly unknown[],
): boolean {
	return scope.organizationWide || scope.locationIds.has(locationId) || scopedSubareas.length > 0;
}
