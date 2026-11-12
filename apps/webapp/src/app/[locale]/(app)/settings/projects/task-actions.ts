"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { projectTask } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import {
	ConflictError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import {
	canManageProjectTasks,
	listProjectsWithManageableTasks,
	type ProjectTaskManager,
} from "@/lib/projects/project-task-permission";
import {
	normalizeProjectTaskDescription,
	normalizeProjectTaskEstimate,
	normalizeProjectTaskName,
	PROJECT_TASK_STATES,
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

/**
 * Project task management (#872). Every action runs in the session's active
 * organization and needs settings access `member`; inside it, only org owners
 * and admins and that project's managers, whatever their employee role, may
 * manage a project's tasks (`canManageProjectTasks`).
 */

const taskId = z.string().min(1, "Task is required");
const projectId = z.string().min(1, "Project is required");
const taskName = z.string({ error: "Task name is required" });
const taskDescription = z.string().nullable().optional();
/** Hours; null or omitted = no estimate. */
const taskEstimate = z.number({ error: "Invalid task estimate" }).nullable().optional();

const createProjectTaskSchema = z.strictObject({
	projectId,
	name: taskName,
	description: taskDescription,
	estimateHours: taskEstimate,
});

const updateProjectTaskSchema = z.strictObject({
	taskId,
	name: taskName.optional(),
	description: taskDescription,
	estimateHours: taskEstimate,
});

export type CreateProjectTaskInput = z.input<typeof createProjectTaskSchema>;
export type UpdateProjectTaskInput = z.input<typeof updateProjectTaskSchema>;

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
	return new ValidationError({ ...INPUT_PROBLEM_MESSAGES[problem], refusal: problem });
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
		return new ValidationError({
			message: DUPLICATE_NAME_MESSAGE,
			field: "name",
			refusal: "duplicate_name",
		});
	}
	// A booking's foreign key refusing the delete is a booked task too.
	if (isProjectTaskBookingReference(error.cause)) return taskBooked();
	return error.cause instanceof ValidationError ||
		error.cause instanceof NotFoundError ||
		error.cause instanceof ConflictError
		? error.cause
		: error;
}

/** The actor as a potential task manager (#872): org admins manage every project. */
function taskManagerOf(actor: OrganizationActor, organizationId: string): ProjectTaskManager {
	return {
		userId: actor.userId,
		organizationId,
		isOrgAdmin: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
	};
}

/** Whether the actor may manage the tasks of this project of their organization. */
function managesTasksOf(manager: ProjectTaskManager, projectId: string, action: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query(`projectTask.${action}:permission`, () =>
			canManageProjectTasks(manager, projectId),
		);
	});
}

/** What `refuseUnless` reports when the actor may not manage a project's tasks. */
function taskRefusal(manager: ProjectTaskManager, action: string) {
	return { userId: manager.userId, message: TASK_ACCESS_DENIED, resource: "project_task", action };
}

/** An existing task of the session's organization whose project the actor may manage. */
function manageableTask(manager: ProjectTaskManager, taskId: string, action: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const task = yield* dbService.query(`projectTask.${action}:getTask`, () =>
			findProjectTask({ organizationId: manager.organizationId, taskId }),
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
		yield* refuseUnless(
			yield* managesTasksOf(manager, task.projectId, action),
			taskRefusal(manager, action),
		);
		return task;
	});
}

function auditTask(
	manager: ProjectTaskManager,
	action: AuditAction,
	task: Pick<ProjectTask, "id" | "projectId" | "name">,
	changes?: Record<string, unknown>,
) {
	logAudit({
		action,
		actorId: manager.userId,
		targetId: task.id,
		targetType: "project_task",
		organizationId: manager.organizationId,
		changes,
		metadata: { projectId: task.projectId, taskName: task.name },
		timestamp: new Date(),
	}).catch((err) => logger.error({ err }, "Failed to log audit"));
}

