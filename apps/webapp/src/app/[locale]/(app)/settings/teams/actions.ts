"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import * as z from "zod";
import { user } from "@/db/auth-schema";
import { employee, team, teamMembership, teamPermissions } from "@/db/schema";
import { vacationPolicyWriteFailure } from "@/lib/absences/vacation-policy-assignment-write";
import type { TeamPermissions as ScopedPermissions } from "@/lib/authorization";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { PermissionsService } from "@/lib/effect/services/permissions.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { formerEmployeesAmong } from "@/lib/employee-lifecycle/current-roster-among";
import { formerMark } from "@/lib/employee-lifecycle/former-since";
import { createLogger } from "@/lib/logger";
import { onTeamMemberAdded, onTeamMemberRemoved } from "@/lib/notifications/triggers";
import {
	type DrivingLicenceChangeViewer,
	previewDrivingLicenceIntendedDriverWrite,
	runDrivingLicenceIntendedDriverWrite,
} from "@/lib/organization/driving-licence/no-longer-intended";
import { keepDrivingLicenceStalePreview } from "@/lib/organization/driving-licence/stale-preview";
import { removeTeamMembership } from "@/lib/organization/team-membership-removal";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { buildTeamSettingsSurface, getScopedTeamFlags, type ScopedTeam } from "./team-scope";

const logger = createLogger("TeamActions");

// =============================================================================
// Validation Schemas
// =============================================================================

const teamIdSchema = z.string().min(1, "Team ID is required");
const employeeIdSchema = z.string().min(1, "Employee ID is required");
const previewTokenSchema = z.string().optional();
const teamNameSchema = z.string().min(1, "Team name is required").max(100, "Team name is too long");
const teamDescriptionSchema = z.string().max(500, "Description is too long").optional().nullable();
const primaryManagerIdSchema = z.uuid().nullable().optional();

const createTeamSchema = z.strictObject({
	name: teamNameSchema,
	description: teamDescriptionSchema,
	primaryManagerId: primaryManagerIdSchema,
});

const updateTeamSchema = z.strictObject({
	teamId: teamIdSchema,
	name: teamNameSchema.optional(),
	description: teamDescriptionSchema,
	primaryManagerId: primaryManagerIdSchema,
});

const teamMemberChangeSchema = z.strictObject({
	teamId: teamIdSchema,
	employeeId: employeeIdSchema,
	drivingLicencePreviewToken: previewTokenSchema,
});

const teamMemberChangePreviewSchema = z.strictObject({
	teamId: teamIdSchema,
	employeeId: employeeIdSchema,
	change: z.enum(["add", "remove"], "Invalid team member change"),
});

const deleteTeamSchema = z.strictObject({
	teamId: teamIdSchema,
	drivingLicencePreviewToken: previewTokenSchema,
});

type DatabaseServiceInstance = typeof DatabaseService.Service;
type OrganizationEmployee = typeof employee.$inferSelect;
type OrganizationEmployeeWithUser = OrganizationEmployee & {
	user: typeof user.$inferSelect;
};
type TeamWithMemberRelations = typeof team.$inferSelect & {
	primaryManager: OrganizationEmployeeWithUser | null;
	memberships: Array<
		typeof teamMembership.$inferSelect & {
			employee: OrganizationEmployeeWithUser;
		}
	>;
};

/** The team-scope helpers' tier: an org admin, or a scoped manager. */
function accessTierOf(actor: OrganizationActor): "orgAdmin" | "manager" {
	return meetsSettingsAccess(actor.settingsAccess, "orgAdmin") ? "orgAdmin" : "manager";
}

/** The id team permissions are checked and recorded against: the employee, else the user. */
function actorIdOf(actor: OrganizationActor) {
	return actor.employee?.id ?? actor.userId;
}

