import { Suspense } from "react";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { ApprovalSettingsLoading } from "../approval-policies/approval-settings-loading";

async function ApprovalEscalationSettingsContent() {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const ability = await getAbility();

	if (!ability || ability.cannot("manage", "Approval")) {
		return redirectWithLocale("/settings");
	}

	return redirectWithLocale("/settings/approval-policies?tab=escalation");
}

/** This route redirects to the Approval settings page; load in its frame. */
function ApprovalEscalationSettingsLoading() {
	return <ApprovalSettingsLoading />;
}

export default function ApprovalEscalationSettingsPage() {
	return (
		<Suspense fallback={<ApprovalEscalationSettingsLoading />}>
			<ApprovalEscalationSettingsContent />
		</Suspense>
	);
}
