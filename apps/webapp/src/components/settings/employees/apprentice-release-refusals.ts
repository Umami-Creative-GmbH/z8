import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { ApprenticeReleaseRefusal } from "@/lib/statutory/apprenticeship/release-credit-view";
import type { EmployeeContextRefusal } from "@/lib/statutory/employee-context";

/** Every refusal recording or removing a release day can return, as admins read it. */
export const apprenticeReleaseRefusals = {
	apprentice_release_not_apprentice: [
		"settings.apprenticeRelease.refusal.notApprentice",
		"Release days can only be recorded while the employee's terms make them an apprentice.",
	],
	apprentice_release_lessons_required: [
		"settings.apprenticeRelease.refusal.lessonsRequired",
		"Enter the number of lessons.",
	],
	apprentice_release_school_minutes_required: [
		"settings.apprenticeRelease.refusal.schoolMinutesRequired",
		"Enter the planned school hours of the block week.",
	],
	apprentice_release_no_preceding_working_day: [
		"settings.apprenticeRelease.refusal.noPrecedingWorkingDay",
		"There is no working day in the week before the exam to release.",
	],
	apprentice_release_exam_time_invalid: [
		"settings.apprenticeRelease.refusal.examTimeInvalid",
		"Enter when the exam starts and ends, or neither. It must end after it starts.",
	],
	apprentice_release_school_time_invalid: [
		"settings.apprenticeRelease.refusal.schoolTimeInvalid",
		"Enter when school starts and ends, or neither. It must end after it starts.",
	],
	apprentice_release_day_already_released: [
		"settings.apprenticeRelease.refusal.dayAlreadyReleased",
		"This day is already released. Remove the release recorded on it first.",
	],
	statutory_period_overlap: [
		"settings.apprenticeRelease.refusal.overlap",
		"This release overlaps a release already recorded.",
	],
	statutory_invalid_range: [
		"settings.apprenticeRelease.refusal.invalidRange",
		"Check the dates: the last day must not be before the first.",
	],
	statutory_invalid_value: [
		"settings.apprenticeRelease.refusal.invalidValue",
		"Check the lessons and school hours.",
	],
	statutory_note_required: [
		"settings.apprenticeRelease.refusal.reasonRequired",
		"Explain why the release day is removed.",
	],
	statutory_release_single_day: [
		"settings.apprenticeRelease.refusal.singleDay",
		"Only a block-release week spans several days.",
	],
} as const satisfies RefusalMessages<ApprenticeReleaseRefusal | EmployeeContextRefusal>;