function loadScopedPermissions(
	dbService: DatabaseServiceInstance,
	employeeId: string,
	organizationId: string,
): Effect.Effect<ScopedPermissions, AnyAppError> {
	return Effect.gen(function* () {
		const permissionRows = (yield* dbService.query("getScopedTeamPermissions", async () => {
			return await dbService.db.query.teamPermissions.findMany({
				where: and(
					eq(teamPermissions.employeeId, employeeId),
					eq(teamPermissions.organizationId, organizationId),
				),
			});
		})) as Array<typeof teamPermissions.$inferSelect>;

		const permissions: ScopedPermissions = {
			orgWide: null,
			byTeamId: new Map(),
		};

		for (const permissionRow of permissionRows) {
			const flags = {
				canCreateTeams: permissionRow.canCreateTeams,
				canManageTeamMembers: permissionRow.canManageTeamMembers,
				canManageTeamSettings: permissionRow.canManageTeamSettings,
				canApproveTeamRequests: permissionRow.canApproveTeamRequests,
			};

			if (permissionRow.teamId === null) {
				permissions.orgWide = flags;
				continue;
			}

			permissions.byTeamId.set(permissionRow.teamId, flags);
		}

		return permissions;
	}) as Effect.Effect<ScopedPermissions, AnyAppError>;
}

function loadActorScopedPermissions(
	dbService: DatabaseServiceInstance,
	actor: OrganizationActor,
	organizationId: string,
) {
	return actor.employee
		? loadScopedPermissions(dbService, actor.employee.id, organizationId)
		: Effect.succeed<ScopedPermissions>({ orgWide: null, byTeamId: new Map() });
}

function validatePrimaryManager(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	primaryManagerId: string | null | undefined,
) {
	if (!primaryManagerId) {
		return Effect.succeed(undefined);
	}

	return Effect.gen(function* () {
		const manager = yield* dbService.query("getPrimaryManagerCandidate", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, primaryManagerId),
					// A former employee can't become a team's primary manager (#1438).
					onCurrentRoster(organizationId),
				),
			});
		});

		if (!manager || (manager.role !== "manager" && manager.role !== "admin")) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Primary manager must be an active manager or admin in this organization",
					field: "primaryManagerId",
					value: primaryManagerId,
				}),
			);
		}
	});
}

function withMembershipEmployees<
	T extends { memberships?: Array<{ employee: OrganizationEmployeeWithUser }> },
>(teamRecord: T) {
	return {
		...teamRecord,
		employees: teamRecord.memberships?.map((membership) => membership.employee) ?? [],
	};
}

/** The name shown in team notifications for who made the change. */
function actorDisplayName(dbService: DatabaseServiceInstance, actor: OrganizationActor) {
	return dbService
		.query("team.getActorName", async () => {
			return await dbService.db.query.user.findFirst({
				where: eq(user.id, actor.userId),
				columns: { name: true },
			});
		})
		.pipe(Effect.map((record) => record?.name ?? ""));
}

function logFailure(message: string, context: Record<string, unknown>) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.tapError((error) => Effect.sync(() => logger.error({ error, ...context }, message))),
		);
}

// =============================================================================
// Team writes that can change an employee's primary team
// =============================================================================

type TeamWriteTransaction = Parameters<Parameters<typeof withAuthorizationMutation>[1]>[0];

/** Adds the membership; the team becomes the primary team only of an employee without one. */
async function writeTeamMemberAddition(
	tx: TeamWriteTransaction,
	input: {
		organizationId: string;
		teamId: string;
		employeeId: string;
		hadPrimaryTeam: boolean;
		createdBy: string;
	},
) {
	await tx
		.insert(teamMembership)
		.values({
			organizationId: input.organizationId,
			teamId: input.teamId,
			employeeId: input.employeeId,
			createdBy: input.createdBy,
		})
		.onConflictDoNothing();

	// Keep legacy employee.teamId populated only for employees without a compatibility team.
	if (input.hadPrimaryTeam) return;
	await tx
		.update(employee)
		.set({ teamId: input.teamId, updatedAt: currentTimestamp() })
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		);
}

/**
 * Removes the membership; when it was the primary team, the alphabetically first remaining
 * membership (by id) becomes the primary team, else none (shared with the deactivation, #1440).
 */
async function writeTeamMemberRemoval(
	tx: TeamWriteTransaction,
	input: { organizationId: string; teamId: string; employeeId: string },
) {
	await removeTeamMembership(tx, input);
}

