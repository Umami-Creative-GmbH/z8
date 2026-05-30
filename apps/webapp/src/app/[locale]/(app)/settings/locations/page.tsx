import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LocationManagement } from "@/components/settings/location-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export default async function LocationSettingsPage() {
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
		<LocationManagement
			organizationId={organizationId}
			canManageLocations={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}
