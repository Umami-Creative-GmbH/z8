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
 * The stored task estimate as numeric(8, 2) text: positive hours rounded to
 * two decimals, or null for no estimate.
 */
export function normalizeProjectTaskEstimate(
	hours: number | null | undefined,
): RuleResult<string | null> {
	if (hours === null || hours === undefined) return { ok: true, value: null };
	if (!Number.isFinite(hours)) return { ok: false, problem: "estimateInvalid" };
	const rounded = Math.round(hours * 100) / 100;
	if (rounded <= 0 || rounded > PROJECT_TASK_ESTIMATE_MAX_HOURS) {
		return { ok: false, problem: "estimateInvalid" };
	}
	return { ok: true, value: rounded.toFixed(2) };
}