/** Deletes a team without memberships; false when it still has members. */
async function writeTeamDeletion(
	tx: TeamWriteTransaction,
	input: { organizationId: string; teamId: string },
) {
	const members = await tx.query.teamMembership.findMany({
		where: and(
			eq(teamMembership.organizationId, input.organizationId),
			eq(teamMembership.teamId, input.teamId),
		),
	});
	if (members.length > 0) return false;
	await tx
		.delete(team)
		.where(and(eq(team.id, input.teamId), eq(team.organizationId, input.organizationId)));
	return true;
}

// =============================================================================
// Shared authorization of team changes (the action and its driving licence preview)
// =============================================================================

/** The team, in the session's organization; another organization's team is not found. */
function loadTeam(dbService: DatabaseServiceInstance, organizationId: string, teamId: string) {
	return dbService
		.query("team.get", async () => {
			return await dbService.db.query.team.findFirst({
				where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
			});
		})
		.pipe(
			Effect.flatMap((t) =>
				t
					? Effect.succeed(t)
					: Effect.fail(
							new NotFoundError({
								message: "Team not found",
								entityType: "team",
								entityId: teamId,
							}),
						),
			),
		);
}

/** An org admin may; a scoped manager needs `permission` on the team. */
function requireTeamPermission(
	actor: OrganizationActor,
	permission: "canManageTeamMembers" | "canManageTeamSettings",
	teamId: string,
	refusal: { message: string; resource: string; action: string },
) {
	return Effect.gen(function* () {
		if (accessTierOf(actor) === "orgAdmin") return;
		const permissionsService = yield* PermissionsService;
		const canManage = yield* permissionsService.hasTeamPermission(
			actorIdOf(actor),
			permission,
			teamId,
		);
		if (!canManage) {
			return yield* Effect.fail(new AuthorizationError({ ...refusal, userId: actorIdOf(actor) }));
		}
	});
}

/**
 * Who may add `employeeId` to or remove them from `teamId`. Both the member actions and their
 * driving licence previews use it, so a preview never reveals more than the change allows.
 * A former employee joining a team is refused by the actions' `addsEmployees` (#1438).
 */
function authorizeTeamMemberChange(
	actor: OrganizationActor,
	organizationId: string,
	teamId: string,
	employeeId: string,
	kind: "add" | "remove",
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const targetTeam = yield* loadTeam(dbService, organizationId, teamId);

		yield* requireTeamPermission(actor, "canManageTeamMembers", teamId, {
			message: "Insufficient permissions to manage team members",
			resource: "team_member",
			action: kind === "add" ? "create" : "delete",
		});

		// The target employee must belong to the team's organization (with user info).
		const targetEmployee = yield* dbService.query("team.getTargetEmployee", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
				with: { user: true },
			});
		});

		if (kind === "add" && !targetEmployee) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee not found in this organization",
					entityType: "employee",
					entityId: employeeId,
				}),
			);
		}

		if (kind === "add" && targetEmployee && accessTierOf(actor) !== "orgAdmin") {
			const scopedPermissions = yield* loadActorScopedPermissions(dbService, actor, organizationId);
			const targetEmployeeMemberships = yield* dbService.query(
				"team.getTargetEmployeeMemberships",
				async () => {
					return await dbService.db.query.teamMembership.findMany({
						where: and(
							eq(teamMembership.organizationId, organizationId),
							eq(teamMembership.employeeId, targetEmployee.id),
						),
					});
				},
			);
			const manageableTeamIds = new Set(
				Array.from(scopedPermissions.byTeamId.entries()).flatMap(([managedTeamId, flags]) =>
					flags.canManageTeamMembers ? [managedTeamId] : [],
				),
			);
			const currentTeamIds = new Set(
				[
					targetEmployee.teamId,
					...targetEmployeeMemberships.map((membership) => membership.teamId),
				].filter((currentTeamId): currentTeamId is string => Boolean(currentTeamId)),
			);

			if (
				!scopedPermissions.orgWide?.canManageTeamMembers &&
				Array.from(currentTeamIds).some((currentTeamId) => !manageableTeamIds.has(currentTeamId))
			) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Cannot move employees from teams outside your scope",
						userId: actorIdOf(actor),
						resource: "team_member",
						action: "create",
					}),
				);
			}
		}

		return { dbService, targetTeam, targetEmployee };
	});
}

