import { connection } from "next/server";
import { redirect } from "next/navigation";
import { SkillCatalogManagement } from "@/components/settings/skill-catalog-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { canResolvedTierAccessRoute } from "@/lib/settings-access";

const SETTINGS_ROUTE = "/settings/skills";

export default async function SkillsSettingsPage() {
	await connection();

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
		<SkillCatalogManagement
			organizationId={organizationId}
			canManageCatalog={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}
