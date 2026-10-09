"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projectTask } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import {
	ConflictError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	normalizeProjectTaskDescription,
	normalizeProjectTaskEstimate,
	normalizeProjectTaskName,
	type ProjectTaskInputProblem,
	type ProjectTaskState,
} from "@/lib/projects/project-task-rules";
import {
	findProjectTask,
	isProjectTaskBooked,
	isProjectTaskNameConflict,
	listProjectTasks,
	type ProjectTask,
} from "@/lib/projects/project-tasks";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction";
import {
	ensureSettingsActorCanManageProjectTasks,
	getProjectSettingsActorContext,
	getProjectTarget,
	type ProjectSettingsActor,
} from "./project-scope";

/**
 * Project task management (#872). Every action runs in the caller's active
 * organization and is allowed only to org admins/owners and to manager-tier
 * managers of the task's project (`ensureSettingsActorCanManageProjectTasks`).
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

const INPUT_PROBLEM_MESSAGES: Record<ProjectTaskInputProblem, { message: string; field: string }> = {
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

function validated<T>(result: { ok: true; value: T } | { ok: false; problem: ProjectTaskInputProblem }) {
	return result.ok ? Effect.succeed(result.value) : Effect.fail(inputProblem(result.problem));
}

/** Typed failures raised inside a database callback keep their type. */
function keepTypedTaskError(error: DatabaseError) {
	if (isProjectTaskNameConflict(error.cause)) {
		return new ValidationError({ message: DUPLICATE_NAME_MESSAGE, field: "name" });
	}
	return error.cause instanceof ValidationError ||
		error.cause instanceof NotFoundError ||
		error.cause instanceof ConflictError
		? error.cause
		: error;
}

function traced<A, E, R>(
	name: string,
	attributes: Record<string, string>,
	effect: Effect.Effect<A, E, R>,
) {
	return trace.getTracer("projects").startActiveSpan(name, { attributes }, (span) =>
		effect.pipe(
			Effect.tap(() => Effect.sync(() => span.setStatus({ code: SpanStatusCode.OK }))),
			Effect.catch((error) =>
				Effect.gen(function* () {
					span.recordException(error as Error);
					span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
					logger.error({ error, ...attributes }, `Failed to run ${name}`);
					return yield* Effect.fail(error);
				}),
			),
			Effect.ensuring(Effect.sync(() => span.end())),
		),
	);
}

/** The actor and the project whose tasks they may manage, or a refusal. */
function getTaskManagerForProject(projectId: string, action: string) {
	return Effect.gen(function* () {
		const actor = yield* getProjectSettingsActorContext({ queryName: `${action}:actor` });
		const targetProject = yield* getProjectTarget(projectId, `${action}:getProject`);
		yield* ensureSettingsActorCanManageProjectTasks(actor, targetProject, {
			message: TASK_ACCESS_DENIED,
			resource: "project_task",
			action,
		});
		return { actor, targetProject };
	});
}

/** The actor and an existing task of their organization they may manage. */
function getTaskManagerForTask(taskId: string, action: string) {
	return Effect.gen(function* () {
		const actor = yield* getProjectSettingsActorContext({ queryName: `${action}:actor` });
		const task = yield* actor.dbService.query(`${action}:getTask`, () =>
			findProjectTask({ organizationId: actor.organizationId, taskId }),
		);
		if (!task) {
			return yield* Effect.fail(
				new NotFoundError({ message: "Task not found", entityType: "project_task", entityId: taskId }),
			);
		}
		const targetProject = yield* getProjectTarget(task.projectId, `${action}:getProject`);
		yield* ensureSettingsActorCanManageProjectTasks(actor, targetProject, {
			message: TASK_ACCESS_DENIED,
			resource: "project_task",
			action,
		});
		return { actor, task };
	});
}

function auditTask(
	actor: ProjectSettingsActor,
	action: AuditAction,
	task: Pick<ProjectTask, "id" | "projectId" | "name">,
	changes?: Record<string, unknown>,
) {
	logAudit({
		action,
		actorId: actor.session.user.id,
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
		traced(
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
		traced(
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
								createdBy: actor.session.user.id,
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
		traced(
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
							.set({ ...changes, updatedBy: actor.session.user.id })
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
		// booking preparation like other bookability changes (#315).
		yield* actor.dbService.query(`projectTask.${action}`, () =>
			withOrganizationConfigurationMutation(db, actor.organizationId, (tx) =>
				tx
					.update(projectTask)
					.set(
						state === "done"
							? { state, doneAt: now, doneBy: actor.session.user.id }
							: { state, doneAt: null, doneBy: null },
					)
					.where(
						and(
							eq(projectTask.id, task.id),
							eq(projectTask.organizationId, actor.organizationId),
						),
					),
			),
		);
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
		traced("markProjectTaskDone", { "task.id": taskId }, setProjectTaskState(taskId, "done")),
	);
}

/** Reopens a done task so it takes bookings again. */
export async function reopenProjectTask(taskId: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		traced("reopenProjectTask", { "task.id": taskId }, setProjectTaskState(taskId, "open")),
	);
}

/** Deletes a task; refused while anything is booked to it. */
export async function deleteProjectTask(taskId: string): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		traced(
			"deleteProjectTask",
			{ "task.id": taskId },
			Effect.gen(function* () {
				const { actor, task } = yield* getTaskManagerForTask(taskId, "delete");
				yield* actor.dbService
					.query("projectTask.delete", () =>
						withOrganizationConfigurationMutation(db, actor.organizationId, async (tx) => {
							if (await isProjectTaskBooked(task, tx)) {
								throw new ConflictError({
									message: "Time is booked to this task, so it cannot be deleted",
									conflictType: "project_task_booked",
								});
							}
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