/** Who may delete `teamId`; shared by `deleteTeam` and its driving licence preview. */
function authorizeTeamDeletion(actor: OrganizationActor, organizationId: string, teamId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const targetTeam = yield* loadTeam(dbService, organizationId, teamId);
		yield* requireTeamPermission(actor, "canManageTeamSettings", teamId, {
			message: "Insufficient permissions to delete team",
			resource: "team",
			action: "delete",
		});
		return { dbService, targetTeam };
	});
}

/** How much of a driving licence warning the actor may see (owners/admins: names and classes). */
function drivingLicenceViewer(actor: OrganizationActor): DrivingLicenceChangeViewer {
	return { userId: actor.userId, organizationAdmin: accessTierOf(actor) === "orgAdmin" };
}

/** The confirmed driving licence warning a team save takes (#1425). */
export type TeamChangeOptions = { drivingLicencePreviewToken?: string };

/**
 * The warning before adding or removing a team member (#1425): what the actor may see of who
 * would lose which driving authorizations because their primary team changes, and the token
 * the save takes. Read-only; authorized exactly like the change itself.
 */
export const previewTeamMemberChangeDrivingImpact = organizationAction(
	{
		name: "team.previewMemberChangeDrivingImpact",
		requires: "scopedManager",
		schema: teamMemberChangePreviewSchema,
		addsEmployees: (input) => (input.change === "add" ? [input.employeeId] : []),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { teamId, employeeId, change } = input;
			const { dbService, targetEmployee } = yield* authorizeTeamMemberChange(
				actor,
				organizationId,
				teamId,
				employeeId,
				change,
			);
			return yield* dbService.query("team.previewMemberChangeDrivingImpact", () =>
				previewDrivingLicenceIntendedDriverWrite<TeamWriteTransaction>(
					{ organizationId, employeeIds: [employeeId], viewer: drivingLicenceViewer(actor) },
					(work) =>
						withAuthorizationMutation(
							{ organizationId, employeeIds: [employeeId] },
							work,
							dbService.db,
						),
					(tx) =>
						change === "add"
							? writeTeamMemberAddition(tx, {
									organizationId,
									teamId,
									employeeId,
									hadPrimaryTeam: Boolean(targetEmployee?.teamId),
									createdBy: actor.userId,
								})
							: writeTeamMemberRemoval(tx, { organizationId, teamId, employeeId }),
				),
			);
		}),
);

/**
 * The warning before deleting a team (#1425): what the actor may see of who would lose which
 * driving authorizations because the team is their primary team or its intended-driver
 * assignment goes, and the token the save takes. Read-only.
 */
export const previewTeamDeletionDrivingImpact = organizationAction(
	{
		name: "team.previewDeletionDrivingImpact",
		requires: "scopedManager",
		schema: teamIdSchema,
	},
	({ actor, organizationId, input: teamId }) =>
		Effect.gen(function* () {
			const { dbService } = yield* authorizeTeamDeletion(actor, organizationId, teamId);
			return yield* dbService.query("team.previewDeletionDrivingImpact", () =>
				previewDrivingLicenceIntendedDriverWrite<TeamWriteTransaction>(
					{ organizationId, viewer: drivingLicenceViewer(actor) },
					(work) =>
						withAuthorizationMutation(
							{ organizationId, organizationWide: true },
							work,
							dbService.db,
						),
					(tx) => writeTeamDeletion(tx, { organizationId, teamId }),
				),
			);
		}),
);

// =============================================================================
// Team CRUD Actions
// =============================================================================

