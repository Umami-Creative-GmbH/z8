/**
 * Input rules for project tasks (#872), shared by the task settings form and
 * the server actions. Pure: safe in client and server code.
 */

export const PROJECT_TASK_STATES = ["open", "done"] as const;
export type ProjectTaskState = (typeof PROJECT_TASK_STATES)[number];

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
