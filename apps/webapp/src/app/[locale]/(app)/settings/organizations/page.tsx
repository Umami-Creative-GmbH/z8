import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
	OrganizationsPageClient,
	type InvitationWithInviter,
	type MemberWithUserAndEmployee,
} from "@/components/organization/organizations-page-client";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function OrganizationsPage() {
	const [settingsRouteContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext) {
		redirect("/settings");
	}

	if (settingsRouteContext.accessTier !== "orgAdmin") {
		redirect("/settings");
	}

	const { authContext } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const [organization, invitations, currentMember, members] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, organizationId),
		}),
		db.query.invitation.findMany({
			where: and(
				eq(authSchema.invitation.organizationId, organizationId),
				eq(authSchema.invitation.status, "pending"),
			),
			with: {
				user: true,
			},
			orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
		}),
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, authContext.user.id),
				eq(authSchema.member.organizationId, organizationId),
			),
		}),
		db
			.select({
				member: authSchema.member,
				user: authSchema.user,
				employee: employee,
			})
			.from(authSchema.member)
			.innerJoin(authSchema.user, eq(authSchema.member.userId, authSchema.user.id))
			.leftJoin(
				employee,
				and(eq(employee.userId, authSchema.user.id), eq(employee.organizationId, organizationId)),
			)
			.where(eq(authSchema.member.organizationId, organizationId)),
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

	const typedInvitations = invitations as unknown as InvitationWithInviter[];
	const typedMembers = members as unknown as MemberWithUserAndEmployee[];

	return (
		<OrganizationsPageClient
			organization={organization}
			members={typedMembers}
			invitations={typedInvitations}
			currentMemberRole={currentMember.role as "owner" | "admin" | "member"}
			currentUserId={authContext.user.id}
			canCreateOrganizations={
				authContext.user.canCreateOrganizations || authContext.user.role === "admin"
			}
		/>
	);
}
