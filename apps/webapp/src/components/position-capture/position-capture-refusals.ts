import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import type { PositionCaptureErrorCode } from "@/lib/time-tracking/position-capture/errors";
import {
	POSITION_RETENTION_MAX_DAYS,
	POSITION_RETENTION_MIN_DAYS,
} from "@/lib/time-tracking/position-capture/policy";

/**
 * Position capture's own texts for `actionErrorMessage`. A `failed` refusal has
 * none: callers pass their own "could not …" fallback. The keys live in `common`
 * because the actions are used from settings and the calendar.
 */
export const POSITION_CAPTURE_REFUSALS = {
	sign_in_required: [
		"common.positionCaptureErrors.signInRequired",
		"Sign in to an organization first.",
	],
	employee_profile_required: [
		"common.positionCaptureErrors.employeeProfileRequired",
		"An employee profile in this organization is required.",
	],
	admin_only: [
		"common.positionCaptureErrors.adminOnly",
		"Only organization owners and admins can manage position capture.",
	],
	invalid_work_period: [
		"common.positionCaptureErrors.workPeriodNotFound",
		"This work period was not found.",
	],
	work_period_not_found: [
		"common.positionCaptureErrors.workPeriodNotFound",
		"This work period was not found.",
	],
	positions_forbidden: [
		"common.positionCaptureErrors.positionsForbidden",
		"You are not allowed to see the positions of this work period.",
	],
	invalid_notice: [
		"common.positionCaptureErrors.noticeChanged",
		"The position notice has changed. Review the current notice before deciding.",
	],
	notice_changed: [
		"common.positionCaptureErrors.noticeChanged",
		"The position notice has changed. Review the current notice before deciding.",
	],
	purpose_required: [
		"common.positionCaptureErrors.purposeRequired",
		"A purpose statement is required before position capture can be switched on.",
	],
	purpose_too_long: [
		"common.positionCaptureErrors.purposeTooLong",
		"The purpose statement is too long.",
	],
	retention_out_of_range: (t) =>
		t(
			"common.positionCaptureErrors.retentionOutOfRange",
			"Retention must be a whole number of days between {min} and {max}.",
			{ min: POSITION_RETENTION_MIN_DAYS, max: POSITION_RETENTION_MAX_DAYS },
		),
	invalid_target: [
		"common.positionCaptureErrors.invalidTarget",
		"Choose who the assignment applies to.",
	],
	invalid_selection: [
		"common.positionCaptureErrors.invalidTarget",
		"Choose who the assignment applies to.",
	],
	team_not_found: ["common.positionCaptureErrors.teamNotFound", "This team was not found."],
	employee_not_found: [
		"common.positionCaptureErrors.employeeNotFound",
		"This employee was not found.",
	],
	former_employee: [
		"common.positionCaptureErrors.formerEmployee",
		"Former employees can't get a new assignment. Choose someone on the current roster.",
	],
	assignment_not_found: [
		"common.positionCaptureErrors.assignmentNotFound",
		"This assignment no longer exists.",
	],
} satisfies RefusalMessages<Exclude<PositionCaptureErrorCode, "failed">>;
