import type {
	ActionMessage,
	RefusalOverrides,
} from "@/lib/organization-action/action-error-message";

/**
 * Driving-licence verifier grants' own texts for `actionErrorMessage`. The
 * actions still return their refusal code in `error`, so callers pass
 * `{ code: result.error }` until the folder moves onto `organizationAction`.
 */
export const VERIFIER_REFUSALS = {
	until_in_past: [
		"settings.drivingLicence.verifiers.untilInPast",
		"The until date can't be in the past.",
	],
	former_employee: [
		"settings.drivingLicence.verifiers.formerEmployee",
		"Former employees can't be added. Choose employees on the current roster.",
	],
	not_enabled: [
		"settings.drivingLicence.verifiers.notEnabled",
		"Driving licence checks are not switched on for this organization.",
	],
} satisfies RefusalOverrides;

/** What the verifier actions reported for any other failure. */
export const VERIFIER_FAILED: ActionMessage = [
	"settings.drivingLicence.verifiers.failed",
	"Could not update or access driving licence verifier responsibility. Check your permissions and selections.",
];
