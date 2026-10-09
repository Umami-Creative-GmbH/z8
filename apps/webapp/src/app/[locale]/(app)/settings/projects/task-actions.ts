"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projectTask } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import {
	AuthorizationError,
	ConflictError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import {
	canManageProjectTasks,
	listProjectsWithManageableTasks,
	loadProjectTaskManager,
	type ProjectTaskManager,
	type TaskManagedProject,
} from "@/lib/projects/project-task-permission";
import {
	normalizeProjectTaskDescription,
	normalizeProjectTaskEstimate,
	normalizeProjectTaskName,
	type ProjectTaskInputProblem,
	type ProjectTaskState,
} from "@/lib/projects/project-task-model";
import {
	findProjectTask,
	isProjectTaskBooked,
	isProjectTaskBookingReference,
	isProjectTaskNameConflict,
	listProjectTasks,
	type ProjectTask,
} from "@/lib/projects/project-tasks";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import { tracedProjectAction } from "./traced-project-action";

/**
 * Project task management (#872). Every action runs in the caller's active
 * organization and is allowed only to org owners/admins and to that project's
 * managers, whatever their employee role (`canManageProjectTasks`).
 */

export interface CreateProjectTaskInput {
	projectId: string;
	name: string;
	description?: string | null;
	/** Hours; null or omitted = no estimate. */
	estimateHours?: number | null;
}

export interface UpdateProjectTaskInput {
	name?: string;
	description?: string | null;
	estimateHours?: number | null;
}

const DUPLICATE_NAME_MESSAGE = "A task with this name already exists in this project";
const TASK_ACCESS_DENIED = "You do not have access to manage tasks of this project";

const INPUT_PROBLEM_MESSAGES: Record<ProjectTaskInputProblem, { message: string; field: string }> =
	{
		nameRequired: { message: "Task name is required", field: "name" },
		nameTooLong: { message: "Task name is too long", field: "name" },
		descriptionTooLong: { message: "Task description is too long", field: "description" },
		estimateInvalid: {
			message: "Task estimate must be a positive number of hours",
			field: "estimateHours",
		},
	};

function inputProblem(problem: ProjectTaskInputProblem) {
	return new ValidationError(INPUT_PROBLEM_MESSAGES[problem]);
}

function validated<T>(
	result: { ok: true; value: T } | { ok: false; problem: ProjectTaskInputProblem },
) {
	return result.ok ? Effect.succeed(result.value) : Effect.fail(inputProblem(result.problem));
}

function taskBooked() {
	return new ConflictError({
		message: "Time is booked to this task, so it cannot be deleted",
		conflictType: "project_task_booked",
	});
}

/** Typed failures raised inside a database callback keep their type. */
function keepTypedTaskError(error: DatabaseError) {
	if (isProjectTaskNameConflict(error.cause)) {
		return new ValidationError({ message: DUPLICATE_NAME_MESSAGE, field: "name" });
	}
	// A booking's foreign key refusing the delete is a booked task too.
	if (isProjectTaskBookingReference(error.cause)) return taskBooked();
	return error.cause instanceof ValidationError ||
		error.cause instanceof NotFoundError ||
		error.cause instanceof ConflictError
		? error.cause
		: error;
}

/** The caller in their active organization, as a potential task manager. */
function getTaskActor(action: string) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const userId = session.user.id;
		const organizationId = session.session.activeOrganizationId;
		const manager = organizationId
			? yield* dbService.query(`${action}:manager`, () =>
					loadProjectTaskManager({ userId, organizationId }),
				)
			: null;
		if (!organizationId || !manager) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "No organization access",
					userId,
					resource: "project_task",
					action,
				}),
			);
		}
		const actor: TaskActor = { userId, organizationId, manager, dbService };
		return actor;
	});
}

interface TaskActor {
	userId: string;
	organizationId: string;
	manager: ProjectTaskManager;
	dbService: {
		query: <T>(name: string, fn: () => Promise<T>) => Effect.Effect<T, DatabaseError>;
	};
}

/** Refuses unless the actor may manage the tasks of this project of their organization. */
function ensureCanManageTasksOf(actor: TaskActor, projectId: string, action: string) {
	return Effect.gen(function* () {
		const allowed = yield* actor.dbService.query(`${action}:permission`, () =>
			canManageProjectTasks(actor.manager, projectId),
		);
		if (!allowed) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: TASK_ACCESS_DENIED,
					userId: actor.userId,
					resource: "project_task",
					action,
				}),
			);
		}
	});
}

