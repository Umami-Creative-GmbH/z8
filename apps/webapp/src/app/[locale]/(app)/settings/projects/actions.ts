"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	employee,
	project,
	projectAssignment,
	projectManager,
	projectNotificationState,
	team,
	workPeriod,
} from "@/db/schema";
import { logAudit } from "@/lib/audit-logger";
import {
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { AuthService, AuthServiceLive } from "@/lib/effect/services/auth.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import type { ServerActionResult } from "@/lib/types";

// Types for project data
export type ProjectStatus = "planned" | "active" | "paused" | "completed" | "archived";
export type ProjectAssignmentType = "team" | "employee";

export interface ProjectWithDetails {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	status: ProjectStatus;
	icon: string | null;
	color: string | null;
	budgetHours: string | null;
	deadline: Date | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
	managers: {
		id: string;
		employeeId: string;
		employeeName: string;
	}[];
	assignments: {
		id: string;
		type: ProjectAssignmentType;
		teamId: string | null;
		teamName: string | null;
		employeeId: string | null;
		employeeName: string | null;
	}[];
	totalHoursBooked: number;
}

export interface CreateProjectInput {
	organizationId: string;
	name: string;
	description?: string;
	status?: ProjectStatus;
	icon?: string;
	color?: string;
	budgetHours?: number;
	deadline?: Date;
}

export interface UpdateProjectInput {
	name?: string;
	description?: string;
	status?: ProjectStatus;
	icon?: string;
	color?: string;
	budgetHours?: number | null;
	deadline?: Date | null;
}

/**
 * Get all projects for an organization with details
 */
export async function getProjects(
	organizationId: string,
): Promise<ServerActionResult<ProjectWithDetails[]>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"getProjects",
		{
			attributes: { "organization.id": organizationId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can manage projects",
										userId: session.user.id,
										resource: "project",
										action: "read",
									}),
								),
					),
				);

				// Fetch all projects
				const projects = yield* _(
					dbService.query("getProjects", async () => {
						return await db.query.project.findMany({
							where: eq(project.organizationId, organizationId),
							orderBy: [desc(project.createdAt)],
						});
					}),
				);

				// Fetch managers for all projects
				const projectIds = projects.map((p) => p.id);
				const managers = yield* _(
					dbService.query("getProjectManagers", async () => {
						return projectIds.length > 0
							? await db.query.projectManager.findMany({
									where: inArray(projectManager.projectId, projectIds),
									with: {
										employee: {
											with: {
												user: true,
											},
										},
									},
								})
							: [];
					}),
				);

				// Fetch assignments for all projects
				const assignments = yield* _(
					dbService.query("getProjectAssignments", async () => {
						return projectIds.length > 0
							? await db.query.projectAssignment.findMany({
									where: inArray(projectAssignment.projectId, projectIds),
									with: {
										team: true,
										employee: {
											with: {
												user: true,
											},
										},
									},
								})
							: [];
					}),
				);

				// Fetch total hours booked per project
				const hoursBooked = yield* _(
					dbService.query("getProjectHours", async () => {
						return projectIds.length > 0
							? await db
									.select({
										projectId: workPeriod.projectId,
										totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
									})
									.from(workPeriod)
									.where(inArray(workPeriod.projectId, projectIds))
									.groupBy(workPeriod.projectId)
							: [];
					}),
				);

				const hoursMap = new Map(
					hoursBooked.map((h) => [h.projectId, Math.round((h.totalMinutes / 60) * 100) / 100]),
				);

				// Map to ProjectWithDetails
				const result: ProjectWithDetails[] = projects.map((p) => ({
					id: p.id,
					organizationId: p.organizationId,
					name: p.name,
					description: p.description,
					status: p.status as ProjectStatus,
					icon: p.icon,
					color: p.color,
					budgetHours: p.budgetHours,
					deadline: p.deadline,
					isActive: p.isActive,
					createdAt: p.createdAt,
					createdBy: p.createdBy,
					updatedAt: p.updatedAt,
					updatedBy: p.updatedBy,
					managers: managers
						.filter((m) => m.projectId === p.id)
						.map((m) => ({
							id: m.id,
							employeeId: m.employeeId,
							employeeName: m.employee?.user?.name || "Unknown",
						})),
					assignments: assignments
						.filter((a) => a.projectId === p.id)
						.map((a) => ({
							id: a.id,
							type: a.assignmentType as ProjectAssignmentType,
							teamId: a.teamId,
							teamName: a.team?.name || null,
							employeeId: a.employeeId,
							employeeName: a.employee?.user?.name || null,
						})),
					totalHoursBooked: hoursMap.get(p.id) || 0,
				}));

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get projects");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true, data }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to get projects" },
		}));
}

