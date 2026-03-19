"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as z from "zod";
import { member, user as authUser } from "@/db/auth-schema";
import { employee, team, teamPermissions } from "@/db/schema";
import type { TeamPermissions as ScopedPermissions } from "@/lib/authorization";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { PermissionsService } from "@/lib/effect/services/permissions.service";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { createLogger } from "@/lib/logger";
import { onTeamMemberAdded, onTeamMemberRemoved } from "@/lib/notifications/triggers";
import {
	buildTeamSettingsSurface,
	canUseManagerScopedTeamSettings,
	canReassignEmployeeWithinScope,
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
});

const updateTeamSchema = z.object({
	name: z.string().min(1, "Team name is required").max(100, "Team name is too long").optional(),
	description: z.string().max(500, "Description is too long").optional().nullable(),
});

type CreateTeam = z.infer<typeof createTeamSchema>;
type UpdateTeam = z.infer<typeof updateTeamSchema>;
type DatabaseServiceInstance = typeof DatabaseService.Service;
type OrganizationMembership = typeof member.$inferSelect;
type OrganizationEmployee = typeof employee.$inferSelect;
type OrganizationEmployeeWithUser = OrganizationEmployee & {
	user: typeof authUser.$inferSelect;
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
	return Effect.gen(function* (_) {
		const permissionRows = (yield* _(
			dbService.query("getScopedTeamPermissions", async () => {
				return await dbService.db.query.teamPermissions.findMany({
					where: and(
						eq(teamPermissions.employeeId, employeeId),
						eq(teamPermissions.organizationId, organizationId),
					),
				});
			}),
		)) as Array<typeof teamPermissions.$inferSelect>;

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
): Effect.Effect<TeamSettingsActor, AnyAppError> {
	return Effect.gen(function* (_) {
		const membershipRecord = yield* _(
			dbService.query("getOrganizationMembership", async () => {
				return await dbService.db.query.member.findFirst({
					where: and(eq(member.userId, sessionUser.id), eq(member.organizationId, organizationId)),
				});
			}),
		);
		const typedMembershipRecord = membershipRecord as OrganizationMembership | null;

		if (!typedMembershipRecord) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "No organization membership found",
						userId: sessionUser.id,
						resource: "team",
						action: "read",
					}),
				),
			);
		}

		const employeeRecord = yield* _(
			dbService.query("getOrganizationEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, sessionUser.id),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
					with: options?.includeEmployeeUser ? { user: true } : undefined,
				});
			}),
		);
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
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

				const actor = yield* _(
					resolveTeamSettingsActor(dbService, session.user, data.organizationId),
				);

				span.setAttribute("currentEmployee.id", actor.actorId);

				if (actor.accessTier !== "orgAdmin") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only organization admins can create teams",
								userId: actor.actorId,
								resource: "team",
								action: "create",
							}),
						),
					);
				}

				// Check permission
				const canCreate =
					actor.accessTier === "orgAdmin"
						? true
						: yield* _(permissionsService.hasTeamPermission(actor.actorId, "canCreateTeams"));

				if (!canCreate) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to create teams",
								userId: actor.actorId,
								resource: "team",
								action: "create",
							}),
						),
					);
				}

				// Validate data
				const validationResult = createTeamSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Check for duplicate team name in organization
				const existing = yield* _(
					dbService.query("checkDuplicateTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: and(
								eq(team.organizationId, validatedData.organizationId),
								eq(team.name, validatedData.name),
							),
						});
					}),
				);

				if (existing) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Team with this name already exists in the organization",
								field: "name",
								value: validatedData.name,
							}),
						),
					);
				}

				// Create team
				const [newTeam] = yield* _(
					dbService.query("createTeam", async () => {
						return await dbService.db
							.insert(team)
							.values({
								organizationId: validatedData.organizationId,
								name: validatedData.name,
								description: validatedData.description || null,
							})
							.returning();
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error }, "Failed to create team");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

				// Get team to verify it exists and belongs to same organization
				const targetTeam = yield* _(
					dbService.query("getTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
						});
					}),
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

				const actor = yield* _(
					resolveTeamSettingsActor(dbService, session.user, targetTeam.organizationId),
				);

				if (actor.accessTier === "member") {
					yield* _(ensureManagerScopedEmployee(actor.employeeRecord));
				}

				// Check permission
				const canManage =
					actor.accessTier === "orgAdmin"
						? true
						: yield* _(
							permissionsService.hasTeamPermission(actor.actorId, "canManageTeamSettings", teamId),
						);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to manage team settings",
								userId: actor.actorId,
								resource: "team",
								action: "update",
							}),
						),
					);
				}

				// Validate data
				const validationResult = updateTeamSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Check for duplicate name if name is being changed
				if (validatedData.name && validatedData.name !== targetTeam.name) {
					const existing = yield* _(
						dbService.query("checkDuplicateTeam", async () => {
							return await dbService.db.query.team.findFirst({
								where: and(
									eq(team.organizationId, targetTeam.organizationId),
									eq(team.name, validatedData.name!),
								),
							});
						}),
					);

					if (existing) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Team with this name already exists in the organization",
									field: "name",
									value: validatedData.name,
								}),
							),
						);
					}
				}

				// Update team
				yield* _(
					dbService.query("updateTeam", async () => {
						await dbService.db
							.update(team)
							.set({
								...validatedData,
								updatedAt: currentTimestamp(),
							})
							.where(eq(team.id, teamId));
					}),
				);

				// Fetch and return the updated team
				const updatedTeam = yield* _(
					dbService.query("getUpdatedTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
						});
					}),
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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId }, "Failed to update team");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Delete a team
 * Requires canManageTeamSettings permission for the team
 */
