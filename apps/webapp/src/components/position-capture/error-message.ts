import type { useTranslate } from "@tolgee/react";
import type { PositionCaptureErrorCode } from "@/lib/time-tracking/position-capture/errors";
import {
	POSITION_RETENTION_MAX_DAYS,
	POSITION_RETENTION_MIN_DAYS,
} from "@/lib/time-tracking/position-capture/policy";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * The translated reason a position capture action was refused, or null when
 * the code says nothing the user can act on (the caller then shows its own
 * "could not …" message). The server's English text is never shown. The keys
 * live in `common` because the actions are used from settings and the calendar.
 */
export function positionCaptureErrorMessage(
	t: Translate,
	code: PositionCaptureErrorCode | undefined,
): string | null {
	switch (code) {
		case "sign_in_required":
			return t("common.positionCaptureErrors.signInRequired", "Sign in to an organization first.");
		case "employee_profile_required":
			return t(
				"common.positionCaptureErrors.employeeProfileRequired",
				"An employee profile in this organization is required.",
			);
		case "admin_only":
			return t(
				"common.positionCaptureErrors.adminOnly",
				"Only organization owners and admins can manage position capture.",
			);
		case "invalid_work_period":
		case "work_period_not_found":
			return t(
				"common.positionCaptureErrors.workPeriodNotFound",
				"This work period was not found.",
			);
		case "positions_forbidden":
			return t(
				"common.positionCaptureErrors.positionsForbidden",
				"You are not allowed to see the positions of this work period.",
			);
		case "invalid_notice":
		case "notice_changed":
			return t(
				"common.positionCaptureErrors.noticeChanged",
				"The position notice has changed. Review the current notice before deciding.",
			);
		case "purpose_required":
			return t(
				"common.positionCaptureErrors.purposeRequired",
				"A purpose statement is required before position capture can be switched on.",
			);
		case "purpose_too_long":
			return t("common.positionCaptureErrors.purposeTooLong", "The purpose statement is too long.");
		case "retention_out_of_range":
			return t(
				"common.positionCaptureErrors.retentionOutOfRange",
				"Retention must be a whole number of days between {min} and {max}.",
				{ min: POSITION_RETENTION_MIN_DAYS, max: POSITION_RETENTION_MAX_DAYS },
			);
		case "invalid_target":
		case "invalid_selection":
			return t(
				"common.positionCaptureErrors.invalidTarget",
				"Choose who the assignment applies to.",
			);
		case "team_not_found":
			return t("common.positionCaptureErrors.teamNotFound", "This team was not found.");
		case "employee_not_found":
			return t("common.positionCaptureErrors.employeeNotFound", "This employee was not found.");
		case "assignment_not_found":
			return t(
				"common.positionCaptureErrors.assignmentNotFound",
				"This assignment no longer exists.",
			);
		case "failed":
		case undefined:
			return null;
	}
}
