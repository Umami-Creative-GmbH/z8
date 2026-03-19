import { connection } from "next/server";
import { redirect } from "next/navigation";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function SurchargeSettingsPage() {
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
		<SurchargeManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
		/>
	);
}
