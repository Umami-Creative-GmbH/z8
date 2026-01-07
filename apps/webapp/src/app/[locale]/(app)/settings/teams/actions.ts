"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as z from "zod";
import { employee, team } from "@/db/schema";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { PermissionsService } from "@/lib/effect/services/permissions.service";
import { createLogger } from "@/lib/logger";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

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

// =============================================================================
// Team CRUD Actions
// =============================================================================

/**
 * Create a new team
 * Requires canCreateTeams permission
 */
export async function createTeam(data: CreateTeam): Promise<ServerActionResult<typeof team.$inferSelect>> {
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

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, data.organizationId),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

				span.setAttribute("currentEmployee.id", currentEmployee.id);

				// Check permission
				const canCreate = yield* _(
					permissionsService.hasTeamPermission(currentEmployee.id, "canCreateTeams"),
				);

				if (!canCreate) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to create teams",
								userId: currentEmployee.id,
								resource: "team",
								action: "create",
							}),
						),
					);
				}

				// Validate data
				const validationResult = createTeamSchema.safeParse(data);
				if (!validationResult.success) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.errors?.[0]?.message || "Invalid input",
								field: validationResult.error?.errors?.[0]?.path?.join(".") || "data",
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
						return yield* _(Effect.fail(error as any));
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
): Promise<ServerActionResult<void>> {
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

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

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

				// Verify same organization
				if (targetTeam.organizationId !== currentEmployee.organizationId) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Cannot update team from different organization",
								userId: currentEmployee.id,
								resource: "team",
								action: "update",
							}),
						),
					);
				}

				// Check permission
				const canManage = yield* _(
					permissionsService.hasTeamPermission(
						currentEmployee.id,
						"canManageTeamSettings",
						teamId,
					),
				);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to manage team settings",
								userId: currentEmployee.id,
								resource: "team",
								action: "update",
							}),
						),
					);
				}

				// Validate data
				const validationResult = updateTeamSchema.safeParse(data);
				if (!validationResult.success) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error?.errors?.[0]?.message || "Invalid input",
								field: validationResult.error?.errors?.[0]?.path?.join(".") || "data",
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

				logger.info({ teamId }, "Team updated successfully");

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, teamId }, "Failed to update team");
						return yield* _(Effect.fail(error as any));
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

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				);

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

				// Verify same organization
				if (targetTeam.organizationId !== currentEmployee.organizationId) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Cannot delete team from different organization",
								userId: currentEmployee.id,
								resource: "team",
								action: "delete",
							}),
						),
					);
				}

				// Check permission
				const canManage = yield* _(
					permissionsService.hasTeamPermission(
						currentEmployee.id,
						"canManageTeamSettings",
						teamId,
					),
				);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to delete team",
								userId: currentEmployee.id,
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
						return yield* _(Effect.fail(error as any));
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
export async function getTeam(teamId: string): Promise<ServerActionResult<typeof team.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

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

		// Verify same organization
		if (targetTeam.organizationId !== currentEmployee.organizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot access team from different organization",
						userId: currentEmployee.id,
						resource: "team",
						action: "read",
					}),
				),
			);
		}

		return targetTeam;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * List all teams in an organization
 */
export async function listTeams(
	organizationId?: string,
): Promise<ServerActionResult<Array<typeof team.$inferSelect>>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		const targetOrgId = organizationId || currentEmployee.organizationId;

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

		return teams;
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

				// Get current employee - filter by the team's organization
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, targetTeam.organizationId),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found in this organization",
										entityType: "employee",
									}),
								),
					),
				);

				// Check permission
				const canManage = yield* _(
					permissionsService.hasTeamPermission(
						currentEmployee.id,
						"canManageTeamMembers",
						teamId,
					),
				);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to manage team members",
								userId: currentEmployee.id,
								resource: "team_member",
								action: "create",
							}),
						),
					);
				}

				// Verify target employee exists and is in the same organization as the team
				const targetEmployee = yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.id, employeeId),
								eq(employee.organizationId, targetTeam.organizationId),
							),
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
						return yield* _(Effect.fail(error as any));
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

				// Get current employee - filter by the team's organization
				const currentEmployee = yield* _(
					dbService.query("getCurrentEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, targetTeam.organizationId),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found in this organization",
										entityType: "employee",
									}),
								),
					),
				);

				// Check permission
				const canManage = yield* _(
					permissionsService.hasTeamPermission(
						currentEmployee.id,
						"canManageTeamMembers",
						teamId,
					),
				);

				if (!canManage) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Insufficient permissions to manage team members",
								userId: currentEmployee.id,
								resource: "team_member",
								action: "delete",
							}),
						),
					);
				}

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
						return yield* _(Effect.fail(error as any));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
