import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectTask, timeRecordAllocation, workPeriod } from "@/db/schema";
import { isConstraintViolation } from "./constraint-violation";
import type { ProjectTask, ProjectTaskState } from "./project-task-model";

/**
 * Project task reads (#872). Every read is scoped by organization and
 * project; later slices (booking #873, pickers #874, reports, templates #878)
 * reuse these instead of querying `project_task` directly.
 */

export type { ProjectTask, ProjectTaskState } from "./project-task-model";

export type ProjectTaskReader = Pick<typeof db, "select">;

const projectTaskColumns = {
	id: projectTask.id,
	organizationId: projectTask.organizationId,
	projectId: projectTask.projectId,
	name: projectTask.name,
	description: projectTask.description,
	estimateHours: projectTask.estimateHours,
	state: projectTask.state,
	doneAt: projectTask.doneAt,
	doneBy: projectTask.doneBy,
	createdAt: projectTask.createdAt,
	updatedAt: projectTask.updatedAt,
};

/**
 * A project's tasks, open tasks first, then by name. Pass `state` to read
 * only open or only done tasks. A protected operation passes its transaction.
 */
export async function listProjectTasks(
	scope: { organizationId: string; projectId: string },
	options: { state?: ProjectTaskState } = {},
	reader: ProjectTaskReader = db,
): Promise<ProjectTask[]> {
	return reader
		.select(projectTaskColumns)
		.from(projectTask)
		.where(
			and(
				eq(projectTask.organizationId, scope.organizationId),
				eq(projectTask.projectId, scope.projectId),
				options.state ? eq(projectTask.state, options.state) : undefined,
			),
		)
		.orderBy(asc(projectTask.state), asc(sql`lower(${projectTask.name})`), asc(projectTask.id));
}

/** A task as clients offer it for booking (#875). */
export type OfferedProjectTask = Pick<ProjectTask, "id" | "name">;

/**
 * The open tasks of several projects of one organization, by name, keyed by
 * project; every given project has an entry, empty when it has no open task.
 * Clients offer exactly these for an eligible project, which is what booking accepts.
 */
export async function listOpenTasksByProject(
	scope: { organizationId: string; projectIds: readonly string[] },
	reader: ProjectTaskReader = db,
): Promise<Map<string, OfferedProjectTask[]>> {
	const byProject = new Map<string, OfferedProjectTask[]>(
		scope.projectIds.map((projectId) => [projectId, []]),
	);
	if (byProject.size === 0) return byProject;
	const rows = await reader
		.select({ id: projectTask.id, name: projectTask.name, projectId: projectTask.projectId })
		.from(projectTask)
		.where(
			and(
				eq(projectTask.organizationId, scope.organizationId),
				inArray(projectTask.projectId, [...byProject.keys()]),
				eq(projectTask.state, "open"),
			),
		)
		.orderBy(asc(sql`lower(${projectTask.name})`), asc(projectTask.id));
	for (const { projectId, id, name } of rows) byProject.get(projectId)?.push({ id, name });
	return byProject;
}

/** One task of the organization, or null when it does not exist there. */
export async function findProjectTask(
	scope: { organizationId: string; taskId: string },
	reader: ProjectTaskReader = db,
): Promise<ProjectTask | null> {
	const [task] = await reader
		.select(projectTaskColumns)
		.from(projectTask)
		.where(
			and(eq(projectTask.id, scope.taskId), eq(projectTask.organizationId, scope.organizationId)),
		)
		.limit(1);
	return task ?? null;
}

/**
 * Whether anything is booked to the task: live or completed work, deleted work
 * included. A booked task cannot be deleted; the task foreign keys of the
 * project allocation and the work period enforce the same rule.
 */
export async function isProjectTaskBooked(
	task: Pick<ProjectTask, "id" | "organizationId">,
	reader: ProjectTaskReader = db,
): Promise<boolean> {
	const [allocation] = await reader
		.select({ id: timeRecordAllocation.id })
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.organizationId, task.organizationId),
				eq(timeRecordAllocation.taskId, task.id),
			),
		)
		.limit(1);
	if (allocation) return true;
	const [period] = await reader
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(and(eq(workPeriod.organizationId, task.organizationId), eq(workPeriod.taskId, task.id)))
		.limit(1);
	return period !== undefined;
}

/** Whether a write failed because the project already has a task of that name. */
export function isProjectTaskNameConflict(error: unknown): boolean {
	return isConstraintViolation(error, "23505", "projectTask_project_name_unique_idx");
}

/** Whether a task delete failed because a booking still references the task. */
export function isProjectTaskBookingReference(error: unknown): boolean {
	return isConstraintViolation(error, "23503", ["timeRecordAllocation_task_fk", "workPeriod_task_fk"]);
}
