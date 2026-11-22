import { loadTeamSettingsPageData } from "@/app/[locale]/(app)/settings/teams/team-settings-page-data";
import { TeamsTab } from "@/components/organization/teams-tab";
import { getCurrentSettingsAccess, getPrincipalContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";

export default async function TeamsPage() {
	const [caller, principalContext] = await Promise.all([
		getCurrentSettingsAccess(),
		getPrincipalContext(),
	]);

	if (
		!caller?.settingsAccess ||
		!principalContext ||
		!meetsSettingsAccess(caller.settingsAccess, "scopedManager")
	) {
		return redirectWithLocale("/settings");
	}

	const { organizationId, settingsAccess } = caller;

	const { teamSurface, scopedMembers } = await loadTeamSettingsPageData({
		organizationId,
		settingsAccess,
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
