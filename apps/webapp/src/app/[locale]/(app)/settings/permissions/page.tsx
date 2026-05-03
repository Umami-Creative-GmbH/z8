import { redirect } from "next/navigation";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { canResolvedTierAccessRoute } from "@/lib/settings-access";
import { PermissionsPageClient } from "./permissions-page-client";

const SETTINGS_ROUTE = "/settings/permissions";

export default async function PermissionsPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (
		!settingsRouteContext ||
		!canResolvedTierAccessRoute(settingsRouteContext.accessTier, SETTINGS_ROUTE)
	) {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<PermissionsPageClient
			organizationId={organizationId}
			isOrgAdmin={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}