/** Create a new team; org admins only. */
export const createTeam = organizationAction(
	{
		name: "team.create",
		requires: "orgAdmin",
		schema: createTeamSchema,
		addsEmployees: (input) => [input.primaryManagerId],
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* validatePrimaryManager(dbService, organizationId, input.primaryManagerId);

			// Check for duplicate team name in organization
			const existing = yield* dbService.query("checkDuplicateTeam", async () => {
				return await dbService.db.query.team.findFirst({
					where: and(eq(team.organizationId, organizationId), eq(team.name, input.name)),
				});
			});

			if (existing) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Team with this name already exists in the organization",
						field: "name",
						value: input.name,
					}),
				);
			}

			const [newTeam] = yield* dbService.query("createTeam", async () => {
				return await dbService.db
					.insert(team)
					.values({
						organizationId,
						name: input.name,
						description: input.description || null,
						primaryManagerId: input.primaryManagerId ?? null,
					})
					.returning();
			});

			logger.info(
				{ teamId: newTeam.id, teamName: newTeam.name, organizationId },
				"Team created successfully",
			);

			revalidateTag(CACHE_TAGS.TEAMS(organizationId), "max");
			return newTeam;
		}).pipe(logFailure("Failed to create team", {})),
);

/** Update a team; needs canManageTeamSettings on the team below org admin. */
export const updateTeam = organizationAction(
	{
		name: "team.update",
		requires: "scopedManager",
		schema: updateTeamSchema,
		addsEmployees: (input) => [input.primaryManagerId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { teamId, ...changes } = input;
			const dbService = yield* DatabaseService;
			const targetTeam = yield* loadTeam(dbService, organizationId, teamId);

			yield* requireTeamPermission(actor, "canManageTeamSettings", teamId, {
				message: "Insufficient permissions to manage team settings",
				resource: "team",
				action: "update",
			});

			yield* validatePrimaryManager(dbService, organizationId, changes.primaryManagerId);

			const newName = changes.name;
			if (newName && newName !== targetTeam.name) {
				const existing = yield* dbService.query("checkDuplicateTeam", async () => {
					return await dbService.db.query.team.findFirst({
						where: and(eq(team.organizationId, organizationId), eq(team.name, newName)),
					});
				});

				if (existing) {
					return yield* Effect.fail(
						new ValidationError({
							message: "Team with this name already exists in the organization",
							field: "name",
							value: newName,
						}),
					);
				}
			}

			const updateValues = {
				...(changes.name !== undefined ? { name: changes.name } : {}),
				...(changes.description !== undefined ? { description: changes.description } : {}),
				...(changes.primaryManagerId !== undefined
					? { primaryManagerId: changes.primaryManagerId }
					: {}),
				updatedAt: currentTimestamp(),
			};

			yield* dbService.query("updateTeam", async () => {
				await dbService.db
					.update(team)
					.set(updateValues)
					.where(and(eq(team.id, teamId), eq(team.organizationId, organizationId)));
			});

			const updatedTeam = yield* dbService
				.query("getUpdatedTeam", async () => {
					return await dbService.db.query.team.findFirst({
						where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
					});
				})
				.pipe(
					Effect.flatMap((t) =>
						t
							? Effect.succeed(t)
							: Effect.fail(
									new NotFoundError({
										message: "Updated team not found",
										entityType: "team",
										entityId: teamId,
									}),
								),
					),
				);

			logger.info({ teamId }, "Team updated successfully");
			revalidateTag(CACHE_TAGS.TEAMS(organizationId), "max");
			return updatedTeam;
		}).pipe(logFailure("Failed to update team", { teamId: input.teamId })),
);

/** Delete a team; needs canManageTeamSettings on the team below org admin. */
export const deleteTeam = organizationAction(
	{
		name: "team.delete",
		requires: "scopedManager",
		schema: deleteTeamSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { teamId } = input;
			const { dbService } = yield* authorizeTeamDeletion(actor, organizationId, teamId);

			// Deletion cascades into employee teams and team permissions across the
			// organization, so it takes the organization-wide protection. Clearing a
			// primary team and the team's intended-driver assignment can end driving
			// authorizations (#1425).
			const deletion = { organizationId, teamId };
			const deleted = yield* keepDrivingLicenceStalePreview(
				dbService.query("deleteTeam", () =>
					withAuthorizationMutation(
						{ organizationId, organizationWide: true },
						(tx) =>
							runDrivingLicenceIntendedDriverWrite(
								tx,
								{
									organizationId,
									actorUserId: actor.userId,
									viewer: drivingLicenceViewer(actor),
									previewToken: input.drivingLicencePreviewToken,
								},
								(write) => writeTeamDeletion(write, deletion),
							),
						dbService.db,
					),
				),
			);

			if (!deleted) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Cannot delete team with active members. Please reassign members first.",
						field: "teamId",
						value: teamId,
					}),
				);
			}

			logger.info({ teamId }, "Team deleted successfully");
			revalidateTag(CACHE_TAGS.TEAMS(organizationId), "max");
		}).pipe(logFailure("Failed to delete team", { teamId: input.teamId })),
);