/**
 * Create a new project
 */
export async function createProject(
	input: CreateProjectInput,
): Promise<ServerActionResult<{ id: string }>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"createProject",
		{
			attributes: {
				"organization.id": input.organizationId,
				"project.name": input.name,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, input.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can create projects",
										userId: session.user.id,
										resource: "project",
										action: "create",
									}),
								),
					),
				);

				// Check for duplicate name
				const existing = yield* _(
					dbService.query("checkDuplicate", async () => {
						return await db.query.project.findFirst({
							where: and(
								eq(project.organizationId, input.organizationId),
								eq(project.name, input.name),
							),
						});
					}),
				);

				if (existing) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "A project with this name already exists",
								field: "name",
							}),
						),
					);
				}

				// Create the project
				const [created] = yield* _(
					Effect.tryPromise({
						try: async () => {
							return await db
								.insert(project)
								.values({
									organizationId: input.organizationId,
									name: input.name,
									description: input.description || null,
									status: input.status || "planned",
									icon: input.icon || null,
									color: input.color || null,
									budgetHours: input.budgetHours?.toString() || null,
									deadline: input.deadline || null,
									isActive: true,
									createdBy: session.user.id,
									updatedAt: new Date(),
								})
								.returning();
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to create project",
								operation: "insert",
								table: "project",
							}),
					}),
				);

				// Create notification state for the project
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.insert(projectNotificationState).values({
								projectId: created.id,
								budgetThresholdsNotified: [],
								deadlineThresholdsNotified: [],
								updatedAt: new Date(),
							});
						},
						catch: (error) =>
							new DatabaseError({
								message:
									error instanceof Error ? error.message : "Failed to create notification state",
								operation: "insert",
								table: "projectNotificationState",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					entityType: "project",
					entityId: created.id,
					action: "project.created",
					performedBy: session.user.id,
					changes: JSON.stringify({ name: input.name, status: input.status || "planned" }),
					metadata: JSON.stringify({ organizationId: input.organizationId }),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, input }, "Failed to create project");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true, data }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to create project" },
		}));
}

/**
 * Update a project
 */
export async function updateProject(
	projectId: string,
	input: UpdateProjectInput,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"updateProject",
		{
			attributes: { "project.id": projectId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get the project and verify access
				const existingProject = yield* _(
					dbService.query("getProject", async () => {
						return await db.query.project.findFirst({
							where: eq(project.id, projectId),
						});
					}),
					Effect.flatMap((p) =>
						p
							? Effect.succeed(p)
							: Effect.fail(
									new NotFoundError({
										message: "Project not found",
										entityType: "project",
									}),
								),
					),
				);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingProject.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can update projects",
										userId: session.user.id,
										resource: "project",
										action: "update",
									}),
								),
					),
				);

				// Check for duplicate name if updating name
				if (input.name && input.name !== existingProject.name) {
					const duplicate = yield* _(
						dbService.query("checkDuplicate", async () => {
							return await db.query.project.findFirst({
								where: and(
									eq(project.organizationId, existingProject.organizationId),
									eq(project.name, input.name!),
								),
							});
						}),
					);

					if (duplicate) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "A project with this name already exists",
									field: "name",
								}),
							),
						);
					}
				}

				// Build update object
				const updateData: Partial<typeof project.$inferInsert> = {
					updatedBy: session.user.id,
				};

				if (input.name !== undefined) updateData.name = input.name;
				if (input.description !== undefined) updateData.description = input.description;
				if (input.status !== undefined) updateData.status = input.status;
				if (input.icon !== undefined) updateData.icon = input.icon;
				if (input.color !== undefined) updateData.color = input.color;
				if (input.budgetHours !== undefined)
					updateData.budgetHours = input.budgetHours?.toString() || null;
				if (input.deadline !== undefined) updateData.deadline = input.deadline;

				// Update the project
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.update(project).set(updateData).where(eq(project.id, projectId));
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to update project",
								operation: "update",
								table: "project",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					entityType: "project",
					entityId: projectId,
					action: "project.updated",
					performedBy: session.user.id,
					changes: JSON.stringify(input),
					metadata: JSON.stringify({ previousName: existingProject.name }),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, input }, "Failed to update project");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true, data: undefined }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to update project" },
		}));
}

