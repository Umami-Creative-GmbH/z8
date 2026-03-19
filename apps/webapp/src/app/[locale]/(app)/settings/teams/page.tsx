import { redirect } from "next/navigation";
import { loadTeamSettingsPageData } from "@/app/[locale]/(app)/settings/teams/team-settings-page-data";
import { TeamsTab } from "@/components/organization/teams-tab";
import { getCurrentSettingsRouteContext, getPrincipalContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function TeamsPage() {
	const [settingsRouteContext, principalContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getPrincipalContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext || !principalContext) {
		redirect("/settings");
	}

	if (settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const { teamSurface, scopedMembers } = await loadTeamSettingsPageData({
		organizationId,
		settingsRouteContext,
		principalContext,
	});

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.teams.title", "Teams")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.teams.description",
						"Organize employees into teams for better management",
					)}
				</p>
			</div>

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
