import { CONTRACTOR_COMPENSATION_REFUSALS } from "@/components/settings/contracts/contractor-compensation-refusals";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
	type Translate,
} from "@/lib/organization-action/action-error-message";
import type { InvitationEngagementRefusal } from "@/lib/validations/invitation";

/**
 * How the invitation's engagement refusals read (#1995, #1935), by the
 * `refusal` code `sendInvitation` sends: the contractor's projects, planned
 * end and first compensation terms.
 */
export const INVITATION_REFUSALS = {
	project_not_found: [
		"organization.invite.errors.projectNotFound",
		"A chosen project no longer belongs to this organization. Choose the projects again.",
	],
	planned_end_not_future: [
		"organization.invite.contractor.plannedEndDateNotFuture",
		"The planned engagement end must be after today.",
	],
	invalid_basis: CONTRACTOR_COMPENSATION_REFUSALS.invalid_basis,
	invalid_currency: CONTRACTOR_COMPENSATION_REFUSALS.invalid_currency,
	invalid_rate: CONTRACTOR_COMPENSATION_REFUSALS.invalid_rate,
	rate_not_positive: CONTRACTOR_COMPENSATION_REFUSALS.rate_not_positive,
	rate_too_large: CONTRACTOR_COMPENSATION_REFUSALS.rate_too_large,
	rate_too_precise: CONTRACTOR_COMPENSATION_REFUSALS.rate_too_precise,
	invalid_day_unit_rule: CONTRACTOR_COMPENSATION_REFUSALS.invalid_day_unit_rule,
	invalid_half_day_threshold: CONTRACTOR_COMPENSATION_REFUSALS.invalid_half_day_threshold,
	invalid_standard_day: CONTRACTOR_COMPENSATION_REFUSALS.invalid_standard_day,
} satisfies RefusalMessages<InvitationEngagementRefusal>;

/**
 * A failed invitation's message: an engagement refusal in the viewer's
 * language by its code. Refusals that carry no code yet (an invitation
 * already pending, a member already in the organization, …) keep their
 * server text until they get one.
 */
export function invitationErrorMessage(
	t: Translate,
	result: Extract<ServerActionResult<unknown>, { success: false }>,
): string {
	if (result.refusal && Object.hasOwn(INVITATION_REFUSALS, result.refusal)) {
		return actionErrorMessage(t, result, INVITATION_REFUSALS);
	}
	return result.error || t("organization.invite.error", "Failed to send invitation");
}
