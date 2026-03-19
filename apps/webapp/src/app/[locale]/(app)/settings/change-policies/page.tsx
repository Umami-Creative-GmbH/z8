import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getTranslate } from "@/tolgee/server";
import { ChangePolicyManagement } from "@/components/settings/change-policy-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export default async function ChangePoliciesSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	await getTranslate();
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (accessTier === "member" || !organizationId) {
		redirect("/settings");
	}

	return (
		<ChangePolicyManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
		/>
	);
}
