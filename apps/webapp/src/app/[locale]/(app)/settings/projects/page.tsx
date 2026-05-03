import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ProjectManagement } from "@/components/settings/project-management";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { canResolvedTierAccessRoute } from "@/lib/settings-access";

const SETTINGS_ROUTE = "/settings/projects";

export default async function ProjectSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

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

	return <ProjectManagement organizationId={organizationId} />;
}
