import { loadTeamSettingsPageData } from "@/app/[locale]/(app)/settings/teams/team-settings-page-data";
import { TeamsTab } from "@/components/organization/teams-tab";
import { getCurrentSettingsRouteContext, getPrincipalContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

export default async function TeamsPage() {
	const [settingsRouteContext, principalContext] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getPrincipalContext(),
	]);

	if (!settingsRouteContext || !principalContext) {
		return redirectWithLocale("/settings");
	}

	if (settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const { teamSurface, scopedMembers } = await loadTeamSettingsPageData({
		organizationId,
		settingsRouteContext,
		principalContext,
	});

	// TeamsTab renders the page heading so its Create Team action sits beside the title.
	return (
		<div className="page-frame flex flex-1 flex-col gap-6">
			<TeamsTab
				teams={teamSurface.teams}
				members={scopedMembers}
				canAccessOrganizationAdminSurface={teamSurface.canAccessOrganizationAdminSurface}
				canCreateTeams={teamSurface.canCreateTeams}
				organizationId={organizationId}
			/>
		</div>
	);
}
