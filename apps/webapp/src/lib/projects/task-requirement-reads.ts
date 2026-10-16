import "server-only";

import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { project, projectTask } from "@/db/schema";

/**
 * The active task requirement (#884) read from the database: the SQL twin of
 * `isTaskRequirementActive` in `./task-requirement`. A project's requirement
 * is active when it requires a task AND has at least one open task of its own
 * organization. Every read is scoped by organization; a project of another
 * organization never has an active requirement here.
 */

export type TaskRequirementReader = Pick<typeof db, "select">;

// Aliased, so the rule can sit inside any query, also one that selects from
// `project` itself, without its columns binding to the outer row.
const requiringProject = alias(project, "task_requirement_project");
const openTask = alias(projectTask, "task_requirement_open_task");

/**
 * Whether the given project's task requirement is active, as a boolean SQL
 * expression for any query: pass the booking's or project's columns, e.g.
 * `{ projectId: workPeriod.projectId, organizationId: workPeriod.organizationId }`,
 * or plain values. A null project id is false.
 */
export function activeTaskRequirementSql(target: {
	projectId: AnyPgColumn | SQL | string;
	organizationId: AnyPgColumn | SQL | string;
}): SQL<boolean> {
	// Nested once: in a single-table select list Drizzle drops the table name of
	// top-level column chunks, which would rebind them inside the subqueries.
	return sql<boolean>`${sql`exists (
		select 1 from ${project} ${requiringProject}
		where ${requiringProject.id} = ${target.projectId}
			and ${requiringProject.organizationId} = ${target.organizationId}
			and ${requiringProject.requiresTask}
			and exists (
				select 1 from ${projectTask} ${openTask}
				where ${openTask.organizationId} = ${requiringProject.organizationId}
					and ${openTask.projectId} = ${requiringProject.id}
					and ${openTask.state} = 'open'
			)
	)`}`;
}

/** Whether one project of the organization has an active task requirement. */
export async function readActiveTaskRequirement(
	scope: { organizationId: string; projectId: string },
	reader: TaskRequirementReader = db,
): Promise<boolean> {
	const active = await listActiveTaskRequirements(
		{ organizationId: scope.organizationId, projectIds: [scope.projectId] },
		reader,
	);
	return active.has(scope.projectId);
}

/** The projects among `projectIds` of the organization whose task requirement is active. */
export async function listActiveTaskRequirements(
	scope: { organizationId: string; projectIds: readonly string[] },
	reader: TaskRequirementReader = db,
): Promise<Set<string>> {
	const projectIds = [...new Set(scope.projectIds)];
	if (projectIds.length === 0) return new Set();
	const rows = await reader
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.organizationId, scope.organizationId),
				inArray(project.id, projectIds),
				activeTaskRequirementSql({ projectId: project.id, organizationId: project.organizationId }),
			),
		);
	return new Set(rows.map((row) => row.id));
}