export async function deleteTeam(teamId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("teams");

	const effect = tracer.startActiveSpan(
		"deleteTeam",
		{
			attributes: {
				"team.id": teamId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

				// Get team to verify it exists and belongs to same organization
				const targetTeam = yield* _(
					dbService.query("getTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
						});
					}),
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

				const actor = yield* _(
					resolveTeamSettingsActor(dbService, session.user, targetTeam.organizationId),
				);

				if (actor.accessTier === "member") {
					yield* _(ensureManagerScopedEmployee(actor.employeeRecord));
				}

				// Check permission
				const canManage =
					actor.accessTier === "orgAdmin"
						? true
						: yield* _(
							permissionsService.hasTeamPermission(actor.actorId, "canManageTeamSettings", teamId),
						);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to delete team",
								userId: actor.actorId,
								resource: "team",
								action: "delete",
							}),
						),
					);
				}

				// Check if team has members
				const members = yield* _(
					dbService.query("getTeamMembers", async () => {
						return await dbService.db.query.employee.findMany({
							where: eq(employee.teamId, teamId),
						});
					}),
				);

				if (members.length > 0) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Cannot delete team with active members. Please reassign members first.",
								field: "teamId",
								value: teamId,
							}),
						),
					);
				}

				// Delete team
				yield* _(
					dbService.query("deleteTeam", async () => {
						await dbService.db.delete(team).where(eq(team.id, teamId));
					}),
				);

				logger.info({ teamId }, "Team deleted successfully");

				// Invalidate teams cache
				revalidateTag(CACHE_TAGS.TEAMS(targetTeam.organizationId), "max");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId }, "Failed to delete team");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get team details with members
 */