/** The tasks of one project, for the project settings task list. */
export const getProjectTasks = organizationAction(
	{
		name: "projectTask.list",
		requires: "member",
		schema: z.strictObject({ projectId, state: z.enum(PROJECT_TASK_STATES).optional() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const manager = taskManagerOf(actor, organizationId);
			yield* refuseUnless(
				yield* managesTasksOf(manager, input.projectId, "read"),
				taskRefusal(manager, "read"),
			);
			const dbService = yield* DatabaseService;
			return yield* dbService.query("projectTask.list", () =>
				listProjectTasks(
					{ organizationId, projectId: input.projectId },
					input.state ? { state: input.state } : {},
				),
			);
		}),
);

export const createProjectTask = organizationAction(
	{ name: "projectTask.create", requires: "member", schema: createProjectTaskSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const manager = taskManagerOf(actor, organizationId);
			yield* refuseUnless(
				yield* managesTasksOf(manager, input.projectId, "create"),
				taskRefusal(manager, "create"),
			);
			const name = yield* validated(normalizeProjectTaskName(input.name));
			const description = yield* validated(normalizeProjectTaskDescription(input.description));
			const estimateHours = yield* validated(normalizeProjectTaskEstimate(input.estimateHours));

			const dbService = yield* DatabaseService;
			const [created] = yield* dbService
				.query("projectTask.create", () =>
					dbService.db
						.insert(projectTask)
						.values({
							organizationId,
							projectId: input.projectId,
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
				manager,
				AuditAction.PROJECT_TASK_CREATED,
				{ id: created.id, projectId: input.projectId, name },
				{ name, description, estimateHours },
			);
			revalidatePath("/settings/projects");
			return { id: created.id };
		}),
);

/** Renames a task or edits its description or estimate. */
export const updateProjectTask = organizationAction(
	{ name: "projectTask.update", requires: "member", schema: updateProjectTaskSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const manager = taskManagerOf(actor, organizationId);
			const task = yield* manageableTask(manager, input.taskId, "update");
			const changes: Partial<typeof projectTask.$inferInsert> = {};
			if (input.name !== undefined) {
				changes.name = yield* validated(normalizeProjectTaskName(input.name));
			}
			if (input.description !== undefined) {
				changes.description = yield* validated(normalizeProjectTaskDescription(input.description));
			}
			if (input.estimateHours !== undefined) {
				changes.estimateHours = yield* validated(normalizeProjectTaskEstimate(input.estimateHours));
			}
			if (Object.keys(changes).length === 0) return;

			const dbService = yield* DatabaseService;
			yield* dbService
				.query("projectTask.update", () =>
					dbService.db
						.update(projectTask)
						.set({ ...changes, updatedBy: actor.userId })
						.where(
							and(eq(projectTask.id, task.id), eq(projectTask.organizationId, organizationId)),
						),
				)
				.pipe(Effect.mapError(keepTypedTaskError));

			auditTask(manager, AuditAction.PROJECT_TASK_UPDATED, task, changes);
			revalidatePath("/settings/projects");
		}),
);

function setProjectTaskState(manager: ProjectTaskManager, taskId: string, state: ProjectTaskState) {
	const action = state === "done" ? "markDone" : "reopen";
	return Effect.gen(function* () {
		const task = yield* manageableTask(manager, taskId, action);
		const dbService = yield* DatabaseService;
		const { organizationId } = manager;
		const now = new Date();
		// Done tasks take no new bookings (#873), so the change serializes with
		// booking preparation like other bookability changes (#315). A task already
		// in the state is left alone, keeping who finished it first and when.
		const changed = yield* dbService.query(`projectTask.${action}`, () =>
			withOrganizationConfigurationMutation(dbService.db, organizationId, (tx) =>
				tx
					.update(projectTask)
					.set(
						state === "done"
							? { state, doneAt: now, doneBy: manager.userId }
							: { state, doneAt: null, doneBy: null },
					)
					.where(
						and(
							eq(projectTask.id, task.id),
							eq(projectTask.organizationId, organizationId),
							eq(projectTask.state, state === "done" ? "open" : "done"),
						),
					)
					.returning({ id: projectTask.id }),
			),
		);
		if (changed.length === 0) return;
		auditTask(
			manager,
			state === "done" ? AuditAction.PROJECT_TASK_DONE : AuditAction.PROJECT_TASK_REOPENED,
			task,
			{ state: { from: task.state, to: state } },
		);
		revalidatePath("/settings/projects");
	});
}

/** Marks a task done: it keeps its bookings and takes no new ones. */
export const markProjectTaskDone = organizationAction(
	{ name: "projectTask.markDone", requires: "member", schema: taskId },
	({ actor, organizationId, input }) =>
		setProjectTaskState(taskManagerOf(actor, organizationId), input, "done"),
);

/** Reopens a done task so it takes bookings again. */
export const reopenProjectTask = organizationAction(
	{ name: "projectTask.reopen", requires: "member", schema: taskId },
	({ actor, organizationId, input }) =>
		setProjectTaskState(taskManagerOf(actor, organizationId), input, "open"),
);

/** Deletes a task; refused while anything is booked to it. */
export const deleteProjectTask = organizationAction(
	{ name: "projectTask.delete", requires: "member", schema: taskId },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const manager = taskManagerOf(actor, organizationId);
			const task = yield* manageableTask(manager, input, "delete");
			const dbService = yield* DatabaseService;
			yield* dbService
				.query("projectTask.delete", () =>
					withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
						// The row lock waits for any booking that holds the task, so the
						// check below sees it once that booking commits.
						await tx
							.select({ id: projectTask.id })
							.from(projectTask)
							.where(
								and(eq(projectTask.id, task.id), eq(projectTask.organizationId, organizationId)),
							)
							.for("update");
						if (await isProjectTaskBooked(task, tx)) throw taskBooked();
						await tx
							.delete(projectTask)
							.where(
								and(eq(projectTask.id, task.id), eq(projectTask.organizationId, organizationId)),
							);
					}),
				)
				.pipe(Effect.mapError(keepTypedTaskError));

			auditTask(manager, AuditAction.PROJECT_TASK_DELETED, task);
			revalidatePath("/settings/projects");
		}),
);

/**
 * The projects whose tasks the caller may manage: every project for org
 * owners/admins, otherwise the projects they manage. Feeds the task-only view
 * that project managers without project settings access see.
 */
export const getProjectsWithManageableTasks = organizationAction(
	{ name: "projectTask.listProjects", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("projectTask.listProjects", () =>
				listProjectsWithManageableTasks(taskManagerOf(actor, organizationId)),
			);
		}),
);