/**
 * Archive a project
 */
export async function archiveProject(projectId: string): Promise<ServerActionResult<void>> {
	return updateProject(projectId, { status: "archived" });
}

/**
 * Add a manager to a project
 */
export async function addProjectManager(
	projectId: string,
	employeeId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"addProjectManager",
		{
			attributes: { "project.id": projectId, "employee.id": employeeId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get the project
				const existingProject = yield* _(
					dbService.query("getProject", async () => {
						return await db.query.project.findFirst({
							where: eq(project.id, projectId),
						});
					}),
					Effect.flatMap((p) =>
						p
							? Effect.succeed(p)
							: Effect.fail(
									new NotFoundError({
										message: "Project not found",
										entityType: "project",
									}),
								),
					),
				);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingProject.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can add project managers",
										userId: session.user.id,
										resource: "projectManager",
										action: "create",
									}),
								),
					),
				);

				// Check if already a manager
				const existing = yield* _(
					dbService.query("checkExisting", async () => {
						return await db.query.projectManager.findFirst({
							where: and(
								eq(projectManager.projectId, projectId),
								eq(projectManager.employeeId, employeeId),
							),
						});
					}),
				);

				if (existing) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "This employee is already a manager of this project",
								field: "employeeId",
							}),
						),
					);
				}

				// Add the manager
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.insert(projectManager).values({
								projectId,
								employeeId,
								assignedBy: session.user.id,
							});
						},
						catch: (error) =>
							new DatabaseError({
								message: error instanceof Error ? error.message : "Failed to add project manager",
								operation: "insert",
								table: "projectManager",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					entityType: "project",
					entityId: projectId,
					action: "project.manager_assigned",
					performedBy: session.user.id,
					employeeId,
					changes: JSON.stringify({ employeeId }),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, employeeId }, "Failed to add project manager");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true, data: undefined }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to add project manager" },
		}));
}

/**
 * Remove a manager from a project
 */
export async function removeProjectManager(
	projectId: string,
	employeeId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"removeProjectManager",
		{
			attributes: { "project.id": projectId, "employee.id": employeeId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get the project
				const existingProject = yield* _(
					dbService.query("getProject", async () => {
						return await db.query.project.findFirst({
							where: eq(project.id, projectId),
						});
					}),
					Effect.flatMap((p) =>
						p
							? Effect.succeed(p)
							: Effect.fail(
									new NotFoundError({
										message: "Project not found",
										entityType: "project",
									}),
								),
					),
				);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingProject.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can remove project managers",
										userId: session.user.id,
										resource: "projectManager",
										action: "delete",
									}),
								),
					),
				);

				// Remove the manager
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.delete(projectManager)
								.where(
									and(
										eq(projectManager.projectId, projectId),
										eq(projectManager.employeeId, employeeId),
									),
								);
						},
						catch: (error) =>
							new DatabaseError({
								message:
									error instanceof Error ? error.message : "Failed to remove project manager",
								operation: "delete",
								table: "projectManager",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					entityType: "project",
					entityId: projectId,
					action: "project.manager_removed",
					performedBy: session.user.id,
					employeeId,
					changes: JSON.stringify({ employeeId }),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, employeeId }, "Failed to remove project manager");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true, data: undefined }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to remove project manager" },
		}));
}

/**
 * Add an assignment to a project (team or employee)
 */
