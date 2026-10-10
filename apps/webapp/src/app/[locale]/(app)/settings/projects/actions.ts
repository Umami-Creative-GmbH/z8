"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	customer,
	employee,
	project,
	projectAssignment,
	projectManager,
	team,
	workPeriod,
} from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { readProjectActiveCustomerId } from "@/lib/billable-time/project-customer";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import {
	insertProject,
	insertProjectAssignments,
	insertProjectManagers,
} from "@/lib/projects/project-creation";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import {
	projectBillableDefault,
	requireBillableTimeForDefaultChange,
} from "./project-billable-default-input";
import {
	ensureSettingsActorCanAccessCustomerTarget,
	ensureSettingsActorCanAccessProjectTarget,
	ensureSettingsActorCanManageProjectManagers,
	ensureSettingsActorCanUseProjectCustomer,
	filterItemsToManagedProjects,
	getManagedProjectIdsForSettingsActor,
	getProjectSettingsActorContext,
	getProjectTarget,
} from "./project-scope";

const PROJECT_MANAGER_CHANGE_DENIED = "Only organization admins can change project managers";

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
	customerId: string | null;
	customerName: string | null;
	/** Whether new work on the project starts as billable work (#900). */
	billableDefault: boolean;
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

type ProjectWithCustomer = typeof project.$inferSelect & {
	customer: Pick<typeof customer.$inferSelect, "id" | "name"> | null;
};

type ProjectManagerWithEmployee = typeof projectManager.$inferSelect & {
	employee:
		| (Pick<typeof employee.$inferSelect, "id" | "organizationId"> & {
				user: { name: string | null } | null;
		  })
		| null;
};

type ProjectAssignmentWithRelations = typeof projectAssignment.$inferSelect & {
	team: Pick<typeof team.$inferSelect, "name" | "organizationId"> | null;
	employee:
		| (Pick<typeof employee.$inferSelect, "id" | "organizationId"> & {
				user: { name: string | null } | null;
		  })
		| null;
};

type ProjectSettingsReader = Pick<typeof db, "query">;