/**
 * Get team details with members. Every member is listed; former employees are
 * marked so the page hides them until "Show former employees" is on (#1438).
 */
export const getTeam = organizationAction(
	{
		name: "team.get",
		requires: "scopedManager",
		schema: teamIdSchema,
	},
	({ actor, organizationId, input: teamId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const targetTeam = yield* dbService
				.query("getTeam", async () => {
					return await dbService.db.query.team.findFirst({
						where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
						with: {
							memberships: {
								with: {
									employee: { with: { user: true } },
								},
							},
							primaryManager: { with: { user: true } },
						},
					});
				})
				.pipe(
					Effect.flatMap((t) =>
						t
							? Effect.succeed(t)
							: Effect.fail(
									new NotFoundError({
										message: "Team not found",
										entityType: "team",
										entityId: teamId,
									}),
								),
					),
				);

			const accessTier = accessTierOf(actor);
			const scopedPermissions = yield* loadActorScopedPermissions(dbService, actor, organizationId);
			const scopedFlags = getScopedTeamFlags({
				accessTier,
				permissions: scopedPermissions,
				teamId,
			});

			if (
				accessTier !== "orgAdmin" &&
				!scopedFlags.canManageMembers &&
				!scopedFlags.canManageSettings
			) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions to access this team",
						userId: actorIdOf(actor),
						resource: "team",
						action: "read",
					}),
				);
			}

			const teamWithEmployees = withMembershipEmployees(targetTeam as TeamWithMemberRelations);
			const formerSinceById = yield* dbService.query("getTeam.formerMembers", () =>
				formerEmployeesAmong(
					dbService.db,
					organizationId,
					teamWithEmployees.employees.map((member) => member.id),
				),
			);

			return {
				...teamWithEmployees,
				employees: teamWithEmployees.employees.map((member) => ({
					...member,
					...formerMark(formerSinceById, member.id),
				})),
				canManageMembers: scopedFlags.canManageMembers,
				canManageSettings: scopedFlags.canManageSettings,
			} as ScopedTeam & {
				employees?: Array<
					typeof employee.$inferSelect & {
						user: unknown;
						isFormer: boolean;
						/** On a former member only: the date they left, null when not recorded (#1439). */
						formerSince?: string | null;
					}
				>;
			};
		}),
);

/** The teams of the session's organization the actor may manage. */
export const listTeams = organizationAction(
	{
		name: "team.list",
		requires: "scopedManager",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const teams = yield* dbService.query("listTeams", async () => {
				return await dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					with: {
						memberships: {
							with: {
								employee: { with: { user: true } },
							},
						},
						primaryManager: { with: { user: true } },
					},
					orderBy: (team, { asc }) => [asc(team.name)],
				});
			});

			const scopedPermissions = yield* loadActorScopedPermissions(dbService, actor, organizationId);

			return buildTeamSettingsSurface({
				accessTier: accessTierOf(actor),
				teams: (teams as TeamWithMemberRelations[]).map(withMembershipEmployees),
				permissions: scopedPermissions,
			}).teams;
		}),
);

// =============================================================================
// Team Member Management Actions
// =============================================================================

