import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { teamPermissions } from "@/db/schema";
import type { AnyAppError } from "@/lib/effect/errors";
import {
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
} from "../employees/employee-action-utils";

type DatabaseClient = typeof import("@/db").db;

export type HolidayScopeAssignment = {
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
};

type TeamPermissionRow = {
	teamId: string | null;
	canManageTeamSettings: boolean;
};

export type ScopedHolidaySettingsActor = {
	accessTier: "manager" | "orgAdmin";
	organizationId: string;
	session: { user: { id: string } };
	currentEmployee: { id: string; role: "admin" | "manager" | "employee" } | null;
	dbService: {
		db: DatabaseClient;
		query: <T>(key: string, fn: () => Promise<T>) => Effect.Effect<T, AnyAppError, never>;
	};
};

export type ScopedHolidayAccessContext = {
	actor: ScopedHolidaySettingsActor;
	managedEmployeeIds: Set<string> | null;
	manageableTeamIds: Set<string> | null;
};

export function getScopedHolidayAccessContext(organizationId: string, queryName: string) {
	return Effect.gen(function* (_) {
		const actor = (yield* _(
			getEmployeeSettingsActorContext({ organizationId, queryName }),
		)) as ScopedHolidaySettingsActor;

		if (actor.accessTier === "orgAdmin") {
			return {
				actor,
				managedEmployeeIds: null,
				manageableTeamIds: null,
			} satisfies ScopedHolidayAccessContext;
		}

		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const teamPermissionRows = actor.currentEmployee
			? ((yield* _(
					actor.dbService.query(`${queryName}:teamPermissions`, async () => {
						return await actor.dbService.db.query.teamPermissions.findMany({
							where: and(
								eq(teamPermissions.employeeId, actor.currentEmployee?.id ?? ""),
								eq(teamPermissions.organizationId, organizationId),
							),
							columns: { teamId: true, canManageTeamSettings: true },
						});
					}),
				)) as TeamPermissionRow[])
			: [];

		const manageableTeamIds = new Set(
			teamPermissionRows
				.filter((permission) => permission.canManageTeamSettings && permission.teamId)
				.map((permission) => permission.teamId as string),
		);

		return {
			actor,
			managedEmployeeIds,
			manageableTeamIds,
		} satisfies ScopedHolidayAccessContext;
	});
}

export function filterAssignmentsForManagerHolidayScope<T extends HolidayScopeAssignment>(
	assignments: T[],
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
) {
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
