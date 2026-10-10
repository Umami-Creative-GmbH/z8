/**
 * The project task model (#872): its shape and input rules, shared by the
 * task settings screen and the server. Pure: safe in client and server code.
 * Reads live in `./project-tasks` (server only).
 */

export const PROJECT_TASK_STATES = ["open", "done"] as const;
export type ProjectTaskState = (typeof PROJECT_TASK_STATES)[number];

/** A task as every task read returns it. */
export interface ProjectTask {
	id: string;
	organizationId: string;
	projectId: string;
	name: string;
	description: string | null;
	/** numeric(8, 2) text, e.g. "12.50"; null = no estimate. */
	estimateHours: string | null;
	state: ProjectTaskState;
	doneAt: Date | null;
	doneBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** An open task a booking surface offers (#874): what a picker needs, nothing more. */
export interface ProjectTaskChoice {
	id: string;
	name: string;
}

/** The task a booking already carries; it may be done by now (#874). */
export interface BookedProjectTask {
	id: string;
	name: string;
	state: ProjectTaskState;
	projectId: string;
}

/**
 * The stable reasons booking refuses a named task with (#873's
 * `ProjectTaskIneligibility`), for surfaces that word them.
 */
export type ProjectTaskRefusalReason =
	| "task_not_found"
	| "task_other_project"
	| "task_done"
	| "project_not_bookable";

/** The Tolgee key and English default each surface shows for a task refusal. */
const PROJECT_TASK_REFUSAL_MESSAGES = {
	task_not_found: ["timeTracking.errors.taskNotFound", "This task no longer exists"],
	task_other_project: [
		"timeTracking.errors.taskOtherProject",
		"This task belongs to another project",
	],
	task_done: ["timeTracking.errors.taskDone", "This task is done, so no time can be booked to it"],
	project_not_bookable: [
		"timeTracking.errors.taskProjectNotBookable",
		"Time can no longer be booked to this task's project",
	],
} as const satisfies Record<ProjectTaskRefusalReason, readonly [string, string]>;

/** Whether a booking refusal code is one of the task refusals. */
export function isProjectTaskRefusal(
	code: string | null | undefined,
): code is ProjectTaskRefusalReason {
	return code != null && Object.hasOwn(PROJECT_TASK_REFUSAL_MESSAGES, code);
}

/**
 * How to word a task refusal: its Tolgee key and English default, or null when
 * the code is no task refusal. Every booking surface words them through this.
 */
export function projectTaskRefusalMessage(
	code: string | null | undefined,
): readonly [key: string, fallback: string] | null {
	return isProjectTaskRefusal(code) ? PROJECT_TASK_REFUSAL_MESSAGES[code] : null;
}

export const PROJECT_TASK_NAME_MAX_LENGTH = 200;
export const PROJECT_TASK_DESCRIPTION_MAX_LENGTH = 2000;
/** numeric(8, 2), like the project's budget hours. */
export const PROJECT_TASK_ESTIMATE_MAX_HOURS = 999_999.99;

export type ProjectTaskInputProblem =
	| "nameRequired"
	| "nameTooLong"
	| "descriptionTooLong"
	| "estimateInvalid";

type RuleResult<T> = { ok: true; value: T } | { ok: false; problem: ProjectTaskInputProblem };

/** The stored task name: trimmed, non-empty and bounded. */
export function normalizeProjectTaskName(raw: string): RuleResult<string> {
	const name = raw.trim();
	if (name.length === 0) return { ok: false, problem: "nameRequired" };
	if (name.length > PROJECT_TASK_NAME_MAX_LENGTH) return { ok: false, problem: "nameTooLong" };
	return { ok: true, value: name };
}

/** The stored description: trimmed, with blank meaning none. */
export function normalizeProjectTaskDescription(
	raw: string | null | undefined,
): RuleResult<string | null> {
	const description = raw?.trim() ?? "";
	if (description.length > PROJECT_TASK_DESCRIPTION_MAX_LENGTH) {
		return { ok: false, problem: "descriptionTooLong" };
	}
	return { ok: true, value: description.length > 0 ? description : null };
}

/**
 * Hours as numeric(8, 2) text, the one rounding rule for task estimates and
 * template budgets: positive hours rounded to two decimals, at most `max`, or
 * null for none. Numeric text as stored (e.g. a project's budget) passes as is.
 */
export function positiveHoursText(
	hours: number | string | null | undefined,
	max: number = PROJECT_TASK_ESTIMATE_MAX_HOURS,
): { ok: true; value: string | null } | { ok: false } {
	if (hours === null || hours === undefined) return { ok: true, value: null };
	const value = typeof hours === "string" ? Number(hours) : hours;
	if (!Number.isFinite(value)) return { ok: false };
	const rounded = Math.round(value * 100) / 100;
	if (rounded <= 0 || rounded > max) return { ok: false };
	return { ok: true, value: rounded.toFixed(2) };
}

/**
 * The stored task estimate as numeric(8, 2) text: positive hours rounded to
 * two decimals, or null for no estimate.
 */
export function normalizeProjectTaskEstimate(
	hours: number | string | null | undefined,
): RuleResult<string | null> {
	const estimate = positiveHoursText(hours);
	return estimate.ok ? estimate : { ok: false, problem: "estimateInvalid" };
}
