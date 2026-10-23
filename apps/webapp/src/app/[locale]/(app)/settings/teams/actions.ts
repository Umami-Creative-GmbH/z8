"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import * as z from "zod";
import { type user as authUser, member } from "@/db/auth-schema";
import { employee, team, teamMembership, teamPermissions } from "@/db/schema";
import { vacationPolicyWriteFailure } from "@/lib/absences/vacation-policy-assignment-write";
import type { TeamPermissions as ScopedPermissions } from "@/lib/authorization";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { formerEmployeesAmong } from "@/lib/employee-lifecycle/current-roster-among";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { PermissionsService } from "@/lib/effect/services/permissions.service";
import { ensureOnCurrentRoster } from "@/lib/employee-lifecycle/current-roster-guard";
import { createLogger } from "@/lib/logger";
import { onTeamMemberAdded, onTeamMemberRemoved } from "@/lib/notifications/triggers";
import type { DrivingLicenceTeamChangeImpact } from "@/lib/organization/driving-licence/intended-driver-rules";
import {
	type DrivingLicenceChangeViewer,
	previewDrivingLicenceIntendedDriverWrite,
	runDrivingLicenceIntendedDriverWrite,
} from "@/lib/organization/driving-licence/no-longer-intended";
import { keepDrivingLicenceStalePreview } from "@/lib/organization/driving-licence/stale-preview";
import {
	buildTeamSettingsSurface,
	canUseManagerScopedTeamSettings,
	getScopedTeamFlags,
	type ScopedTeam,
} from "./team-scope";

const logger = createLogger("TeamActions");

// =============================================================================
// Validation Schemas
// =============================================================================

const createTeamSchema = z.object({
	organizationId: z.string().min(1, "Organization ID is required"),
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long"),
	description: z.string().max(500, "Description is too long").optional().nullable(),
	primaryManagerId: z.uuid().nullable().optional(),
});

const updateTeamSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long").optional(),
	description: z.string().max(500, "Description is too long").optional().nullable(),
	primaryManagerId: z.uuid().nullable().optional(),
});

type CreateTeam = z.infer<typeof createTeamSchema>;
type UpdateTeam = z.infer<typeof updateTeamSchema>;
type DatabaseServiceInstance = typeof DatabaseService.Service;
type OrganizationMembership = typeof member.$inferSelect;
type OrganizationEmployee = typeof employee.$inferSelect;
type OrganizationEmployeeWithUser = OrganizationEmployee & {
	user: typeof authUser.$inferSelect;
};
type TeamWithMemberRelations = typeof team.$inferSelect & {
	primaryManager: OrganizationEmployeeWithUser | null;
	memberships: Array<
		typeof teamMembership.$inferSelect & {
			employee: OrganizationEmployeeWithUser;
		}
	>;
};
type TeamSettingsActor = {
	organizationId: string;
	accessTier: "orgAdmin" | "manager" | "member";
	actorId: string;
	displayName: string;
	employeeRecord: OrganizationEmployee | OrganizationEmployeeWithUser | null;
};

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

function ensureManagerScopedEmployee(
	currentEmployee: TeamSettingsActor["employeeRecord"],
): Effect.Effect<void, AnyAppError> {
	if (!currentEmployee) {
		return Effect.fail(
			new NotFoundError({
				message: "Employee profile not found",
				entityType: "employee",
			}),
		);
	}

	if (canUseManagerScopedTeamSettings(currentEmployee.role === "employee" ? "member" : "manager")) {
		return Effect.succeed(undefined);
	}

	return Effect.fail(
		new AuthorizationError({
			message: "Team settings are only available to managers and admins",
			userId: currentEmployee.id,
			resource: "team",
			action: "read",
		}),
	);
}

