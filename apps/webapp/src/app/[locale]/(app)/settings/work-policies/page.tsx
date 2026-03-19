import { connection } from "next/server";
import { redirect } from "next/navigation";
import { WorkPolicyManagement } from "@/components/settings/work-policy-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export default async function WorkPoliciesPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<WorkPolicyManagement
			organizationId={organizationId}
			accessTier={settingsRouteContext.accessTier}
		/>
	);
}
