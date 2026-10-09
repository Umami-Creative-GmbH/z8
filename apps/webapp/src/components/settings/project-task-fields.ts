"use client";

import { useTranslate } from "@tolgee/react";
import {
	normalizeProjectTaskEstimate,
	normalizeProjectTaskName,
	PROJECT_TASK_NAME_MAX_LENGTH,
} from "@/lib/projects/project-task-model";

/**
 * The task fields' rules, shared by the project tasks panel and the template
 * form so both accept exactly what the server accepts (#872, #878).
 */
export function useProjectTaskFieldRules() {
	const { t } = useTranslate();
	return {
		name: ({ value }: { value: string }) =>
			normalizeProjectTaskName(value).ok
				? undefined
				: t("settings.projects.tasks.field.nameRequired", "Enter a task name"),
		estimate: ({ value }: { value: string }) => {
			const estimate = value.trim();
			return !estimate || normalizeProjectTaskEstimate(estimate).ok
				? undefined
				: t("settings.projects.tasks.field.estimateInvalid", "Enter a positive number of hours");
		},
	};
}

/** Input attributes of a task name, bounded like the stored name. */
export const PROJECT_TASK_NAME_INPUT = { maxLength: PROJECT_TASK_NAME_MAX_LENGTH } as const;

/** Input attributes of a task estimate in hours. */
export const PROJECT_TASK_ESTIMATE_INPUT = {
	type: "number",
	inputMode: "decimal",
	min: "0.01",
	step: "0.25",
} as const;

/** A stored numeric(8, 2) hours value as form text ("12.50" becomes "12.5"); none is "". */
export function hoursFormText(value: string | null) {
	return value ? String(Number(value)) : "";
}

/** Form text as hours; blank is none. */
export function hoursFromFormText(value: string) {
	const hours = value.trim();
	return hours ? Number(hours) : null;
}
