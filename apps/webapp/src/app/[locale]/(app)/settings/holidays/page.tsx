import { connection } from "next/server";
import { redirect } from "next/navigation";
import { HolidayManagement } from "@/components/settings/holiday-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export default async function HolidaySettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

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
		<HolidayManagement
			organizationId={organizationId}
			canManage={accessTier === "orgAdmin"}
		/>
	);
}