function resolveTeamSettingsActor(
	dbService: DatabaseServiceInstance,
	sessionUser: { id: string; name: string },
	organizationId: string,
	options?: { includeEmployeeUser?: boolean },
): Effect.Effect<TeamSettingsActor, AnyAppError, AuthService | DatabaseService> {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		yield* authService.getSession(organizationId);
		const membershipRecord = yield* dbService.query("getOrganizationMembership", async () => {
			return await dbService.db.query.member.findFirst({
				where: and(eq(member.userId, sessionUser.id), eq(member.organizationId, organizationId)),
			});
		});
		const typedMembershipRecord = membershipRecord as OrganizationMembership | null;

		if (!typedMembershipRecord) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "No organization membership found",
					userId: sessionUser.id,
					resource: "team",
					action: "read",
				}),
			);
		}

		const employeeRecord = yield* dbService.query("getOrganizationEmployee", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.userId, sessionUser.id),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
				with: options?.includeEmployeeUser ? { user: true } : undefined,
			});
		});
		const typedEmployeeRecord = employeeRecord as TeamSettingsActor["employeeRecord"];

		if (typedMembershipRecord.role === "owner" || typedMembershipRecord.role === "admin") {
			return {
				organizationId,
				accessTier: "orgAdmin" as const,
				actorId: typedEmployeeRecord?.id ?? sessionUser.id,
				displayName:
					typedEmployeeRecord && "user" in typedEmployeeRecord
						? typedEmployeeRecord.user.name
						: sessionUser.name,
				employeeRecord: typedEmployeeRecord,
			};
		}

		if (!typedEmployeeRecord) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee profile not found",
					entityType: "employee",
				}),
			);
		}

		return {
			organizationId,
			accessTier: typedEmployeeRecord.role === "manager" ? "manager" : "member",
			actorId: typedEmployeeRecord.id,
			displayName:
				typedEmployeeRecord && "user" in typedEmployeeRecord
					? typedEmployeeRecord.user.name
					: sessionUser.name,
			employeeRecord: typedEmployeeRecord,
		};
	});
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
 * membership (by id) becomes the primary team, else none.
 */
async function writeTeamMemberRemoval(
	tx: TeamWriteTransaction,
	input: { organizationId: string; teamId: string; employeeId: string },
) {
	const { organizationId, teamId, employeeId } = input;
	await tx
		.delete(teamMembership)
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(teamMembership.teamId, teamId),
				eq(teamMembership.employeeId, employeeId),
			),
		);

	// Re-read under protection: the compatibility team may have moved.
	const current = await tx.query.employee.findFirst({
		where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
		columns: { teamId: true },
	});
	if (current?.teamId !== teamId) return;

	const remainingMemberships = await tx.query.teamMembership.findMany({
		where: and(
			eq(teamMembership.organizationId, organizationId),
			eq(teamMembership.employeeId, employeeId),
		),
	});
	const nextTeamId =
		remainingMemberships
			.flatMap((membership) => (membership.teamId !== teamId ? [membership.teamId] : []))
			.toSorted()[0] ?? null;

	await tx
		.update(employee)
		.set({ teamId: nextTeamId, updatedAt: currentTimestamp() })
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)));
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

function loadTeam(dbService: DatabaseServiceInstance, teamId: string) {
	return dbService
		.query("team.get", async () => {
			return await dbService.db.query.team.findFirst({ where: eq(team.id, teamId) });
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

/**
 * Who may add `employeeId` to or remove them from `teamId`. Both the member actions and their
 * driving licence previews use it, so a preview never reveals more than the change allows.
 */
function authorizeTeamMemberChange(teamId: string, employeeId: string, kind: "add" | "remove") {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const permissionsService = yield* PermissionsService;
		const action = kind === "add" ? "create" : "delete";

		// Get the team first to know its organization
		const targetTeam = yield* loadTeam(dbService, teamId);
		const actor = yield* resolveTeamSettingsActor(
			dbService,
			session.user,
			targetTeam.organizationId,
			{ includeEmployeeUser: true },
		);

		if (actor.accessTier === "member") {
			yield* ensureManagerScopedEmployee(actor.employeeRecord);
		}

		const canManage =
			actor.accessTier === "orgAdmin"
				? true
				: yield* permissionsService.hasTeamPermission(
						actor.actorId,
						"canManageTeamMembers",
						teamId,
					);

		if (!canManage) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions to manage team members",
					userId: actor.actorId,
					resource: "team_member",
					action,
				}),
			);
		}

		// The target employee must belong to the team's organization (with user info).
		const targetEmployee = yield* dbService.query("team.getTargetEmployee", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, employeeId),
					eq(employee.organizationId, targetTeam.organizationId),
				),
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
		// A former employee joins no team (#1438); removing one stays possible.
		if (kind === "add") {
			yield* ensureOnCurrentRoster(dbService, {
				organizationId: targetTeam.organizationId,
				employeeIds: [employeeId],
				field: "employeeId",
			});
		}

		if (kind === "add" && targetEmployee && actor.accessTier !== "orgAdmin") {
			const scopedPermissions = yield* loadScopedPermissions(
				dbService,
				actor.actorId,
				targetTeam.organizationId,
			);
			const targetEmployeeMemberships = yield* dbService.query(
				"team.getTargetEmployeeMemberships",
				async () => {
					return await dbService.db.query.teamMembership.findMany({
						where: and(
							eq(teamMembership.organizationId, targetTeam.organizationId),
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
				yield* Effect.fail(
					new AuthorizationError({
						message: "Cannot move employees from teams outside your scope",
						userId: actor.actorId,
						resource: "team_member",
						action: "create",
					}),
				);
			}
		}

		return { session, dbService, targetTeam, actor, targetEmployee };
	});
}

/** Who may delete `teamId`; shared by `deleteTeam` and its driving licence preview. */
function authorizeTeamDeletion(teamId: string) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const permissionsService = yield* PermissionsService;

		// Get team to verify it exists and belongs to same organization
		const targetTeam = yield* loadTeam(dbService, teamId);
		const actor = yield* resolveTeamSettingsActor(
			dbService,
			session.user,
			targetTeam.organizationId,
		);

		if (actor.accessTier === "member") {
			yield* ensureManagerScopedEmployee(actor.employeeRecord);
		}

		const canManage =
			actor.accessTier === "orgAdmin"
				? true
				: yield* permissionsService.hasTeamPermission(
						actor.actorId,
						"canManageTeamSettings",
						teamId,
					);

		if (!canManage) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions to delete team",
					userId: actor.actorId,
					resource: "team",
					action: "delete",
				}),
			);
		}

		return { session, dbService, targetTeam, actor };
	});
}