/** The actor and the project whose tasks they may manage, or a refusal. */
function getTaskManagerForProject(projectId: string, action: string) {
	return Effect.gen(function* () {
		const actor = yield* getTaskActor(action);
		yield* ensureCanManageTasksOf(actor, projectId, action);
		return { actor, targetProject: { id: projectId } };
	});
}

/** The actor and an existing task of their organization they may manage. */
function getTaskManagerForTask(taskId: string, action: string) {
	return Effect.gen(function* () {
		const actor = yield* getTaskActor(action);
		const task = yield* actor.dbService.query(`${action}:getTask`, () =>
			findProjectTask({ organizationId: actor.organizationId, taskId }),
		);
		if (!task) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Task not found",
					entityType: "project_task",
					entityId: taskId,
				}),
			);
		}
		yield* ensureCanManageTasksOf(actor, task.projectId, action);
		return { actor, task };
	});
}

function auditTask(
	actor: TaskActor,
	action: AuditAction,
	task: Pick<ProjectTask, "id" | "projectId" | "name">,
	changes?: Record<string, unknown>,
) {
	logAudit({
		action,
		actorId: actor.userId,
		targetId: task.id,
		targetType: "project_task",
		organizationId: actor.organizationId,
		changes,
		metadata: { projectId: task.projectId, taskName: task.name },
		timestamp: new Date(),
	}).catch((err) => logger.error({ err }, "Failed to log audit"));
}

/** The tasks of one project, for the project settings task list. */
export async function getProjectTasks(
	projectId: string,
	options: { state?: ProjectTaskState } = {},
): Promise<ServerActionResult<ProjectTask[]>> {
	return runServerActionSafe(
		tracedProjectAction(
			"getProjectTasks",
			{ "project.id": projectId },
			Effect.gen(function* () {
				const { actor, targetProject } = yield* getTaskManagerForProject(projectId, "read");
				return yield* actor.dbService.query("getProjectTasks", () =>
					listProjectTasks(
						{ organizationId: actor.organizationId, projectId: targetProject.id },
						options,
					),
				);
			}),
		),
	);
}

export async function createProjectTask(
	input: CreateProjectTaskInput,
): Promise<ServerActionResult<{ id: string }>> {
	return runServerActionSafe(
		tracedProjectAction(
			"createProjectTask",
			{ "project.id": input.projectId },
			Effect.gen(function* () {
				const { actor, targetProject } = yield* getTaskManagerForProject(input.projectId, "create");
				const name = yield* validated(normalizeProjectTaskName(input.name));
				const description = yield* validated(normalizeProjectTaskDescription(input.description));
				const estimateHours = yield* validated(normalizeProjectTaskEstimate(input.estimateHours));

				const [created] = yield* actor.dbService
					.query("projectTask.create", () =>
						db
							.insert(projectTask)
							.values({
								organizationId: actor.organizationId,
								projectId: targetProject.id,
								name,
								description,
								estimateHours,
								createdBy: actor.userId,
								updatedAt: new Date(),
							})
							.returning({ id: projectTask.id }),
					)
					.pipe(Effect.mapError(keepTypedTaskError));

				auditTask(
					actor,
					AuditAction.PROJECT_TASK_CREATED,
					{ id: created.id, projectId: targetProject.id, name },
					{ name, description, estimateHours },
				);
				revalidatePath("/settings/projects");
				return { id: created.id };
			}),
		),
	);
}

/** Renames a task or edits its description or estimate. */
export async function updateProjectTask(
	taskId: string,
	input: UpdateProjectTaskInput,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		tracedProjectAction(
			"updateProjectTask",
			{ "task.id": taskId },
			Effect.gen(function* () {
				const { actor, task } = yield* getTaskManagerForTask(taskId, "update");
				const changes: Partial<typeof projectTask.$inferInsert> = {};
				if (input.name !== undefined) {
					changes.name = yield* validated(normalizeProjectTaskName(input.name));
				}
				if (input.description !== undefined) {
					changes.description = yield* validated(
						normalizeProjectTaskDescription(input.description),
					);
				}
				if (input.estimateHours !== undefined) {
					changes.estimateHours = yield* validated(
						normalizeProjectTaskEstimate(input.estimateHours),
					);
				}
				if (Object.keys(changes).length === 0) return;

				yield* actor.dbService
					.query("projectTask.update", () =>
						db
							.update(projectTask)
							.set({ ...changes, updatedBy: actor.userId })
							.where(
								and(
									eq(projectTask.id, task.id),
									eq(projectTask.organizationId, actor.organizationId),
								),
							),
					)
					.pipe(Effect.mapError(keepTypedTaskError));

				auditTask(actor, AuditAction.PROJECT_TASK_UPDATED, task, changes);
				revalidatePath("/settings/projects");
			}),
		),
	);
}