async function getProjectRelationshipEmployee(
	employeeId: string,
	organizationId: string,
	reader: ProjectSettingsReader = db,
) {
	return reader.query.employee.findFirst({
		where: and(
			eq(employee.id, employeeId),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
		columns: { id: true },
	});
}

async function getProjectAssignmentTarget(
	type: ProjectAssignmentType,
	targetId: string,
	organizationId: string,
	reader: ProjectSettingsReader = db,
) {
	if (type === "team") {
		return reader.query.team.findFirst({
			where: and(eq(team.id, targetId), eq(team.organizationId, organizationId)),
			columns: { id: true },
		});
	}

	return getProjectRelationshipEmployee(targetId, organizationId, reader);
}

/** Validation failures raised inside a guarded transaction keep their type. */
function keepTypedMutationError(error: DatabaseError) {
	return error.cause instanceof ValidationError || error.cause instanceof NotFoundError
		? error.cause
		: error;
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
	customerId?: string;
	/** Billable default (#900); only a project with a customer can have it on. */
	billableDefault?: boolean;
}

export interface UpdateProjectInput {
	name?: string;
	description?: string;
	status?: ProjectStatus;
	icon?: string;
	color?: string;
	budgetHours?: number | null;
	deadline?: Date | null;
	customerId?: string | null;
	/** Billable default (#900); never changes existing work. */
	billableDefault?: boolean;
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
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId,
					queryName: "getProjects:actor",
				});
				const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(actor);
				const dbService = actor.dbService;

				// Fetch all projects with customer relation
				const projects = yield* dbService.query("getProjects", async () => {
					return await db.query.project.findMany({
						where: eq(project.organizationId, organizationId),
						orderBy: [desc(project.createdAt)],
						with: {
							customer: {
								columns: { id: true, name: true },
							},
						},
					});
				});

				// Fetch managers for all projects
				const typedProjects = projects as unknown as ProjectWithCustomer[];
				const scopedProjects = filterItemsToManagedProjects(typedProjects, managedProjectIds);
				const projectIds = scopedProjects.map((p) => p.id);
				const managers = yield* dbService.query("getProjectManagers", async () => {
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
				});

				// Fetch assignments for all projects
				const assignments = yield* dbService.query("getProjectAssignments", async () => {
					return projectIds.length > 0
						? await db.query.projectAssignment.findMany({
								where: and(
									inArray(projectAssignment.projectId, projectIds),
									eq(projectAssignment.organizationId, organizationId),
								),
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
				});

				// Fetch total hours booked per project
				const hoursBooked = yield* dbService.query("getProjectHours", async () => {
					return projectIds.length > 0
						? await db
								.select({
									projectId: workPeriod.projectId,
									totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
								})
								.from(workPeriod)
								.where(
									and(
										inArray(workPeriod.projectId, projectIds),
										eq(workPeriod.organizationId, organizationId),
										// Completed work only, as the reports and budget alerts count (#794).
										completedWorkPeriodCondition(),
									),
								)
								.groupBy(workPeriod.projectId)
						: [];
				});

				const typedManagers = managers as unknown as ProjectManagerWithEmployee[];
				const typedAssignments = assignments as unknown as ProjectAssignmentWithRelations[];
				const managersByProject = new Map<string, ProjectWithDetails["managers"]>();
				for (const manager of typedManagers) {
					if (manager.employee?.organizationId !== organizationId) {
						continue;
					}
					const projectManagers = managersByProject.get(manager.projectId) ?? [];
					projectManagers.push({
						id: manager.id,
						employeeId: manager.employeeId,
						employeeName: manager.employee?.user?.name || "Unknown",
					});
					managersByProject.set(manager.projectId, projectManagers);
				}
				const assignmentsByProject = new Map<string, ProjectWithDetails["assignments"]>();
				for (const assignment of typedAssignments) {
					if (
						(assignment.assignmentType === "team" &&
							assignment.team?.organizationId !== organizationId) ||
						(assignment.assignmentType === "employee" &&
							assignment.employee?.organizationId !== organizationId)
					) {
						continue;
					}
					const projectAssignments = assignmentsByProject.get(assignment.projectId) ?? [];
					projectAssignments.push({
						id: assignment.id,
						type: assignment.assignmentType as ProjectAssignmentType,
						teamId: assignment.teamId,
						teamName: assignment.team?.name || null,
						employeeId: assignment.employeeId,
						employeeName: assignment.employee?.user?.name || null,
					});
					assignmentsByProject.set(assignment.projectId, projectAssignments);
				}

				const hoursMap = new Map(
					hoursBooked.map((h) => [h.projectId, Math.round((h.totalMinutes / 60) * 100) / 100]),
				);

				// Map to ProjectWithDetails
				const result: ProjectWithDetails[] = scopedProjects.map((p) => ({
					id: p.id,
					organizationId: p.organizationId,
					name: p.name,
					description: p.description,
					status: p.status as ProjectStatus,
					icon: p.icon,
					color: p.color,
					budgetHours: p.budgetHours,
					deadline: p.deadline,
					customerId: p.customerId,
					customerName: p.customer?.name ?? null,
					billableDefault: p.billableDefault,
					isActive: p.isActive,
					createdAt: p.createdAt,
					createdBy: p.createdBy,
					updatedAt: p.updatedAt,
					updatedBy: p.updatedBy,
					managers: managersByProject.get(p.id) ?? [],
					assignments: assignmentsByProject.get(p.id) ?? [],
					totalHoursBooked: hoursMap.get(p.id) || 0,
				}));

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get projects");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId: input.organizationId,
					queryName: "createProject:actor",
				});
				const session = actor.session;
				const dbService = actor.dbService;

				// Check for duplicate name
				const existing = yield* dbService.query("checkDuplicate", async () => {
					return await db.query.project.findFirst({
						where: and(
							eq(project.organizationId, input.organizationId),
							eq(project.name, input.name),
						),
					});
				});

				if (existing) {
					yield* Effect.fail(
						new ValidationError({
							message: "A project with this name already exists",
							field: "name",
						}),
					);
				}

				// Validate customerId if provided
				if (input.customerId) {
					yield* ensureSettingsActorCanUseProjectCustomer(actor, input.customerId, "create");
				}

				yield* requireBillableTimeForDefaultChange(dbService, input.organizationId, {
					requested: input.billableDefault,
					current: false,
				});
				const billableDefault = yield* projectBillableDefault({
					requested: input.billableDefault,
					current: false,
					customerId: input.customerId || null,
				});

				const created = yield* dbService.query("project.create", async () => {
					return await db.transaction(async (tx) => {
						const newProject = await insertProject(tx, {
							organizationId: input.organizationId,
							name: input.name,
							description: input.description || null,
							status: input.status || "planned",
							icon: input.icon || null,
							color: input.color || null,
							budgetHours: input.budgetHours?.toString() || null,
							deadline: input.deadline || null,
							customerId: input.customerId || null,
							billableDefault,
							createdBy: session.user.id,
						});

						if (actor.accessTier === "manager" && actor.currentEmployee) {
							await insertProjectManagers(tx, {
								projectId: newProject.id,
								employeeIds: [actor.currentEmployee.id],
								assignedBy: session.user.id,
							});
						}

						return newProject;
					});
				});

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.PROJECT_CREATED,
					actorId: session.user.id,
					targetId: created.id,
					targetType: "project",
					organizationId: input.organizationId,
					changes: { name: input.name, status: input.status || "planned" },
					metadata: { projectName: input.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, input }, "Failed to create project");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const existingProject = yield* getProjectTarget(projectId, "updateProject:getProject");
				const actor = yield* getProjectSettingsActorContext({
					organizationId: existingProject.organizationId,
					queryName: "updateProject:actor",
				});
				const session = actor.session;
				const dbService = actor.dbService;

				yield* ensureSettingsActorCanAccessProjectTarget(actor, existingProject, {
					message: "You do not have access to update this project",
					resource: "project",
					action: "update",
				});

				// Check for duplicate name if updating name
				if (input.name && input.name !== existingProject.name) {
					const duplicate = yield* dbService.query("checkDuplicate", async () => {
						return await db.query.project.findFirst({
							where: and(
								eq(project.organizationId, existingProject.organizationId),
								eq(project.name, input.name!),
							),
						});
					});

					if (duplicate) {
						yield* Effect.fail(
							new ValidationError({
								message: "A project with this name already exists",
								field: "name",
							}),
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
				if (input.customerId !== undefined) updateData.customerId = input.customerId;
				// Settable by whoever may edit the project while Billable Time is on; no
				// configuration guard (ADR 0001).
				yield* requireBillableTimeForDefaultChange(dbService, existingProject.organizationId, {
					requested: input.billableDefault,
					current: existingProject.billableDefault,
				});
				// A deleted customer leaves the project without customer (#768): its default
				// switches off with the next edit and cannot be switched on.
				const customerForDefault =
					input.customerId !== undefined
						? input.customerId
						: existingProject.customerId === null
							? null
							: yield* dbService.query("project.activeCustomer", () =>
									readProjectActiveCustomerId(
										dbService.db,
										existingProject.organizationId,
										projectId,
									),
								);
				const billableDefault = yield* projectBillableDefault({
					requested: input.billableDefault,
					current: existingProject.billableDefault,
					customerId: customerForDefault,
				});
				if (billableDefault !== existingProject.billableDefault) {
					updateData.billableDefault = billableDefault;
				}

				// Validate customerId if changing to a new customer
				if (input.customerId) {
					const customerExists = yield* dbService.query("verifyCustomer", async () => {
						return await db.query.customer.findFirst({
							where: and(
								eq(customer.id, input.customerId!),
								eq(customer.organizationId, existingProject.organizationId),
								eq(customer.isActive, true),
							),
						});
					});

					if (!customerExists) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Customer not found",
								field: "customerId",
							}),
						);
					}

					yield* ensureSettingsActorCanAccessCustomerTarget(actor, customerExists, {
						message: "You do not have access to assign this customer",
						resource: "project",
						action: "update",
					});
				}

				// Update the project
				yield* dbService.query("project.update", async () => {
					const scopedProject = and(
						eq(project.id, projectId),
						eq(project.organizationId, existingProject.organizationId),
					);
					if (input.status === undefined) {
						await db.update(project).set(updateData).where(scopedProject);
						return;
					}
					// The bookable lifecycle decides manual eligibility (#315).
					await withOrganizationConfigurationMutation(
						db,
						existingProject.organizationId,
						async (tx) => {
							await tx.update(project).set(updateData).where(scopedProject);
						},
					);
				});

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.PROJECT_UPDATED,
					actorId: session.user.id,
					targetId: projectId,
					targetType: "project",
					organizationId: existingProject.organizationId,
					changes: input as Record<string, unknown>,
					metadata: { previousName: existingProject.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, input }, "Failed to update project");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const existingProject = yield* getProjectTarget(projectId, "addProjectManager:getProject");
				const actor = yield* getProjectSettingsActorContext({
					organizationId: existingProject.organizationId,
					queryName: "addProjectManager:actor",
				});
				const session = actor.session;
				const dbService = actor.dbService;

				yield* ensureSettingsActorCanManageProjectManagers(actor, existingProject, {
					message: PROJECT_MANAGER_CHANGE_DENIED,
					resource: "projectManager",
					action: "create",
				});

				const targetEmployee = yield* dbService.query(
					"project.getRelationshipEmployee",
					async () =>
						await getProjectRelationshipEmployee(employeeId, existingProject.organizationId),
				);
				if (!targetEmployee) {
					return yield* Effect.fail(
						new ValidationError({
							message: "Employee not found in this organization",
							field: "employeeId",
						}),
					);
				}

				// Check if already a manager
				const existing = yield* dbService.query("checkExisting", async () => {
					return await db.query.projectManager.findFirst({
						where: and(
							eq(projectManager.projectId, projectId),
							eq(projectManager.employeeId, employeeId),
						),
					});
				});

				if (existing) {
					yield* Effect.fail(
						new ValidationError({
							message: "This employee is already a manager of this project",
							field: "employeeId",
						}),
					);
				}

				// Add the manager
				yield* dbService.query("project.addManager", () =>
					insertProjectManagers(db, {
						projectId,
						employeeIds: [employeeId],
						assignedBy: session.user.id,
					}),
				);

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.PROJECT_MANAGER_ASSIGNED,
					actorId: session.user.id,
					targetId: projectId,
					targetType: "project",
					organizationId: existingProject.organizationId,
					employeeId,
					changes: { employeeId },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, employeeId }, "Failed to add project manager");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const existingProject = yield* getProjectTarget(
					projectId,
					"removeProjectManager:getProject",
				);
				const actor = yield* getProjectSettingsActorContext({
					organizationId: existingProject.organizationId,
					queryName: "removeProjectManager:actor",
				});
				const session = actor.session;

				yield* ensureSettingsActorCanManageProjectManagers(actor, existingProject, {
					message: PROJECT_MANAGER_CHANGE_DENIED,
					resource: "projectManager",
					action: "delete",
				});

				// Remove the manager
				const removed = yield* actor.dbService.query("project.removeManager", () =>
					db
						.delete(projectManager)
						.where(
							and(
								eq(projectManager.projectId, existingProject.id),
								eq(projectManager.employeeId, employeeId),
							),
						)
						.returning({ id: projectManager.id }),
				);
				if (removed.length === 0) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Project manager not found",
							entityType: "projectManager",
						}),
					);
				}

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.PROJECT_MANAGER_REMOVED,
					actorId: session.user.id,
					targetId: projectId,
					targetType: "project",
					organizationId: existingProject.organizationId,
					employeeId,
					changes: { employeeId },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, employeeId }, "Failed to remove project manager");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const existingProject = yield* getProjectTarget(
					projectId,
					"addProjectAssignment:getProject",
				);
				const actor = yield* getProjectSettingsActorContext({
					organizationId: existingProject.organizationId,
					queryName: "addProjectAssignment:actor",
				});
				const session = actor.session;

				yield* ensureSettingsActorCanAccessProjectTarget(actor, existingProject, {
					message: "You do not have access to update this project",
					resource: "projectAssignment",
					action: "create",
				});

				// Check if already assigned
				const existingCondition =
					type === "team"
						? and(
								eq(projectAssignment.projectId, projectId),
								eq(projectAssignment.organizationId, existingProject.organizationId),
								eq(projectAssignment.teamId, targetId),
							)
						: and(
								eq(projectAssignment.projectId, projectId),
								eq(projectAssignment.organizationId, existingProject.organizationId),
								eq(projectAssignment.employeeId, targetId),
							);

				// Add the assignment. Target validation runs under exclusive configuration
				// protection so it serializes with manual preparation (#315).
				yield* actor.dbService
					.query("project.addAssignment", () =>
						withOrganizationConfigurationMutation(
							db,
							existingProject.organizationId,
							async (tx) => {
								const assignmentTarget = await getProjectAssignmentTarget(
									type,
									targetId,
									existingProject.organizationId,
									tx,
								);
								if (!assignmentTarget) {
									throw new ValidationError({
										message: `${type === "team" ? "Team" : "Employee"} not found in this organization`,
										field: type === "team" ? "teamId" : "employeeId",
									});
								}

								const existing = await tx.query.projectAssignment.findFirst({
									where: existingCondition,
								});
								if (existing) {
									throw new ValidationError({
										message: `This ${type} is already assigned to this project`,
										field: type === "team" ? "teamId" : "employeeId",
									});
								}

								await insertProjectAssignments(tx, {
									projectId,
									organizationId: existingProject.organizationId,
									teamIds: type === "team" ? [targetId] : [],
									employeeIds: type === "employee" ? [targetId] : [],
									createdBy: session.user.id,
								});
							},
						),
					)
					.pipe(Effect.mapError(keepTypedMutationError));

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.PROJECT_ASSIGNMENT_ADDED,
					actorId: session.user.id,
					targetId: projectId,
					targetType: "project_assignment",
					organizationId: existingProject.organizationId,
					changes: { type, targetId },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, projectId, type, targetId }, "Failed to add project assignment");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					queryName: "removeProjectAssignment:actor",
				});
				const session = actor.session;
				const dbService = actor.dbService;

				// Get the assignment
				const existingAssignment = yield* dbService
					.query("getAssignment", async () => {
						return await db.query.projectAssignment.findFirst({
							where: eq(projectAssignment.id, assignmentId),
						});
					})
					.pipe(
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

				const assignmentProject = yield* getProjectTarget(
					existingAssignment.projectId,
					"removeProjectAssignment:getProject",
				);

				yield* ensureSettingsActorCanAccessProjectTarget(actor, assignmentProject, {
					message: "You do not have access to update this project",
					resource: "projectAssignment",
					action: "delete",
				});

				// Remove the assignment
				yield* dbService
					.query("project.removeAssignment", () =>
						withOrganizationConfigurationMutation(
							db,
							assignmentProject.organizationId,
							async (tx) => {
								const removed = await tx
									.delete(projectAssignment)
									.where(
										and(
											eq(projectAssignment.id, assignmentId),
											eq(projectAssignment.organizationId, assignmentProject.organizationId),
										),
									)
									.returning({ id: projectAssignment.id });
								if (removed.length === 0) {
									throw new NotFoundError({
										message: "Assignment not found",
										entityType: "projectAssignment",
									});
								}
							},
						),
					)
					.pipe(Effect.mapError(keepTypedMutationError));

				// Log audit (fire-and-forget)
				logAudit({
					action: AuditAction.PROJECT_ASSIGNMENT_REMOVED,
					actorId: session.user.id,
					targetId: existingAssignment.projectId,
					targetType: "project_assignment",
					organizationId: existingAssignment.organizationId,
					changes: {
						type: existingAssignment.assignmentType,
						teamId: existingAssignment.teamId,
						employeeId: existingAssignment.employeeId,
					},
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				revalidatePath("/settings/projects");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, assignmentId }, "Failed to remove project assignment");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId,
					queryName: "getTeamsForSelection:actor",
				});
				const dbService = actor.dbService;

				const teams = yield* dbService.query("getTeams", async () => {
					return await db.query.team.findMany({
						where: eq(team.organizationId, organizationId),
						columns: { id: true, name: true },
						orderBy: [team.name],
					});
				});

				span.setStatus({ code: SpanStatusCode.OK });
				return teams;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get teams");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
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
			return Effect.gen(function* () {
				const actor = yield* getProjectSettingsActorContext({
					organizationId,
					queryName: "getEmployeesForSelection:actor",
				});
				const dbService = actor.dbService;

				const employees = yield* dbService.query("getEmployees", async () => {
					return await db.query.employee.findMany({
						where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
						with: {
							user: {
								columns: { firstName: true, lastName: true, name: true, email: true },
							},
						},
						orderBy: (employee, { asc }) => [asc(employee.userId)],
					});
				});

				const result = employees.map((e) => ({
					id: e.id,
					name: e.user ? buildAuthUserDisplayName(e.user) || "Unknown" : "Unknown",
					role: e.role,
				}));

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to get employees");
						return yield* Effect.fail(error);
					}),
				),
				Effect.ensuring(Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}