/** How much of a driving licence warning the actor may see (owners/admins: names and classes). */
function drivingLicenceViewer(
	session: { user: { id: string } },
	actor: TeamSettingsActor,
): DrivingLicenceChangeViewer {
	return { userId: session.user.id, organizationAdmin: actor.accessTier === "orgAdmin" };
}

/** The confirmed driving licence warning a team save takes (#1425). */
export type TeamChangeOptions = { drivingLicencePreviewToken?: string };

const teamMemberChangeSchema = z.enum(["add", "remove"]);

/**
 * The warning before adding or removing a team member (#1425): what the actor may see of who
 * would lose which driving authorizations because their primary team changes, and the token
 * the save takes. Read-only; authorized exactly like the change itself.
 */
export async function previewTeamMemberChangeDrivingImpact(
	teamId: string,
	employeeId: string,
	change: "add" | "remove",
): Promise<ServerActionResult<DrivingLicenceTeamChangeImpact>> {
	const effect = Effect.gen(function* () {
		const kind = yield* validateTeamMemberChange(change);
		const { session, dbService, targetTeam, actor, targetEmployee } =
			yield* authorizeTeamMemberChange(teamId, employeeId, kind);
		const organizationId = targetTeam.organizationId;
		return yield* dbService.query("team.previewMemberChangeDrivingImpact", () =>
			previewDrivingLicenceIntendedDriverWrite<TeamWriteTransaction>(
				{ organizationId, employeeIds: [employeeId], viewer: drivingLicenceViewer(session, actor) },
				(work) =>
					withAuthorizationMutation(
						{ organizationId, employeeIds: [employeeId] },
						work,
						dbService.db,
					),
				(tx) =>
					kind === "add"
						? writeTeamMemberAddition(tx, {
								organizationId,
								teamId,
								employeeId,
								hadPrimaryTeam: Boolean(targetEmployee?.teamId),
								createdBy: session.user.id,
							})
						: writeTeamMemberRemoval(tx, { organizationId, teamId, employeeId }),
			),
		);
	});
	return runServerActionSafe(effect);
}

function validateTeamMemberChange(change: unknown) {
	const parsed = teamMemberChangeSchema.safeParse(change);
	return parsed.success
		? Effect.succeed(parsed.data)
		: Effect.fail(
				new ValidationError({
					message: "Invalid team member change",
					field: "change",
					value: change,
				}),
			);
}

/**
 * The warning before deleting a team (#1425): what the actor may see of who would lose which
 * driving authorizations because the team is their primary team or its intended-driver
 * assignment goes, and the token the save takes. Read-only.
 */