/** Add a member to a team; needs canManageTeamMembers on the team below org admin. */
export const addTeamMember = organizationAction(
	{
		name: "team.addMember",
		requires: "scopedManager",
		schema: teamMemberChangeSchema,
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { teamId, employeeId } = input;
			const authorized = yield* authorizeTeamMemberChange(
				actor,
				organizationId,
				teamId,
				employeeId,
				"add",
			);
			const { dbService, targetTeam } = authorized;
			// authorizeTeamMemberChange refuses an add without a target employee.
			const targetEmployee = authorized.targetEmployee!;

			// The target's team feeds manual target facts; both writes commit under
			// the employee's configuration/access protection. A new primary team can end
			// the employee's driving authorization (#1425).
			const addition = {
				organizationId,
				teamId,
				employeeId: targetEmployee.id,
				hadPrimaryTeam: Boolean(targetEmployee.teamId),
				createdBy: actor.userId,
			};
			yield* keepDrivingLicenceStalePreview(
				dbService.query("addTeamMembership", () =>
					withAuthorizationMutation(
						{ organizationId, employeeIds: [targetEmployee.id] },
						(tx) =>
							runDrivingLicenceIntendedDriverWrite(
								tx,
								{
									organizationId,
									employeeIds: [targetEmployee.id],
									actorUserId: actor.userId,
									viewer: drivingLicenceViewer(actor),
									previewToken: input.drivingLicencePreviewToken,
								},
								(write) => writeTeamMemberAddition(write, addition),
							),
						dbService.db,
					),
				),
			);

			revalidateTag(CACHE_TAGS.TEAMS(organizationId), "max");
			revalidateTag(CACHE_TAGS.EMPLOYEES(organizationId), "max");

			const performedByName = yield* actorDisplayName(dbService, actor);
			// Trigger in-app notification (fire-and-forget)
			void onTeamMemberAdded({
				teamId,
				teamName: targetTeam.name,
				memberUserId: targetEmployee.userId,
				memberName: targetEmployee.user.name,
				organizationId,
				performedByName,
			});

			logger.info({ teamId, employeeId }, "Team member added successfully");
		}).pipe(
			logFailure("Failed to add team member", {
				teamId: input.teamId,
				employeeId: input.employeeId,
			}),
			Effect.mapError((error) =>
				error instanceof DatabaseError ? vacationPolicyWriteFailure(error) : error,
			),
		),
);

/** Remove a member from a team; needs canManageTeamMembers on the team below org admin. */
export const removeTeamMember = organizationAction(
	{
		name: "team.removeMember",
		requires: "scopedManager",
		schema: teamMemberChangeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { teamId, employeeId } = input;
			// The target employee info is kept for the notification after removal.
			const { dbService, targetTeam, targetEmployee } = yield* authorizeTeamMemberChange(
				actor,
				organizationId,
				teamId,
				employeeId,
				"remove",
			);

			// Moving the primary team can end the employee's driving authorization (#1425).
			const removal = { organizationId, teamId, employeeId };
			yield* keepDrivingLicenceStalePreview(
				dbService.query("removeTeamMembership", () =>
					withAuthorizationMutation(
						{ organizationId, employeeIds: [employeeId] },
						(tx) =>
							runDrivingLicenceIntendedDriverWrite(
								tx,
								{
									organizationId,
									employeeIds: [employeeId],
									actorUserId: actor.userId,
									viewer: drivingLicenceViewer(actor),
									previewToken: input.drivingLicencePreviewToken,
								},
								(write) => writeTeamMemberRemoval(write, removal),
							),
						dbService.db,
					),
				),
			);

			revalidateTag(CACHE_TAGS.TEAMS(organizationId), "max");
			revalidateTag(CACHE_TAGS.EMPLOYEES(organizationId), "max");

			// Trigger in-app notification (fire-and-forget)
			if (targetEmployee) {
				const performedByName = yield* actorDisplayName(dbService, actor);
				void onTeamMemberRemoved({
					teamId,
					teamName: targetTeam.name,
					memberUserId: targetEmployee.userId,
					memberName: targetEmployee.user.name,
					organizationId,
					performedByName,
				});
			}

			logger.info({ teamId, employeeId }, "Team member removed successfully");
		}).pipe(
			logFailure("Failed to remove team member", {
				teamId: input.teamId,
				employeeId: input.employeeId,
			}),
			Effect.mapError((error) =>
				error instanceof DatabaseError ? vacationPolicyWriteFailure(error) : error,
			),
		),
);
