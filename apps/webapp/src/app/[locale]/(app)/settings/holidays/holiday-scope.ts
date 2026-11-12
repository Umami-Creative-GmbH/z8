import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { teamPermissions } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";

export type HolidayScopeAssignment = {
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
};

/** Whom a scoped manager sees holiday assignments for; both null for an org admin. */
export type HolidayScope = {
	managedEmployeeIds: ReadonlySet<string> | null;
	/** Teams whose settings the manager may manage. */
	manageableTeamIds: ReadonlySet<string> | null;
};

export function holidayScopeOf(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		if (scope.organizationWide) {
			return { managedEmployeeIds: null, manageableTeamIds: null } satisfies HolidayScope;
		}

		const dbService = yield* DatabaseService;
		const managerId = actor.employee?.id;
		const teamPermissionRows = managerId
			? yield* dbService.query("holidays.scope.teamPermissions", () =>
					dbService.db.query.teamPermissions.findMany({
						where: and(
							eq(teamPermissions.employeeId, managerId),
							eq(teamPermissions.organizationId, organizationId),
						),
						columns: { teamId: true, canManageTeamSettings: true },
					}),
				)
			: [];

		return {
			managedEmployeeIds: scope.employeeIds,
			manageableTeamIds: new Set(
				teamPermissionRows.flatMap((permission) =>
					permission.canManageTeamSettings && permission.teamId ? [permission.teamId] : [],
				),
			),
		} satisfies HolidayScope;
	});
}

/** The organization-wide assignments plus those of the manager's teams and reports. */
export function filterAssignmentsForManagerHolidayScope<T extends HolidayScopeAssignment>(
	assignments: T[],
	scope: HolidayScope,
) {
	const { manageableTeamIds, managedEmployeeIds } = scope;
	if (!manageableTeamIds || !managedEmployeeIds) {
		return assignments;
	}

	return assignments.filter((assignment) => {
		if (assignment.assignmentType === "organization") {
			return true;
		}

		if (assignment.assignmentType === "team") {
			return assignment.teamId ? manageableTeamIds.has(assignment.teamId) : false;
		}

		return assignment.employeeId ? managedEmployeeIds.has(assignment.employeeId) : false;
	});
}