export async function previewTeamDeletionDrivingImpact(
	teamId: string,
): Promise<ServerActionResult<DrivingLicenceTeamChangeImpact>> {
	const effect = Effect.gen(function* () {
		const { session, dbService, targetTeam, actor } = yield* authorizeTeamDeletion(teamId);
		const organizationId = targetTeam.organizationId;
		return yield* dbService.query("team.previewDeletionDrivingImpact", () =>
			previewDrivingLicenceIntendedDriverWrite<TeamWriteTransaction>(
				{ organizationId, viewer: drivingLicenceViewer(session, actor) },
				(work) =>
					withAuthorizationMutation({ organizationId, organizationWide: true }, work, dbService.db),
				(tx) => writeTeamDeletion(tx, { organizationId, teamId }),
			),
		);
	});
	return runServerActionSafe(effect);
}

// =============================================================================
// Team CRUD Actions
// =============================================================================

/**
 * Create a new team
 * Requires canCreateTeams permission
 */
export async function createTeam(
	data: CreateTeam,
): Promise<ServerActionResult<typeof team.$inferSelect>> {
	const tracer = trace.getTracer("teams");

	const effect = tracer.startActiveSpan(
		"createTeam",
		{
			attributes: {
				"team.organizationId": data.organizationId,
				"team.name": data.name,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const authService = yield* AuthService;
				const session = yield* authService.getSession();
				const dbService = yield* DatabaseService;
				const permissionsService = yield* PermissionsService;

				const actor = yield* resolveTeamSettingsActor(dbService, session.user, data.organizationId);

				span.setAttribute("currentEmployee.id", actor.actorId);

				if (actor.accessTier !== "orgAdmin") {
					yield* Effect.fail(
						new AuthorizationError({
							message: "Only organization admins can create teams",
							userId: actor.actorId,
							resource: "team",
							action: "create",
						}),
					);
				}

				// Check permission
				const canCreate =
					actor.accessTier === "orgAdmin"
						? true
						: yield* permissionsService.hasTeamPermission(actor.actorId, "canCreateTeams");

				if (!canCreate) {
					yield* Effect.fail(
						new AuthorizationError({
							message: "Insufficient permissions to create teams",
							userId: actor.actorId,
							resource: "team",
							action: "create",
						}),
					);
				}

				// Validate data
				const validationResult = createTeamSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* Effect.fail(
						new ValidationError({
							message: validationResult.error.issues[0]?.message || "Invalid input",
							field: validationResult.error.issues[0]?.path?.join(".") || "data",
						}),
					);
				}

				const validatedData = validationResult.data;
				yield* validatePrimaryManager(
					dbService,
					validatedData.organizationId,
					validatedData.primaryManagerId,
				);

				// Check for duplicate team name in organization
				const existing = yield* dbService.query("checkDuplicateTeam", async () => {
					return await dbService.db.query.team.findFirst({
						where: and(
							eq(team.organizationId, validatedData.organizationId),
							eq(team.name, validatedData.name),
						),
					});
				});

				if (existing) {
					yield* Effect.fail(
						new ValidationError({
							message: "Team with this name already exists in the organization",
							field: "name",
							value: validatedData.name,
						}),
					);
				}

				// Create team
				const [newTeam] = yield* dbService.query("createTeam", async () => {
					return await dbService.db
						.insert(team)
						.values({
							organizationId: validatedData.organizationId,
							name: validatedData.name,
							description: validatedData.description || null,
							primaryManagerId: validatedData.primaryManagerId ?? null,
						})
						.returning();
				});

				logger.info(
					{
						teamId: newTeam.id,
						teamName: newTeam.name,
						organizationId: newTeam.organizationId,
					},
					"Team created successfully",
				);

				// Invalidate teams cache
				revalidateTag(CACHE_TAGS.TEAMS(newTeam.organizationId), "max");

				span.setAttribute("team.id", newTeam.id);
				span.setStatus({ code: SpanStatusCode.OK });
				return newTeam;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to create team");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update a team
 * Requires canManageTeamSettings permission for the team
 */
export async function updateTeam(
	teamId: string,
	data: UpdateTeam,
): Promise<ServerActionResult<typeof team.$inferSelect>> {
	const tracer = trace.getTracer("teams");

	const effect = tracer.startActiveSpan(
		"updateTeam",
		{
			attributes: {
				"team.id": teamId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const authService = yield* AuthService;
				const session = yield* authService.getSession();
				const dbService = yield* DatabaseService;
				const permissionsService = yield* PermissionsService;

				// Get team to verify it exists and belongs to same organization
				const targetTeam = yield* dbService
					.query("getTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
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

				const actor = yield* resolveTeamSettingsActor(
					dbService,
					session.user,
					targetTeam.organizationId,
				);

				if (actor.accessTier === "member") {
					yield* ensureManagerScopedEmployee(actor.employeeRecord);
				}

				// Check permission
				const canManage =
					actor.accessTier === "orgAdmin"
						? true
						: yield* permissionsService.hasTeamPermission(
								actor.actorId,
								"canManageTeamSettings",
								teamId,
							);

				if (!canManage) {
					yield* Effect.fail(
						new AuthorizationError({
							message: "Insufficient permissions to manage team settings",
							userId: actor.actorId,
							resource: "team",
							action: "update",
						}),
					);
				}

				// Validate data
				const validationResult = updateTeamSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* Effect.fail(
						new ValidationError({
							message: validationResult.error.issues[0]?.message || "Invalid input",
							field: validationResult.error.issues[0]?.path?.join(".") || "data",
						}),
					);
				}

				const validatedData = validationResult.data;
				yield* validatePrimaryManager(
					dbService,
					targetTeam.organizationId,
					validatedData.primaryManagerId,
				);

				// Check for duplicate name if name is being changed
				if (validatedData.name && validatedData.name !== targetTeam.name) {
					const existing = yield* dbService.query("checkDuplicateTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: and(
								eq(team.organizationId, targetTeam.organizationId),
								eq(team.name, validatedData.name!),
							),
						});
					});

					if (existing) {
						yield* Effect.fail(
							new ValidationError({
								message: "Team with this name already exists in the organization",
								field: "name",
								value: validatedData.name,
							}),
						);
					}
				}

				// Update team
				const updateValues = {
					...(validatedData.name !== undefined ? { name: validatedData.name } : {}),
					...(validatedData.description !== undefined
						? { description: validatedData.description }
						: {}),
					...(validatedData.primaryManagerId !== undefined
						? { primaryManagerId: validatedData.primaryManagerId }
						: {}),
					updatedAt: currentTimestamp(),
				};

				yield* dbService.query("updateTeam", async () => {
					await dbService.db.update(team).set(updateValues).where(eq(team.id, teamId));
				});

				// Fetch and return the updated team
				const updatedTeam = yield* dbService
					.query("getUpdatedTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
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

				// Invalidate teams cache
				revalidateTag(CACHE_TAGS.TEAMS(updatedTeam.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });

				return updatedTeam;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId }, "Failed to update team");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Delete a team
 * Requires canManageTeamSettings permission for the team
 */
export async function deleteTeam(
	teamId: string,
	options: TeamChangeOptions = {},
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("teams");

	const effect = tracer.startActiveSpan(
		"deleteTeam",
		{
			attributes: {
				"team.id": teamId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const { session, dbService, targetTeam, actor } = yield* authorizeTeamDeletion(teamId);

				// Deletion cascades into employee teams and team permissions across the
				// organization, so it takes the organization-wide protection. Clearing a
				// primary team and the team's intended-driver assignment can end driving
				// authorizations (#1425).
				const deletion = { organizationId: targetTeam.organizationId, teamId };
				const deleted = yield* keepDrivingLicenceStalePreview(
					dbService.query("deleteTeam", () =>
						withAuthorizationMutation(
							{
								organizationId: targetTeam.organizationId,
								organizationWide: true,
							},
							(tx) =>
								runDrivingLicenceIntendedDriverWrite(
									tx,
									{
										organizationId: targetTeam.organizationId,
										actorUserId: session.user.id,
										viewer: drivingLicenceViewer(session, actor),
										previewToken: options.drivingLicencePreviewToken,
									},
									(write) => writeTeamDeletion(write, deletion),
								),
							dbService.db,
						),
					),
				);

				if (!deleted) {
					yield* Effect.fail(
						new ValidationError({
							message: "Cannot delete team with active members. Please reassign members first.",
							field: "teamId",
							value: teamId,
						}),
					);
				}

				logger.info({ teamId }, "Team deleted successfully");

				// Invalidate teams cache
				revalidateTag(CACHE_TAGS.TEAMS(targetTeam.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId }, "Failed to delete team");
						return yield* Effect.fail(error as AnyAppError);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get team details with members. Every member is listed; former employees are
 * marked so the page hides them until "Show former employees" is on (#1438).
 */
export async function getTeam(teamId: string): Promise<
	ServerActionResult<
		ScopedTeam & {
			employees?: Array<
				typeof employee.$inferSelect & {
					user: unknown;
					isFormer: boolean;
					/** On a former member only: the date they left, null when not recorded (#1439). */
					formerSince?: string | null;
				}
			>;
		}
	>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Get team with members
		const targetTeam = yield* dbService
			.query("getTeam", async () => {
				return await dbService.db.query.team.findFirst({
					where: eq(team.id, teamId),
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

		const actor = yield* resolveTeamSettingsActor(
			dbService,
			session.user,
			targetTeam.organizationId,
		);

		if (actor.accessTier === "member") {
			if (!actor.employeeRecord) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				);
			}

			yield* ensureManagerScopedEmployee(actor.employeeRecord);
		}

		const scopedPermissions = actor.employeeRecord
			? yield* loadScopedPermissions(dbService, actor.employeeRecord.id, targetTeam.organizationId)
			: { orgWide: null, byTeamId: new Map() };
		const scopedFlags = getScopedTeamFlags({
			accessTier: actor.accessTier,
			permissions: scopedPermissions,
			teamId,
		});

		if (
			actor.accessTier !== "orgAdmin" &&
			!scopedFlags.canManageMembers &&
			!scopedFlags.canManageSettings
		) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions to access this team",
					userId: actor.actorId,
					resource: "team",
					action: "read",
				}),
			);
		}

		const teamWithEmployees = withMembershipEmployees(targetTeam as TeamWithMemberRelations);
		const formerSinceById = yield* dbService.query("getTeam.formerMembers", () =>
			formerEmployeesAmong(
				dbService.db,
				targetTeam.organizationId,
				teamWithEmployees.employees.map((member) => member.id),
			),
		);

		return {
			...teamWithEmployees,
			employees: teamWithEmployees.employees.map((member) =>
				formerSinceById.has(member.id)
					? { ...member, isFormer: true, formerSince: formerSinceById.get(member.id) ?? null }
					: { ...member, isFormer: false },
			),
			canManageMembers: scopedFlags.canManageMembers,
			canManageSettings: scopedFlags.canManageSettings,
		};
	});

	return runServerActionSafe(effect);
}

/**
 * List all teams in an organization
 */
export async function listTeams(
	organizationId?: string,
): Promise<ServerActionResult<ScopedTeam[]>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		const fallbackEmployee = yield* dbService.query("getCurrentEmployee", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(eq(employee.userId, session.user.id), eq(employee.isActive, true)),
			});
		});

		const targetOrgId = organizationId || fallbackEmployee?.organizationId;

		if (!targetOrgId) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Organization context not found",
					entityType: "organization",
				}),
			);
		}

		const actor = yield* resolveTeamSettingsActor(dbService, session.user, targetOrgId);

		if (actor.accessTier === "member") {
			yield* ensureManagerScopedEmployee(actor.employeeRecord);
		}

		// Get all teams in organization
		const teams = yield* dbService.query("listTeams", async () => {
			return await dbService.db.query.team.findMany({
				where: eq(team.organizationId, targetOrgId),
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

		const scopedPermissions = actor.employeeRecord
			? yield* loadScopedPermissions(dbService, actor.employeeRecord.id, targetOrgId)
			: { orgWide: null, byTeamId: new Map() };

		return buildTeamSettingsSurface({
			accessTier: actor.accessTier,
			teams: (teams as TeamWithMemberRelations[]).map(withMembershipEmployees),
			permissions: scopedPermissions,
		}).teams;
	});

	return runServerActionSafe(effect);
}

// =============================================================================
// Team Member Management Actions
// =============================================================================

/**
 * Add a member to a team
 * Requires canManageTeamMembers permission for the team
 */
export async function addTeamMember(
	teamId: string,
	employeeId: string,
	options: TeamChangeOptions = {},
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("teams");

	const effect = tracer.startActiveSpan(
		"addTeamMember",
		{
			attributes: {
				"team.id": teamId,
				"employee.id": employeeId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const authorized = yield* authorizeTeamMemberChange(teamId, employeeId, "add");
				const { session, dbService, targetTeam, actor } = authorized;
				// authorizeTeamMemberChange refuses an add without a target employee.
				const targetEmployee = authorized.targetEmployee!;

				// The target's team feeds manual target facts; both writes commit under
				// the employee's configuration/access protection. A new primary team can end
				// the employee's driving authorization (#1425).
				const addition = {
					organizationId: targetTeam.organizationId,
					teamId,
					employeeId: targetEmployee.id,
					hadPrimaryTeam: Boolean(targetEmployee.teamId),
					createdBy: session.user.id,
				};
				yield* keepDrivingLicenceStalePreview(
					dbService.query("addTeamMembership", () =>
						withAuthorizationMutation(
							{
								organizationId: targetTeam.organizationId,
								employeeIds: [targetEmployee.id],
							},
							(tx) =>
								runDrivingLicenceIntendedDriverWrite(
									tx,
									{
										organizationId: targetTeam.organizationId,
										employeeIds: [targetEmployee.id],
										actorUserId: session.user.id,
										viewer: drivingLicenceViewer(session, actor),
										previewToken: options.drivingLicencePreviewToken,
									},
									(write) => writeTeamMemberAddition(write, addition),
								),
							dbService.db,
						),
					),
				);

				revalidateTag(CACHE_TAGS.TEAMS(targetTeam.organizationId), "max");
				revalidateTag(CACHE_TAGS.EMPLOYEES(targetTeam.organizationId), "max");

				// Trigger in-app notification (fire-and-forget)
				void onTeamMemberAdded({
					teamId,
					teamName: targetTeam.name,
					memberUserId: targetEmployee.userId,
					memberName: targetEmployee.user.name,
					organizationId: targetTeam.organizationId,
					performedByName: actor.displayName,
				});

				logger.info({ teamId, employeeId }, "Team member added successfully");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId, employeeId }, "Failed to add team member");
						return yield* Effect.fail(
							error instanceof DatabaseError
								? vacationPolicyWriteFailure(error)
								: (error as AnyAppError),
						);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Remove a member from a team
 * Requires canManageTeamMembers permission for the team
 */
export async function removeTeamMember(
	teamId: string,
	employeeId: string,
	options: TeamChangeOptions = {},
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("teams");

	const effect = tracer.startActiveSpan(
		"removeTeamMember",
		{
			attributes: {
				"team.id": teamId,
				"employee.id": employeeId,
			},
		},
		(span) => {
			return Effect.gen(function* () {
				// The target employee info is kept for the notification after removal.
				const { session, dbService, targetTeam, actor, targetEmployee } =
					yield* authorizeTeamMemberChange(teamId, employeeId, "remove");

				// Moving the primary team can end the employee's driving authorization (#1425).
				const removal = { organizationId: targetTeam.organizationId, teamId, employeeId };
				yield* keepDrivingLicenceStalePreview(
					dbService.query("removeTeamMembership", () =>
						withAuthorizationMutation(
							{
								organizationId: targetTeam.organizationId,
								employeeIds: [employeeId],
							},
							(tx) =>
								runDrivingLicenceIntendedDriverWrite(
									tx,
									{
										organizationId: targetTeam.organizationId,
										employeeIds: [employeeId],
										actorUserId: session.user.id,
										viewer: drivingLicenceViewer(session, actor),
										previewToken: options.drivingLicencePreviewToken,
									},
									(write) => writeTeamMemberRemoval(write, removal),
								),
							dbService.db,
						),
					),
				);

				revalidateTag(CACHE_TAGS.TEAMS(targetTeam.organizationId), "max");
				revalidateTag(CACHE_TAGS.EMPLOYEES(targetTeam.organizationId), "max");

				// Trigger in-app notification (fire-and-forget)
				if (targetEmployee) {
					void onTeamMemberRemoved({
						teamId,
						teamName: targetTeam.name,
						memberUserId: targetEmployee.userId,
						memberName: targetEmployee.user.name,
						organizationId: targetTeam.organizationId,
						performedByName: actor.displayName,
					});
				}

				logger.info({ teamId, employeeId }, "Team member removed successfully");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId, employeeId }, "Failed to remove team member");
						return yield* Effect.fail(
							error instanceof DatabaseError
								? vacationPolicyWriteFailure(error)
								: (error as AnyAppError),
						);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}
