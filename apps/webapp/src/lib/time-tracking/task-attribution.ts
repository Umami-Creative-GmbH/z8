/**
 * How a write's task follows its project (#873). Pure and client-safe.
 *
 * A task is always optional and never outlives its project: an explicit task
 * intent applies as given, while an omitted (or preserving) one keeps the
 * current task only as long as the write keeps the current project. Changing or
 * clearing the project without naming a task of the new project clears the task.
 */

const PROJECT_TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value can name a task at all (a task ID is a UUID). Every task
 * reader and request parser uses this one rule, so a malformed ID is an unknown
 * task (`task_not_found`), never a database error.
 */
export function isProjectTaskId(value: unknown): value is string {
	return typeof value === "string" && PROJECT_TASK_ID.test(value);
}

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

/**
 * The value any attribution intent (project, task, work category) leaves:
 * preserving keeps the current value, clearing leaves none, replacing names it.
 */
export function attributionAfter(intent: TaskAttributionIntent, current: string | null) {
	if (intent.kind === "preserve") return current;
	return intent.kind === "clear" ? null : intent.id;
}

/** The task a write leaves: a preserving intent keeps the current task. */
export function taskIdAfter(intent: TaskAttributionIntent, currentTaskId: string | null) {
	return attributionAfter(intent, currentTaskId);
}

/** The task a write leaves on work whose project it sets: the two rules above in one. */
export function taskIdFollowingProject(input: {
	task: TaskAttributionIntent | undefined;
	projectId: string | null;
	current: { projectId: string | null; taskId: string | null };
}) {
	return taskIdAfter(
		taskIntentFollowingProject({
			task: input.task,
			projectId: input.projectId,
			currentProjectId: input.current.projectId,
		}),
		input.current.taskId,
	);
}

/**
 * The intent of a named task ID (a write's optional `task` key): undefined names
 * none, so the key stays absent and the task follows the project; null clears;
 * an ID replaces.
 */
export function namedTaskIntent(taskId: string | null | undefined): {
	task?: TaskAttributionIntent;
} {
	if (taskId === undefined) return {};
	return { task: taskId === null ? { kind: "clear" } : { kind: "replace", id: taskId } };
}

/** A named task ID as an optional key: absent stays absent; null (clear) and an ID pass. */
export function namedTaskId(taskId: string | null | undefined): { taskId?: string | null } {
	return taskId === undefined ? {} : { taskId };
}

/**
 * A booking form's project choice (#874): the chosen task stays only while the
 * project stays, so a task never outlives its project in the form either.
 */
export function chooseProject<T extends string | null | undefined>(
	selection: { projectId: string | undefined; taskId: T },
	projectId: string | undefined,
): { projectId: string | undefined; taskId: T | undefined } {
	return projectId === selection.projectId ? selection : { projectId, taskId: undefined };
}

/**
 * The task a booking form sends for its choice (#874): a choice that leaves the
 * booking's current project and task as they are is left out, so the server
 * keeps that task even once it is done; any other choice is explicit, and no
 * task is null (clear).
 */
export function taskIdToSend(input: {
	projectId: string | null | undefined;
	taskId: string | null | undefined;
	current: { projectId: string | null | undefined; taskId: string | null | undefined };
}): string | null | undefined {
	const unchanged =
		(input.projectId ?? null) === (input.current.projectId ?? null) &&
		(input.taskId ?? null) === (input.current.taskId ?? null);
	return unchanged ? undefined : (input.taskId ?? null);
}

/**
 * A recorded task as an optional key, present only when there is one, so stored
 * commands, receipts and evidence without a task keep their earlier shape.
 */
export function recordedTaskId(taskId: string | null | undefined): { taskId?: string } {
	return taskId ? { taskId } : {};
}
