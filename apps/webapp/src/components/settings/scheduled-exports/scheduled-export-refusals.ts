import type { RefusalOverrides } from "@/lib/organization-action/action-error-message";

/** The scheduled export settings' texts for `actionErrorMessage`. */
export const SCHEDULED_EXPORT_REFUSALS = {
	owner_not_org_admin: (t, failure) =>
		t(
			"settings.scheduledExports.errors.ownerNotOrgAdmin",
			"The schedule owner, {owner}, is no longer an org admin. Make yourself or another org admin its owner first.",
			{ owner: String(failure.details?.owner ?? "") },
		),
} satisfies RefusalOverrides;
