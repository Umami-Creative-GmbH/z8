import { and, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { employee, employeeManagers, teamPermissions } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { type EmployeeRole, meetsSettingsAccess, type SettingsAccess } from "./settings-access";

/** Whom an organization action's actor manages. */
export type ManagedScope =
	| { readonly organizationWide: true }
	| {
			readonly organizationWide: false;
			/** Their reports by manager link, former reports included: authority, not a roster. */
			readonly employeeIds: ReadonlySet<string>;
			/** The teams whose members or settings they may manage. */
			readonly teamIds: ReadonlySet<string>;
	  };

const managerEmployee = alias(employee, "manager_employee");

/**
 * True for an org admin and for a workforce admin (employee role admin without
 * an org-admin membership; ADR 0002): their reach is the whole organization.
 */
export function reachesWholeOrganization(input: {
	settingsAccess: SettingsAccess;
	employee: { role: EmployeeRole } | null;
}): boolean {
	return (
		meetsSettingsAccess(input.settingsAccess, "orgAdmin") ||
		(input.settingsAccess === "scopedManager" && input.employee?.role === "admin")
	);
}

/**
 * The whole organization for an org admin and for a workforce admin, else the
 * scoped manager's reports and teams.
 */
export function loadManagedScope(input: {
	organizationId: string;
	settingsAccess: SettingsAccess;
	employee: { id: string; role: EmployeeRole } | null;
}) {
	return Effect.gen(function* () {
		if (reachesWholeOrganization(input)) {
			return { organizationWide: true } as ManagedScope;
		}
		const managerId = input.employee?.id;
		if (!managerId || input.settingsAccess !== "scopedManager") {
			return {
				organizationWide: false,
				employeeIds: new Set(),
				teamIds: new Set(),
			} as ManagedScope;
		}
		const dbService = yield* DatabaseService;
		const [reports, teams] = yield* dbService.query("organizationAction.managedScope", () =>
			Promise.all([
				dbService.db
					.select({ id: employee.id })
					.from(employeeManagers)
					.innerJoin(employee, eq(employee.id, employeeManagers.employeeId))
					.innerJoin(managerEmployee, eq(managerEmployee.id, employeeManagers.managerId))
					.where(
						and(
							eq(employeeManagers.managerId, managerId),
							eq(employee.organizationId, input.organizationId),
							eq(managerEmployee.organizationId, input.organizationId),
						),
					),
				dbService.db
					.select({ teamId: teamPermissions.teamId })
					.from(teamPermissions)
					.where(
						and(
							eq(teamPermissions.employeeId, managerId),
							eq(teamPermissions.organizationId, input.organizationId),
							or(
								eq(teamPermissions.canManageTeamMembers, true),
								eq(teamPermissions.canManageTeamSettings, true),
							),
						),
					),
			]),
		);
		return {
			organizationWide: false,
			employeeIds: new Set(reports.map((row) => row.id)),
			teamIds: new Set(teams.flatMap((row) => (row.teamId ? [row.teamId] : []))),
		} as ManagedScope;
	});
}