function setProjectTaskState(taskId: string, state: ProjectTaskState) {
	const action = state === "done" ? "markDone" : "reopen";
	return Effect.gen(function* () {
		const { actor, task } = yield* getTaskManagerForTask(taskId, action);
		const now = new Date();
		// Done tasks take no new bookings (#873), so the change serializes with
		// booking preparation like other bookability changes (#315). A task already
		// in the state is left alone, keeping who finished it first and when.
		const changed = yield* actor.dbService.query(`projectTask.${action}`, () =>
			withOrganizationConfigurationMutation(db, actor.organizationId, (tx) =>
				tx
					.update(projectTask)
					.set(
						state === "done"
							? { state, doneAt: now, doneBy: actor.userId }
							: { state, doneAt: null, doneBy: null },
					)
					.where(
						and(
							eq(projectTask.id, task.id),
							eq(projectTask.organizationId, actor.organizationId),
							eq(projectTask.state, state === "done" ? "open" : "done"),
						),
					)
					.returning({ id: projectTask.id }),
			),
		);
		if (changed.length === 0) return;
		auditTask(
			actor,
			state === "done" ? AuditAction.PROJECT_TASK_DONE : AuditAction.PROJECT_TASK_REOPENED,
			task,
			{ state: { from: task.state, to: state } },
		);
		revalidatePath("/settings/projects");
	});
}

/** Marks a task done: it keeps its bookings and takes no new ones. */
export async function markProjectTaskDone(taskId: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		tracedProjectAction(
			"markProjectTaskDone",
			{ "task.id": taskId },
			setProjectTaskState(taskId, "done"),
		),
	);
}

/** Reopens a done task so it takes bookings again. */
export async function reopenProjectTask(taskId: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		tracedProjectAction(
			"reopenProjectTask",
			{ "task.id": taskId },
			setProjectTaskState(taskId, "open"),
		),
	);
}

/** Deletes a task; refused while anything is booked to it. */
export async function deleteProjectTask(taskId: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		tracedProjectAction(
			"deleteProjectTask",
			{ "task.id": taskId },
			Effect.gen(function* () {
				const { actor, task } = yield* getTaskManagerForTask(taskId, "delete");
				yield* actor.dbService
					.query("projectTask.delete", () =>
						withOrganizationConfigurationMutation(db, actor.organizationId, async (tx) => {
							// The row lock waits for any booking that holds the task, so the
							// check below sees it once that booking commits.
							await tx
								.select({ id: projectTask.id })
								.from(projectTask)
								.where(
									and(
										eq(projectTask.id, task.id),
										eq(projectTask.organizationId, actor.organizationId),
									),
								)
								.for("update");
							if (await isProjectTaskBooked(task, tx)) throw taskBooked();
							await tx
								.delete(projectTask)
								.where(
									and(
										eq(projectTask.id, task.id),
										eq(projectTask.organizationId, actor.organizationId),
									),
								);
						}),
					)
					.pipe(Effect.mapError(keepTypedTaskError));

				auditTask(actor, AuditAction.PROJECT_TASK_DELETED, task);
				revalidatePath("/settings/projects");
			}),
		),
	);
}

/**
 * The projects whose tasks the caller may manage: every project for org
 * owners/admins, otherwise the projects they manage. Feeds the task-only view
 * that project managers without project settings access see.
 */
export async function getProjectsWithManageableTasks(): Promise<
	ServerActionResult<TaskManagedProject[]>
> {
	return runServerActionSafe(
		tracedProjectAction(
			"getProjectsWithManageableTasks",
			{},
			Effect.gen(function* () {
				const actor = yield* getTaskActor("listProjects");
				return yield* actor.dbService.query("listProjectsWithManageableTasks", () =>
					listProjectsWithManageableTasks(actor.manager),
				);
			}),
		),
	);
}
