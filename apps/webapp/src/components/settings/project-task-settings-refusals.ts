import type { RefusalOverrides } from "@/lib/organization-action/action-error-message";

/** The project task settings' texts for `actionErrorMessage` (#872). */
export const PROJECT_TASK_SETTINGS_REFUSALS = {
	nameRequired: ["settings.projects.tasks.errors.nameRequired", "Enter a task name."],
	nameTooLong: ["settings.projects.tasks.errors.nameTooLong", "The task name is too long."],
	descriptionTooLong: [
		"settings.projects.tasks.errors.descriptionTooLong",
		"The task description is too long.",
	],
	estimateInvalid: [
		"settings.projects.tasks.errors.estimateInvalid",
		"Enter the estimate as a positive number of hours.",
	],
	duplicate_name: [
		"settings.projects.tasks.errors.duplicateName",
		"A task with this name already exists in this project.",
	],
	ConflictError: [
		"settings.projects.tasks.errors.booked",
		"Time is booked to this task, so it can't be deleted.",
	],
	NotFoundError: ["settings.projects.tasks.errors.notFound", "This task no longer exists."],
	AuthorizationError: [
		"settings.projects.tasks.errors.notAllowed",
		"You don't have access to manage the tasks of this project.",
	],
} satisfies RefusalOverrides;