export async function getTeam(
	teamId: string,
): Promise<ServerActionResult<ScopedTeam & { employees?: Array<typeof employee.$inferSelect & { user: unknown }> }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get team with members
		const targetTeam = yield* _(
			dbService.query("getTeam", async () => {
				return await dbService.db.query.team.findFirst({
					where: eq(team.id, teamId),
					with: {
						employees: {
							with: {
								user: true,
							},
						},
					},
				});
			}),
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

		const actor = yield* _(
			resolveTeamSettingsActor(dbService, session.user, targetTeam.organizationId),
		);

		if (actor.accessTier === "member") {
			if (!actor.employeeRecord) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Employee profile not found",
							entityType: "employee",
						}),
					),
				);
			}

			yield* _(ensureManagerScopedEmployee(actor.employeeRecord));
		}

		const scopedPermissions = actor.employeeRecord
			? yield* _(loadScopedPermissions(dbService, actor.employeeRecord.id, targetTeam.organizationId))
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
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions to access this team",
						userId: actor.actorId,
						resource: "team",
						action: "read",
					}),
				),
			);
		}

		return {
			...targetTeam,
			canManageMembers: scopedFlags.canManageMembers,
			canManageSettings: scopedFlags.canManageSettings,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * List all teams in an organization
 */
export async function listTeams(
	organizationId?: string,
): Promise<ServerActionResult<ScopedTeam[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const fallbackEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(eq(employee.userId, session.user.id), eq(employee.isActive, true)),
				});
			}),
		);

		const targetOrgId = organizationId || fallbackEmployee?.organizationId;

		if (!targetOrgId) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Organization context not found",
						entityType: "organization",
					}),
				),
			);
		}

		const actor = yield* _(resolveTeamSettingsActor(dbService, session.user, targetOrgId));

		if (actor.accessTier === "member") {
			yield* _(ensureManagerScopedEmployee(actor.employeeRecord));
		}

		// Get all teams in organization
		const teams = yield* _(
			dbService.query("listTeams", async () => {
				return await dbService.db.query.team.findMany({
					where: eq(team.organizationId, targetOrgId),
					with: {
						employees: {
							with: {
								user: true,
							},
						},
					},
					orderBy: (team, { asc }) => [asc(team.name)],
				});
			}),
		);

		const scopedPermissions = actor.employeeRecord
			? yield* _(loadScopedPermissions(dbService, actor.employeeRecord.id, targetOrgId))
			: { orgWide: null, byTeamId: new Map() };

		return buildTeamSettingsSurface({
			accessTier: actor.accessTier,
			teams,
			permissions: scopedPermissions,
		}).teams;
	}).pipe(Effect.provide(AppLayer));

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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

				// Get the team first to know its organization
				const targetTeam = yield* _(
					dbService.query("getTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
						});
					}),
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

				const actor = yield* _(
					resolveTeamSettingsActor(dbService, session.user, targetTeam.organizationId, {
						includeEmployeeUser: true,
					}),
				);

				if (actor.accessTier === "member") {
					yield* _(ensureManagerScopedEmployee(actor.employeeRecord));
				}

				// Check permission
				const canManage =
					actor.accessTier === "orgAdmin"
						? true
						: yield* _(
							permissionsService.hasTeamPermission(actor.actorId, "canManageTeamMembers", teamId),
						);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to manage team members",
								userId: actor.actorId,
								resource: "team_member",
								action: "create",
							}),
						),
					);
				}

				// Verify target employee exists and is in the same organization as the team (with user info)
				const targetEmployee = yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.id, employeeId),
								eq(employee.organizationId, targetTeam.organizationId),
							),
							with: { user: true },
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee not found in this organization",
										entityType: "employee",
										entityId: employeeId,
									}),
								),
					),
				);

				if (actor.accessTier !== "orgAdmin") {
					const scopedPermissions = yield* _(
						loadScopedPermissions(dbService, actor.actorId, targetTeam.organizationId),
					);
					const manageableTeamIds = new Set(
						Array.from(scopedPermissions.byTeamId.entries())
							.filter(([, flags]) => flags.canManageTeamMembers)
							.map(([managedTeamId]) => managedTeamId),
					);

					if (
						!scopedPermissions.orgWide?.canManageTeamMembers &&
						!canReassignEmployeeWithinScope({
							currentEmployeeTeamId: targetEmployee.teamId,
							targetTeamId: teamId,
							manageableTeamIds,
						})
					) {
						yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Cannot move employees from teams outside your scope",
									userId: actor.actorId,
									resource: "team_member",
									action: "create",
								}),
							),
						);
					}
				}

				// Add employee to team
				yield* _(
					dbService.query("addTeamMember", async () => {
						await dbService.db
							.update(employee)
							.set({
								teamId,
								updatedAt: currentTimestamp(),
							})
							.where(eq(employee.id, targetEmployee.id));
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId, employeeId }, "Failed to add team member");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const permissionsService = yield* _(PermissionsService);

				// Get the team first to know its organization
				const targetTeam = yield* _(
					dbService.query("getTeam", async () => {
						return await dbService.db.query.team.findFirst({
							where: eq(team.id, teamId),
						});
					}),
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

				const actor = yield* _(
					resolveTeamSettingsActor(dbService, session.user, targetTeam.organizationId, {
						includeEmployeeUser: true,
					}),
				);

				if (actor.accessTier === "member") {
					yield* _(ensureManagerScopedEmployee(actor.employeeRecord));
				}

				// Check permission
				const canManage =
					actor.accessTier === "orgAdmin"
						? true
						: yield* _(
							permissionsService.hasTeamPermission(actor.actorId, "canManageTeamMembers", teamId),
						);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to manage team members",
								userId: actor.actorId,
								resource: "team_member",
								action: "delete",
							}),
						),
					);
				}

				// Get target employee info for notification before removal
				const targetEmployee = yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(eq(employee.id, employeeId), eq(employee.teamId, teamId)),
							with: { user: true },
						});
					}),
				);

				// Remove employee from team
				yield* _(
					dbService.query("removeTeamMember", async () => {
						await dbService.db
							.update(employee)
							.set({
								teamId: null,
								updatedAt: currentTimestamp(),
							})
							.where(and(eq(employee.id, employeeId), eq(employee.teamId, teamId)));
					}),
				);

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
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId, employeeId }, "Failed to remove team member");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
