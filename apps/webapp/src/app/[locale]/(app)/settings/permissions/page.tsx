import { redirect } from "next/navigation";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { PermissionsPageClient } from "./permissions-page-client";

export default async function PermissionsPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
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
