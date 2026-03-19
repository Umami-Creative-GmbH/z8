import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { employee, subareaEmployee, teamPermissions } from "@/db/schema";
import { getSettingsAccessTierForUser } from "@/lib/auth-helpers";
import { AuthorizationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { type SettingsAccessTier } from "@/lib/settings-access";

interface LocationSettingsActorContext {
	session: {
		user: { id: string; email: string };
		session: { activeOrganizationId: string | null };
	};
	dbService: {
		db: typeof import("@/db").db;
		query: (key: string, fn: () => Promise<unknown>) => Effect.Effect<unknown, unknown, never>;
	};
	organizationId: string;
	accessTier: SettingsAccessTier;
	currentEmployee: typeof employee.$inferSelect | null;
	manageableLocationIds: Set<string> | null;
	manageableSubareaIds: Set<string> | null;
}

export function getLocationSettingsActorContext(options?: { organizationId?: string; queryName?: string }) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = options?.organizationId ?? session.session.activeOrganizationId;

		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You do not have access to location settings",
						userId: session.user.id,
						resource: "location",
						action: "access",
					}),
				),
			);
		}

		const [accessTier, currentEmployee] = yield* _(
			Effect.all([
				Effect.promise(() => getSettingsAccessTierForUser(session.user.id, organizationId)),
				dbService.query(`${options?.queryName ?? "getLocationSettingsActor"}:employee`, async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
					});
				}),
			]),
		);

		if (accessTier === "member") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You do not have access to location settings",
						userId: session.user.id,
						resource: "location",
						action: "access",
					}),
				),
			);
		}

		if (accessTier === "orgAdmin") {
			return {
				session,
				dbService,
				organizationId,
				accessTier,
				currentEmployee,
				manageableLocationIds: null,
				manageableSubareaIds: null,
			};
		}

		if (!currentEmployee || currentEmployee.role !== "manager") {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You do not have access to location settings",
						userId: session.user.id,
						resource: "location",
						action: "access",
					}),
				),
			);
		}

		const [managerTeamPermissions, managerSubareaAssignments] = yield* _(
			Effect.all([
				dbService.query(`${options?.queryName ?? "getLocationSettingsActor"}:teamPermissions`, async () => {
					return await dbService.db.query.teamPermissions.findMany({
						where: and(
							eq(teamPermissions.employeeId, currentEmployee.id),
							eq(teamPermissions.organizationId, organizationId),
						),
						columns: { teamId: true, canManageTeamSettings: true },
					});
				}),
				dbService.query(`${options?.queryName ?? "getLocationSettingsActor"}:subareaAssignments`, async () => {
					return await dbService.db.query.subareaEmployee.findMany({
						where: eq(subareaEmployee.employeeId, currentEmployee.id),
						columns: { subareaId: true },
					});
				}),
			]),
		);

		const manageableTeamIds = managerTeamPermissions
			.filter((permission) => permission.canManageTeamSettings && permission.teamId)
			.map((permission) => permission.teamId as string);

		const teamEmployees =
			manageableTeamIds.length === 0
				? []
				: yield* _(
						dbService.query(`${options?.queryName ?? "getLocationSettingsActor"}:teamEmployees`, async () => {
							return await dbService.db.query.employee.findMany({
								where: and(
									eq(employee.organizationId, organizationId),
									inArray(employee.teamId, manageableTeamIds),
								),
								columns: {},
								with: {
									subareaAssignments: {
										columns: { subareaId: true },
									},
									locationAssignments: {
										columns: { locationId: true },
									},
								},
							});
						}),
				  );

		const teamManagedSubareaIds = teamEmployees.flatMap((teamEmployee) =>
			teamEmployee.subareaAssignments.map((assignment) => assignment.subareaId),
		);
		const teamManagedLocationIds = teamEmployees.flatMap((teamEmployee) =>
			(teamEmployee.locationAssignments ?? []).map((assignment) => assignment.locationId),
		);

		return {
			session,
			dbService,
			organizationId,
			accessTier,
			currentEmployee,
			manageableLocationIds: new Set(teamManagedLocationIds),
			manageableSubareaIds: new Set([
				...managerSubareaAssignments.map((assignment) => assignment.subareaId),
				...teamManagedSubareaIds,
			]),
		};
	});
}

export function requireLocationOrgAdminAccess(
	actor: Pick<LocationSettingsActorContext, "accessTier" | "session">,
	options: { message: string; action: "create" | "update" | "delete" },
) {
	if (actor.accessTier === "orgAdmin") {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: options.message,
			userId: actor.session.user.id,
			resource: "location",
			action: options.action,
		}),
	);
}
