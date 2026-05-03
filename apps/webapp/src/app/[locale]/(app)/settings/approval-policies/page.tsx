import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ApprovalPolicyManagement } from "@/components/settings/approval-policy-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export default async function ApprovalPoliciesSettingsPage() {
	await connection();

	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier !== "orgAdmin") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return <ApprovalPolicyManagement organizationId={organizationId} />;
}
