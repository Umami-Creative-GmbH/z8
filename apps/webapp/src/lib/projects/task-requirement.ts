/**
 * The task requirement (#884, Projects ADR 0002): a project's rule that time
 * booked to it must name one of its tasks. Pure: safe in client and server
 * code. The org-scoped reads and the SQL form of the same rule live in
 * `./task-requirement-reads` (server only).
 *
 * The requirement is **active** only while the project requires a task AND
 * has at least one open task. With no open task it has lapsed: the project
 * books like any other. Every reader (eligibility refusals, the missing-task
 * marker, pickers, the desktop context) uses this rule or its SQL twin
 * instead of reimplementing it.
 */

import type { ProjectTaskState } from "./project-task-model";

/** What decides the active requirement: the setting plus the project's tasks, however the caller has them. */
export type TaskRequirementFacts = { requiresTask: boolean } & (
	| { tasks: readonly { state: ProjectTaskState }[] }
	| { openTaskCount: number }
	| { hasOpenTask: boolean }
);

function hasOpenTask(facts: TaskRequirementFacts): boolean {
	if ("tasks" in facts) return facts.tasks.some((task) => task.state === "open");
	if ("openTaskCount" in facts) return facts.openTaskCount > 0;
	return facts.hasOpenTask;
}

/** Whether the project's task requirement is active: it requires a task and has an open task. */
export function isTaskRequirementActive(facts: TaskRequirementFacts): boolean {
	return facts.requiresTask && hasOpenTask(facts);
}