export async function addProjectAssignment(
	projectId: string,
	type: ProjectAssignmentType,
	targetId: string, // teamId or employeeId
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"addProjectAssignment",
		{
			attributes: { "project.id": projectId, type, targetId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get the project
				const existingProject = yield* _(
					dbService.query("getProject", async () => {
						return await db.query.project.findFirst({
							where: eq(project.id, projectId),
						});
					}),
					Effect.flatMap((p) =>
						p
							? Effect.succeed(p)
							: Effect.fail(
									new NotFoundError({
										message: "Project not found",
										entityType: "project",
									}),
								),
					),
				);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingProject.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can add project assignments",
										userId: session.user.id,
										resource: "projectAssignment",
										action: "create",
									}),
								),
					),
				);

				// Check if already assigned
				const existingCondition =
					type === "team"
						? and(
								eq(projectAssignment.projectId, projectId),
								eq(projectAssignment.teamId, targetId),
							)
						: and(
								eq(projectAssignment.projectId, projectId),
								eq(projectAssignment.employeeId, targetId),
							);

				const existing = yield* _(
					dbService.query("checkExisting", async () => {
						return await db.query.projectAssignment.findFirst({
							where: existingCondition,
						});
					}),
				);

				if (existing) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: `This ${type} is already assigned to this project`,
								field: type === "team" ? "teamId" : "employeeId",
							}),
						),
					);
				}

				// Add the assignment
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.insert(projectAssignment).values({
								projectId,
								organizationId: existingProject.organizationId,
								assignmentType: type,
								teamId: type === "team" ? targetId : null,
								employeeId: type === "employee" ? targetId : null,
								createdBy: session.user.id,
							});
						},
						catch: (error) =>
							new DatabaseError({
								message:
									error instanceof Error ? error.message : "Failed to add project assignment",
								operation: "insert",
								table: "projectAssignment",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					entityType: "project",
					entityId: projectId,
					action: "project.assignment_added",
					performedBy: session.user.id,
					changes: JSON.stringify({ type, targetId }),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, type, targetId }, "Failed to add project assignment");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true, data: undefined }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to add project assignment" },
		}));
}

/**
 * Remove an assignment from a project
 */
export async function removeProjectAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"removeProjectAssignment",
		{
			attributes: { "assignment.id": assignmentId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get the assignment
				const existingAssignment = yield* _(
					dbService.query("getAssignment", async () => {
						return await db.query.projectAssignment.findFirst({
							where: eq(projectAssignment.id, assignmentId),
						});
					}),
					Effect.flatMap((a) =>
						a
							? Effect.succeed(a)
							: Effect.fail(
									new NotFoundError({
										message: "Assignment not found",
										entityType: "projectAssignment",
									}),
								),
					),
				);

				// Verify admin access
				yield* _(
					dbService.query("verifyAdmin", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, existingAssignment.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can remove project assignments",
										userId: session.user.id,
										resource: "projectAssignment",
										action: "delete",
									}),
								),
					),
				);

				// Remove the assignment
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.delete(projectAssignment).where(eq(projectAssignment.id, assignmentId));
						},
						catch: (error) =>
							new DatabaseError({
								message:
									error instanceof Error ? error.message : "Failed to remove project assignment",
								operation: "delete",
								table: "projectAssignment",
							}),
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					entityType: "project",
					entityId: existingAssignment.projectId,
					action: "project.assignment_removed",
					performedBy: session.user.id,
					changes: JSON.stringify({
						type: existingAssignment.assignmentType,
						teamId: existingAssignment.teamId,
						employeeId: existingAssignment.employeeId,
					}),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, assignmentId }, "Failed to remove project assignment");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then(() => ({ success: true, data: undefined }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to remove project assignment" },
		}));
}

/**
 * Get teams for selection (for assignment dialog)
 */
export async function getTeamsForSelection(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; name: string }[]>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"getTeamsForSelection",
		{
			attributes: { "organization.id": organizationId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				const teams = yield* _(
					dbService.query("getTeams", async () => {
						return await db.query.team.findMany({
							where: eq(team.organizationId, organizationId),
							columns: { id: true, name: true },
							orderBy: [team.name],
						});
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return teams;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get teams");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true, data }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to get teams" },
		}));
}

/**
 * Get employees for selection (for manager/assignment dialog)
 */
export async function getEmployeesForSelection(
	organizationId: string,
): Promise<ServerActionResult<{ id: string; name: string; role: string }[]>> {
	const tracer = trace.getTracer("projects");

	const effect = tracer.startActiveSpan(
		"getEmployeesForSelection",
		{
			attributes: { "organization.id": organizationId },
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				const employees = yield* _(
					dbService.query("getEmployees", async () => {
						return await db.query.employee.findMany({
							where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
							with: {
								user: {
									columns: { name: true },
								},
							},
							orderBy: [employee.firstName, employee.lastName],
						});
					}),
				);

				const result = employees.map((e) => ({
					id: e.id,
					name: e.user?.name || `${e.firstName || ""} ${e.lastName || ""}`.trim() || "Unknown",
					role: e.role,
				}));

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get employees");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
				Effect.provide(AuthServiceLive),
				Effect.provide(DatabaseServiceLive),
			);
		},
	);

	return Effect.runPromise(effect)
		.then((data) => ({ success: true, data }))
		.catch((error) => ({
			success: false,
			error: { message: error?.message || "Failed to get employees" },
		}));
}
