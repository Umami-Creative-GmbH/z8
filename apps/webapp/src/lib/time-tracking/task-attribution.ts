/**
 * How a write's task follows its project (#873). Pure and client-safe.
 *
 * A task is always optional and never outlives its project: an explicit task
 * intent applies as given, while an omitted (or preserving) one keeps the
 * current task only as long as the write keeps the current project. Changing or
 * clearing the project without naming a task of the new project clears the task.
 */

/** Omission preserves; clearing and replacement are explicit. */
export type TaskAttributionIntent =
	| { kind: "preserve" }
	| { kind: "clear" }
	| { kind: "replace"; id: string };

export function taskIntentFollowingProject(input: {
	/** The write's own task intent; undefined when it names none. */
	task: TaskAttributionIntent | undefined;
	/** The project the write leaves on the work. */
	projectId: string | null;
	/** The work's project before the write. */
	currentProjectId: string | null;
}): TaskAttributionIntent {
	const { task, projectId, currentProjectId } = input;
	if (task && task.kind !== "preserve") return task;
	return projectId === currentProjectId ? { kind: "preserve" } : { kind: "clear" };
}

/** The task a write leaves: a preserving intent keeps the current task. */
export function taskIdAfter(intent: TaskAttributionIntent, currentTaskId: string | null) {
	if (intent.kind === "preserve") return currentTaskId;
	return intent.kind === "clear" ? null : intent.id;
}
