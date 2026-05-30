import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ChangePolicyManagement } from "@/components/settings/change-policy/change-policy-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function ChangePoliciesSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const [, settingsRouteContext] = await Promise.all([
		getTranslate(),
		getCurrentSettingsRouteContext(),
	]);

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
