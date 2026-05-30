import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function SurchargeSettingsPage() {
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
		<SurchargeManagement organizationId={organizationId} canManage={accessTier === "orgAdmin"} />
	);
}
