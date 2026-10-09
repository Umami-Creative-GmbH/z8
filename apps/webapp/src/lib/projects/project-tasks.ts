import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectTask, timeRecordAllocation, workPeriod } from "@/db/schema";
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
	let candidate: unknown = error;
	for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (current.code === "23505" && current.constraint === "projectTask_project_name_unique_idx") {
			return true;
		}
		candidate = current.cause;
	}
	return false;
}
