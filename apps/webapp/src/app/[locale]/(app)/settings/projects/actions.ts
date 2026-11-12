"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import type { db } from "@/db";
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
import {
	projectHasActiveCustomerSql,
	readProjectActiveCustomerId,
} from "@/lib/billable-time/project-customer";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { formerEmployeesAmong } from "@/lib/employee-lifecycle/current-roster-among";
import { assertOnCurrentRoster } from "@/lib/employee-lifecycle/current-roster-guard";
import { formerMark } from "@/lib/employee-lifecycle/former-since";
import { logger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import { findRecordsMissingRequiredValues } from "@/lib/organization/custom-fields/values";
import {
	insertProject,
	insertProjectAssignments,
	insertProjectManagers,
} from "@/lib/projects/project-creation";
import { revokeShareLinksAfterAccessChange } from "@/lib/projects/report-share/access-change";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
// The narrow module, not the work records index: this action needs nothing else of it.
import { clearProjectMissingTasks } from "@/lib/time-tracking/work-records/project-missing-tasks";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import {
	projectBillableDefault,
	validateBillableDefaultChange,
} from "./project-billable-default-input";
import {
	filterItemsToManagedProjects,
	getManagedProjectIdsForSettingsActor,
	loadAssignableCustomer,
	reachesCustomer,
	reachesProject,
} from "./project-scope";
import {
	customFieldValuesSchema,
	loadOrganizationProject,
	projectSettingsActorOf,
} from "./project-settings-actor";

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
	/** The project's active customer (#768); null without customer or once the customer is deleted. */
	customerId: string | null;
	customerName: string | null;
	/** The deleted customer the project still points at, for display only (#938). */
	deletedCustomerName: string | null;
	/** Whether new work on the project starts as billable work (#900). */
	billableDefault: boolean;
	/**
	 * The task requirement setting (#884). It applies only while the project has
	 * an open task: readers use `lib/projects/task-requirement*` for that.
	 */
	requiresTask: boolean;
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
		/**
		 * The assigned employee is a former employee (#1438): the list hides the
		 * assignment by default and marks it when shown. False for team assignments.
		 */
		employeeIsFormer?: boolean;
		/**
		 * On a former employee's assignment only: the organization-local date they
		 * left (`YYYY-MM-DD`), null when not recorded (#1439).
		 */
		employeeFormerSince?: string | null;
	}[];
	totalHoursBooked: number;
	/** A required custom field the viewer sees has no value (#818). */
	missingRequiredCustomFields?: boolean;
}

