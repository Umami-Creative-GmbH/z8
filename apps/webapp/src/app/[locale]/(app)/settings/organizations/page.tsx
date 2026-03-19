import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadTeamSettingsPageData } from "@/app/[locale]/(app)/settings/teams/team-settings-page-data";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { getCurrentSettingsRouteContext, getPrincipalContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function OrganizationsPage() {
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

	const { authContext, accessTier } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const [{ teamSurface, scopedMembers }, organization, invitations, currentMember] = await Promise.all([
		loadTeamSettingsPageData({
			organizationId,
			settingsRouteContext,
			principalContext,
		}),
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, organizationId),
		}),
		accessTier === "orgAdmin"
			? db.query.invitation.findMany({
					where: and(
						eq(authSchema.invitation.organizationId, organizationId),
						eq(authSchema.invitation.status, "pending"),
					),
					with: {
						user: true,
					},
					orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
				})
			: Promise.resolve([]),
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, authContext.user.id),
				eq(authSchema.member.organizationId, organizationId),
			),
		}),
	]);

	if (!organization || !currentMember) {
		return (
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-4xl">
					<h1 className="text-2xl font-semibold">
						{t("settings.organizations.notFound.title", "Organization Not Found")}
					</h1>
					<p className="text-muted-foreground mt-2">
						{t(
							"settings.organizations.notFound.description",
							"The organization could not be found or you don't have access to it.",
						)}
					</p>
				</div>
			</div>
		);
	}

	return (
		<OrganizationsPageClient
			organization={organization}
			members={scopedMembers}
			invitations={invitations}
			teams={teamSurface.teams}
			currentMemberRole={currentMember.role as "owner" | "admin" | "member"}
			currentUserId={authContext.user.id}
			canAccessOrganizationAdminSurface={teamSurface.canAccessOrganizationAdminSurface}
			canCreateTeams={teamSurface.canCreateTeams}
			canCreateOrganizations={
				authContext.user.canCreateOrganizations || authContext.user.role === "admin"
			}
		/>
	);
}
