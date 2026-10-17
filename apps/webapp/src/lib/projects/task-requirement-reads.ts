import "server-only";

import { and, eq, exists, inArray, sql } from "drizzle-orm";
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

export type TaskRequirementReadOptions = {
	/**
	 * `share` reads the project row `FOR SHARE`, so a concurrent change of its
	 * setting waits for the caller's transaction to end, or the read waits for
	 * that change and sees its result (the missing-task marker of a closure).
	 */
	lock?: "share";
};

/** Whether one project of the organization has an active task requirement. */
export async function readActiveTaskRequirement(
	scope: { organizationId: string; projectId: string },
	reader: TaskRequirementReader = db,
	options: TaskRequirementReadOptions = {},
): Promise<boolean> {
	const query = activeRequirementQuery(reader, scope.organizationId, [scope.projectId]).limit(1);
	const rows = await (options.lock ? query.for(options.lock, { of: project }) : query);
	return rows.length > 0;
}

/** The projects among `projectIds` of the organization whose task requirement is active. */
export async function listActiveTaskRequirements(
	scope: { organizationId: string; projectIds: readonly string[] },
	reader: TaskRequirementReader = db,
): Promise<Set<string>> {
	const projectIds = [...new Set(scope.projectIds)];
	if (projectIds.length === 0) return new Set();
	const rows = await activeRequirementQuery(reader, scope.organizationId, projectIds);
	return new Set(rows.map((row) => row.id));
}

function activeRequirementQuery(
	reader: TaskRequirementReader,
	organizationId: string,
	projectIds: readonly string[],
) {
	return reader
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.organizationId, organizationId),
				inArray(project.id, [...projectIds]),
				eq(project.requiresTask, true),
				exists(
					reader
						.select({ one: sql`1` })
						.from(projectTask)
						.where(
							and(
								eq(projectTask.organizationId, project.organizationId),
								eq(projectTask.projectId, project.id),
								eq(projectTask.state, "open"),
							),
						),
				),
			),
		);
}