type ProjectWithCustomer = typeof project.$inferSelect & {
	customer: Pick<typeof customer.$inferSelect, "id" | "name" | "organizationId"> | null;
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

function getProjectRelationshipEmployee(
	employeeId: string,
	organizationId: string,
	reader: ProjectSettingsReader,
) {
	return reader.query.employee.findFirst({
		where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
		columns: { id: true },
	});
}

function getProjectAssignmentTarget(
	type: ProjectAssignmentType,
	targetId: string,
	organizationId: string,
	reader: ProjectSettingsReader,
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

const projectStatusSchema = z.enum(["planned", "active", "paused", "completed", "archived"]);

const projectFields = {
	name: z.string().trim().min(1, "Project name is required"),
	description: z.string(),
	status: projectStatusSchema,
	icon: z.string(),
	color: z.string(),
	/** Billable default (#900); only a project with a customer can have it on. */
	billableDefault: z.boolean({ error: "Invalid billable default" }),
	/** Task requirement (#884); never marks existing work. */
	requiresTask: z.boolean({ error: "Invalid task requirement" }),
	/** The dialog's custom field values (#818); required fields are enforced when present. */
	customFieldValues: customFieldValuesSchema,
};

const createProjectSchema = z.strictObject({
	name: projectFields.name,
	description: projectFields.description.optional(),
	status: projectFields.status.optional(),
	icon: projectFields.icon.optional(),
	color: projectFields.color.optional(),
	budgetHours: z.number().nonnegative().optional(),
	deadline: z.date().optional(),
	customerId: z.string().min(1).optional(),
	billableDefault: projectFields.billableDefault.optional(),
	requiresTask: projectFields.requiresTask.optional(),
	customFieldValues: projectFields.customFieldValues.optional(),
});

const projectChangesSchema = z.strictObject({
	projectId: z.string().min(1),
	name: projectFields.name.optional(),
	description: projectFields.description.optional(),
	status: projectFields.status.optional(),
	icon: projectFields.icon.optional(),
	color: projectFields.color.optional(),
	budgetHours: z.number().nonnegative().nullable().optional(),
	deadline: z.date().nullable().optional(),
	customerId: z.string().min(1).nullable().optional(),
	billableDefault: projectFields.billableDefault.optional(),
	requiresTask: projectFields.requiresTask.optional(),
	customFieldValues: projectFields.customFieldValues.optional(),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;
/** The project dialog's changes; fields left out keep their value. */
export type UpdateProjectInput = Omit<z.input<typeof projectChangesSchema>, "projectId">;
type ProjectChanges = z.output<typeof projectChangesSchema>;

const projectIdSchema = z.strictObject({ projectId: z.string().min(1) });
const projectManagerSchema = z.strictObject({
	projectId: z.string().min(1),
	employeeId: z.string().min(1),
});
const projectAssignmentSchema = z.strictObject({
	projectId: z.string().min(1),
	type: z.enum(["team", "employee"]),
	/** The team's or the employee's id. */
	targetId: z.string().min(1),
});

/**
 * Get all projects of the organization with details: an org admin's all, a
 * scoped manager's the projects they manage.
 */
export const getProjects = organizationAction(
	{ name: "projects.list", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const managedProjectIds = yield* getManagedProjectIdsForSettingsActor(projectActor);
			const dbService = yield* DatabaseService;

			const projects = yield* dbService.query("getProjects", async () => {
				return await dbService.db.query.project.findMany({
					where: eq(project.organizationId, organizationId),
					orderBy: [desc(project.createdAt)],
					with: {
						customer: {
							columns: { id: true, name: true, organizationId: true },
						},
					},
				});
			});

			const typedProjects = projects as unknown as ProjectWithCustomer[];
			const scopedProjects = filterItemsToManagedProjects(typedProjects, managedProjectIds);
			const projectIds = scopedProjects.map((p) => p.id);
			const managers = yield* dbService.query("getProjectManagers", async () => {
				return projectIds.length > 0
					? await dbService.db.query.projectManager.findMany({
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

			const assignments = yield* dbService.query("getProjectAssignments", async () => {
				return projectIds.length > 0
					? await dbService.db.query.projectAssignment.findMany({
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

			const hoursBooked = yield* dbService.query("getProjectHours", async () => {
				return projectIds.length > 0
					? await dbService.db
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

			// Billable Time (#768): a deleted customer leaves the project without customer (#938).
			const withActiveCustomer = yield* dbService.query("project.activeCustomers", async () => {
				const rows =
					projectIds.length > 0
						? await dbService.db
								.select({ id: project.id })
								.from(project)
								.where(
									and(
										inArray(project.id, projectIds),
										eq(project.organizationId, organizationId),
										projectHasActiveCustomerSql(),
									),
								)
						: [];
				return new Set(rows.map((row) => row.id));
			});

			const typedManagers = managers as unknown as ProjectManagerWithEmployee[];
			const typedAssignments = assignments as unknown as ProjectAssignmentWithRelations[];
			// Assignments of former employees are hidden by default and marked when shown
			// (#1438), with the date the employee left (#1439).
			const formerAssigneeSince = yield* dbService.query(
				"getProjectAssignments.formerAssignees",
				() =>
					formerEmployeesAmong(
						dbService.db,
						organizationId,
						typedAssignments.flatMap((assignment) =>
							assignment.employeeId ? [assignment.employeeId] : [],
						),
					),
			);
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
				const assignee =
					assignment.assignmentType === "employee" && assignment.employeeId
						? formerMark(formerAssigneeSince, assignment.employeeId)
						: { isFormer: false };
				projectAssignments.push({
					id: assignment.id,
					type: assignment.assignmentType as ProjectAssignmentType,
					teamId: assignment.teamId,
					teamName: assignment.team?.name || null,
					employeeId: assignment.employeeId,
					employeeName: assignment.employee?.user?.name || null,
					employeeIsFormer: assignee.isFormer,
					...("formerSince" in assignee ? { employeeFormerSince: assignee.formerSince } : {}),
				});
				assignmentsByProject.set(assignment.projectId, projectAssignments);
			}

			const hoursMap = new Map(
				hoursBooked.map((h) => [h.projectId, Math.round((h.totalMinutes / 60) * 100) / 100]),
			);
			const missingRequired = yield* dbService.query("customFields.projectsMissingRequired", () =>
				findRecordsMissingRequiredValues(dbService.db, {
					organizationId,
					entity: "project",
					recordIds: projectIds,
					viewer: { kind: "actor", userId: actor.userId },
				}),
			);

			return scopedProjects.map((p): ProjectWithDetails => {
				const hasActiveCustomer = withActiveCustomer.has(p.id);
				// Never name another organization's customer.
				const ownCustomer = p.customer?.organizationId === organizationId ? p.customer : null;
				return {
					id: p.id,
					organizationId: p.organizationId,
					name: p.name,
					description: p.description,
					status: p.status as ProjectStatus,
					icon: p.icon,
					color: p.color,
					budgetHours: p.budgetHours,
					deadline: p.deadline,
					customerId: hasActiveCustomer ? p.customerId : null,
					customerName: hasActiveCustomer ? (ownCustomer?.name ?? null) : null,
					deletedCustomerName: hasActiveCustomer ? null : (ownCustomer?.name ?? null),
					billableDefault: p.billableDefault,
					requiresTask: p.requiresTask,
					isActive: p.isActive,
					createdAt: p.createdAt,
					createdBy: p.createdBy,
					updatedAt: p.updatedAt,
					updatedBy: p.updatedBy,
					managers: managersByProject.get(p.id) ?? [],
					assignments: assignmentsByProject.get(p.id) ?? [],
					totalHoursBooked: hoursMap.get(p.id) || 0,
					missingRequiredCustomFields: missingRequired.has(p.id),
				};
			});
		}),
);

/**
 * Create a new project. A scoped manager becomes its project manager, so it
 * stays in their scope.
 */
export const createProject = organizationAction(
	{ name: "projects.create", requires: "scopedManager", schema: createProjectSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			const existing = yield* dbService.query("checkDuplicate", async () => {
				return await dbService.db.query.project.findFirst({
					where: and(eq(project.organizationId, organizationId), eq(project.name, input.name)),
				});
			});

			if (existing) {
				return yield* Effect.fail(
					new ValidationError({
						message: "A project with this name already exists",
						field: "name",
					}),
				);
			}

			if (input.customerId) {
				yield* loadAssignableCustomer(projectActor, input.customerId, "create");
			}

			yield* validateBillableDefaultChange(dbService, organizationId, {
				requested: input.billableDefault,
				current: false,
			});
			const billableDefault = yield* projectBillableDefault({
				requested: input.billableDefault,
				current: false,
				customerId: input.customerId || null,
			});

			const created = yield* dbService
				.query("project.create", async () => {
					return await dbService.db.transaction(async (tx) => {
						const newProject = await insertProject(tx, {
							organizationId,
							name: input.name,
							description: input.description || null,
							status: input.status || "planned",
							icon: input.icon || null,
							color: input.color || null,
							budgetHours: input.budgetHours?.toString() || null,
							deadline: input.deadline || null,
							customerId: input.customerId || null,
							billableDefault,
							requiresTask: input.requiresTask ?? false,
							createdBy: actor.userId,
						});

						if (projectActor.accessTier === "manager" && projectActor.currentEmployee) {
							await insertProjectManagers(tx, {
								projectId: newProject.id,
								employeeIds: [projectActor.currentEmployee.id],
								assignedBy: actor.userId,
							});
						}

						await saveFormCustomFieldValues(tx, {
							organizationId,
							actorUserId: actor.userId,
							entity: "project",
							recordId: newProject.id,
							values: input.customFieldValues,
						});

						return newProject;
					});
				})
				.pipe(keepCustomFieldRefusal);

			logAudit({
				action: AuditAction.PROJECT_CREATED,
				actorId: actor.userId,
				targetId: created.id,
				targetType: "project",
				organizationId,
				changes: { name: input.name, status: input.status || "planned" },
				metadata: { projectName: input.name },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/projects");
			return { id: created.id };
		}),
);

/**
 * Saves the project dialog. Its custom field values are written in the same
 * transaction, and every required custom field the actor may edit must have a
 * value afterwards, also when the dialog sent none (#818, P7).
 */
export const updateProject = organizationAction(
	{ name: "projects.update", requires: "scopedManager", schema: projectChangesSchema },
	({ actor, organizationId, input }) =>
		saveProjectChanges(actor, organizationId, input, { form: true }),
);

/**
 * Archive a project. Not a form save: required custom fields don't hold it up.
 */
export const archiveProject = organizationAction(
	{ name: "projects.archive", requires: "scopedManager", schema: projectIdSchema },
	({ actor, organizationId, input }) =>
		saveProjectChanges(
			actor,
			organizationId,
			{ projectId: input.projectId, status: "archived" },
			{ form: false },
		),
);

function saveProjectChanges(
	actor: Parameters<typeof projectSettingsActorOf>[0],
	organizationId: string,
	input: ProjectChanges,
	options: { form: boolean },
) {
	return Effect.gen(function* () {
		const { projectId, customFieldValues, ...projectChanges } = input;
		const existingProject = yield* loadOrganizationProject(organizationId, projectId);
		const projectActor = yield* projectSettingsActorOf(actor, organizationId);
		const dbService = yield* DatabaseService;

		yield* refuseUnless(yield* reachesProject(projectActor, existingProject), {
			userId: projectActor.session.user.id,
			message: "You do not have access to update this project",
			resource: "project",
			action: "update",
		});

		if (input.name && input.name !== existingProject.name) {
			const duplicate = yield* dbService.query("checkDuplicate", async () => {
				return await dbService.db.query.project.findFirst({
					where: and(eq(project.organizationId, organizationId), eq(project.name, input.name!)),
				});
			});

			if (duplicate) {
				return yield* Effect.fail(
					new ValidationError({
						message: "A project with this name already exists",
						field: "name",
					}),
				);
			}
		}

		const updateData: Partial<typeof project.$inferInsert> = {
			updatedBy: actor.userId,
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
		yield* validateBillableDefaultChange(dbService, organizationId, {
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
							readProjectActiveCustomerId(dbService.db, organizationId, projectId),
						);
		const billableDefault = yield* projectBillableDefault({
			requested: input.billableDefault,
			current: existingProject.billableDefault,
			customerId: customerForDefault,
		});
		if (billableDefault !== existingProject.billableDefault) {
			updateData.billableDefault = billableDefault;
		}
		// Whoever may edit the project may change its task requirement (#884).
		if (input.requiresTask !== undefined) updateData.requiresTask = input.requiresTask;
		// Turning it off ends every missing-task marker on the project; turning it
		// back on later restores none (#884, Projects ADR 0002). Whether this save
		// turns it off is decided inside the guarded write, from the stored row.
		const mayTurnTaskRequirementOff = input.requiresTask === false;

		if (input.customerId) {
			const customerExists = yield* dbService.query("verifyCustomer", async () => {
				return await dbService.db.query.customer.findFirst({
					where: and(
						eq(customer.id, input.customerId!),
						eq(customer.organizationId, organizationId),
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

			yield* refuseUnless(yield* reachesCustomer(projectActor, customerExists), {
				userId: projectActor.session.user.id,
				message: "You do not have access to assign this customer",
				resource: "project",
				action: "update",
			});
		}

		// Update the project, with the dialog's custom field values (#818) in the same transaction.
		const saveCustomFieldValues = async (tx: Parameters<typeof saveFormCustomFieldValues>[0]) => {
			if (!options.form) return;
			await saveFormCustomFieldValues(tx, {
				organizationId,
				actorUserId: actor.userId,
				entity: "project",
				recordId: projectId,
				values: customFieldValues,
			});
		};
		yield* dbService
			.query("project.update", async () => {
				const scopedProject = and(
					eq(project.id, projectId),
					eq(project.organizationId, organizationId),
				);
				if (input.status === undefined && !mayTurnTaskRequirementOff) {
					await dbService.db.transaction(async (tx) => {
						await tx.update(project).set(updateData).where(scopedProject);
						await saveCustomFieldValues(tx);
					});
					return;
				}
				// The bookable lifecycle decides manual eligibility (#315). The exclusive
				// guard also drains every work transaction that could still mark work
				// on this project before its markers are cleared (#884).
				await withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
					// Decided from the row this write locks, never from the read before
					// the guard: a concurrent save may have turned the requirement on.
					const [stored] = mayTurnTaskRequirementOff
						? await tx
								.select({ requiresTask: project.requiresTask })
								.from(project)
								.where(scopedProject)
								.for("no key update")
						: [];
					await tx.update(project).set(updateData).where(scopedProject);
					if (stored?.requiresTask) {
						await clearProjectMissingTasks(tx, { organizationId, projectId });
					}
					await saveCustomFieldValues(tx);
				});
			})
			.pipe(keepCustomFieldRefusal);

		logAudit({
			action: AuditAction.PROJECT_UPDATED,
			actorId: actor.userId,
			targetId: projectId,
			targetType: "project",
			organizationId,
			changes: projectChanges as Record<string, unknown>,
			metadata: { previousName: existingProject.name },
			timestamp: new Date(),
		}).catch((err) => logger.error({ err }, "Failed to log audit"));

		revalidatePath("/settings/projects");
	});
}

/**
 * Add a manager to a project. Org admins only (#367): a scoped manager may
 * manage assignments, not other managers.
 */
export const addProjectManager = organizationAction(
	{
		name: "projects.addManager",
		requires: "orgAdmin",
		schema: projectManagerSchema,
		// A former employee manages no project (#1438).
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const existingProject = yield* loadOrganizationProject(organizationId, input.projectId);
			const dbService = yield* DatabaseService;

			const targetEmployee = yield* dbService.query("project.getRelationshipEmployee", () =>
				getProjectRelationshipEmployee(input.employeeId, organizationId, dbService.db),
			);
			if (!targetEmployee) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Employee not found in this organization",
						field: "employeeId",
					}),
				);
			}

			const existing = yield* dbService.query("checkExisting", async () => {
				return await dbService.db.query.projectManager.findFirst({
					where: and(
						eq(projectManager.projectId, existingProject.id),
						eq(projectManager.employeeId, input.employeeId),
					),
				});
			});

			if (existing) {
				return yield* Effect.fail(
					new ValidationError({
						message: "This employee is already a manager of this project",
						field: "employeeId",
					}),
				);
			}

			yield* dbService.query("project.addManager", () =>
				insertProjectManagers(dbService.db, {
					projectId: existingProject.id,
					employeeIds: [input.employeeId],
					assignedBy: actor.userId,
				}),
			);

			logAudit({
				action: AuditAction.PROJECT_MANAGER_ASSIGNED,
				actorId: actor.userId,
				targetId: existingProject.id,
				targetType: "project",
				organizationId,
				employeeId: input.employeeId,
				changes: { employeeId: input.employeeId },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/projects");
		}),
);

/**
 * Remove a manager from a project. Org admins only (#367).
 */
export const removeProjectManager = organizationAction(
	{ name: "projects.removeManager", requires: "orgAdmin", schema: projectManagerSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const existingProject = yield* loadOrganizationProject(organizationId, input.projectId);
			const dbService = yield* DatabaseService;

			const removed = yield* dbService.query("project.removeManager", () =>
				dbService.db
					.delete(projectManager)
					.where(
						and(
							eq(projectManager.projectId, existingProject.id),
							eq(projectManager.employeeId, input.employeeId),
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

			logAudit({
				action: AuditAction.PROJECT_MANAGER_REMOVED,
				actorId: actor.userId,
				targetId: existingProject.id,
				targetType: "project",
				organizationId,
				employeeId: input.employeeId,
				changes: { employeeId: input.employeeId },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			// A share link stops once its creator no longer sees every project in it (#806).
			yield* dbService.query("reportShareLink.revokeAfterManagerRemoval", () =>
				revokeShareLinksAfterAccessChange(dbService.db, {
					organizationId,
					creator: { employeeId: input.employeeId },
					actorUserId: actor.userId,
				}),
			);

			revalidatePath("/settings/projects");
		}),
);

/**
 * Add an assignment to a project (team or employee).
 */
export const addProjectAssignment = organizationAction(
	{
		name: "projects.addAssignment",
		requires: "scopedManager",
		schema: projectAssignmentSchema,
		// A former employee gets no new project assignment (#1438).
		addsEmployees: (input) => (input.type === "employee" ? [input.targetId] : []),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { projectId, type, targetId } = input;
			const existingProject = yield* loadOrganizationProject(organizationId, projectId);
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			yield* refuseUnless(yield* reachesProject(projectActor, existingProject), {
				userId: projectActor.session.user.id,
				message: "You do not have access to update this project",
				resource: "projectAssignment",
				action: "create",
			});

			const existingCondition =
				type === "team"
					? and(
							eq(projectAssignment.projectId, projectId),
							eq(projectAssignment.organizationId, organizationId),
							eq(projectAssignment.teamId, targetId),
						)
					: and(
							eq(projectAssignment.projectId, projectId),
							eq(projectAssignment.organizationId, organizationId),
							eq(projectAssignment.employeeId, targetId),
						);

			// Target validation runs under exclusive configuration protection so it
			// serializes with manual preparation (#315).
			yield* dbService
				.query("project.addAssignment", () =>
					withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
						const assignmentTarget = await getProjectAssignmentTarget(
							type,
							targetId,
							organizationId,
							tx,
						);
						if (!assignmentTarget) {
							throw new ValidationError({
								message: `${type === "team" ? "Team" : "Employee"} not found in this organization`,
								field: type === "team" ? "teamId" : "employeeId",
							});
						}
						// Re-checked inside the guard: the employee may have left meanwhile (#1438).
						if (type === "employee") {
							await assertOnCurrentRoster(tx, {
								organizationId,
								employeeIds: [targetId],
								field: "employeeId",
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
							organizationId,
							teamIds: type === "team" ? [targetId] : [],
							employeeIds: type === "employee" ? [targetId] : [],
							createdBy: actor.userId,
						});
					}),
				)
				.pipe(Effect.mapError(keepTypedMutationError));

			logAudit({
				action: AuditAction.PROJECT_ASSIGNMENT_ADDED,
				actorId: actor.userId,
				targetId: projectId,
				targetType: "project_assignment",
				organizationId,
				changes: { type, targetId },
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/projects");
		}),
);

/**
 * Remove an assignment from a project.
 */
export const removeProjectAssignment = organizationAction(
	{
		name: "projects.removeAssignment",
		requires: "scopedManager",
		schema: z.strictObject({ assignmentId: z.string().min(1) }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { assignmentId } = input;
			const projectActor = yield* projectSettingsActorOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			const existingAssignment = yield* dbService.query("getAssignment", async () => {
				return await dbService.db.query.projectAssignment.findFirst({
					where: and(
						eq(projectAssignment.id, assignmentId),
						eq(projectAssignment.organizationId, organizationId),
					),
				});
			});
			if (!existingAssignment) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Assignment not found",
						entityType: "projectAssignment",
					}),
				);
			}

			const assignmentProject = yield* loadOrganizationProject(
				organizationId,
				existingAssignment.projectId,
			);

			yield* refuseUnless(yield* reachesProject(projectActor, assignmentProject), {
				userId: projectActor.session.user.id,
				message: "You do not have access to update this project",
				resource: "projectAssignment",
				action: "delete",
			});

			yield* dbService
				.query("project.removeAssignment", () =>
					withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
						const removed = await tx
							.delete(projectAssignment)
							.where(
								and(
									eq(projectAssignment.id, assignmentId),
									eq(projectAssignment.organizationId, organizationId),
								),
							)
							.returning({ id: projectAssignment.id });
						if (removed.length === 0) {
							throw new NotFoundError({
								message: "Assignment not found",
								entityType: "projectAssignment",
							});
						}
					}),
				)
				.pipe(Effect.mapError(keepTypedMutationError));

			logAudit({
				action: AuditAction.PROJECT_ASSIGNMENT_REMOVED,
				actorId: actor.userId,
				targetId: existingAssignment.projectId,
				targetType: "project_assignment",
				organizationId,
				changes: {
					type: existingAssignment.assignmentType,
					teamId: existingAssignment.teamId,
					employeeId: existingAssignment.employeeId,
				},
				timestamp: new Date(),
			}).catch((err) => logger.error({ err }, "Failed to log audit"));

			revalidatePath("/settings/projects");
		}),
);

/**
 * Get the organization's teams for selection (for the assignment dialog).
 */
export const getTeamsForSelection = organizationAction(
	{ name: "projects.teamsForSelection", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("getTeams", async () => {
				return await dbService.db.query.team.findMany({
					where: eq(team.organizationId, organizationId),
					columns: { id: true, name: true },
					orderBy: [team.name],
				});
			});
		}),
);

/**
 * Get the organization's employees for selection (for the manager/assignment dialog).
 */
export const getEmployeesForSelection = organizationAction(
	{ name: "projects.employeesForSelection", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			// The picker offers the current roster only (#1438).
			const employees = yield* dbService.query("getEmployees", async () => {
				return await dbService.db.query.employee.findMany({
					where: onCurrentRoster(organizationId),
					with: {
						user: {
							columns: { firstName: true, lastName: true, name: true, email: true },
						},
					},
					orderBy: (employee, { asc }) => [asc(employee.userId)],
				});
			});

			return employees.map((e) => ({
				id: e.id,
				name: e.user ? buildAuthUserDisplayName(e.user) || "Unknown" : "Unknown",
				role: e.role,
			}));
		}),
);
