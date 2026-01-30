import { and, eq } from "drizzle-orm";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function OrganizationsPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);
	// Use session's activeOrganizationId, or fall back to employee's organizationId
	// This ensures consistency with how the sidebar determines the current org
	const activeOrgId =
		authContext.session.activeOrganizationId || authContext.employee?.organizationId;

	if (!activeOrgId) {
		return (
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-4xl">
					<h1 className="text-2xl font-semibold">
						{t("settings.organizations.noActive.title", "No Active Organization")}
					</h1>
					<p className="text-muted-foreground mt-2">
						{t(
							"settings.organizations.noActive.description",
							"Please select or create an organization to continue.",
						)}
					</p>
				</div>
			</div>
		);
	}

	// Parallel data loading for better performance
	const [organization, membersData, invitations, teamsResult, currentMember] = await Promise.all([
		// Get organization details
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, activeOrgId),
		}),

		// Get members with user and employee data
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
				and(eq(employee.userId, authSchema.user.id), eq(employee.organizationId, activeOrgId)),
			)
			.where(eq(authSchema.member.organizationId, activeOrgId)),

		// Get pending invitations with inviter information
		db.query.invitation.findMany({
			where: and(
				eq(authSchema.invitation.organizationId, activeOrgId),
				eq(authSchema.invitation.status, "pending"),
			),
			with: {
				user: true, // The inviter - relation named "user" in auth-schema
			},
			orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
		}),

		// Get teams with employees
		listTeams(activeOrgId),

		// Get current user's member role
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, authContext.user.id),
				eq(authSchema.member.organizationId, activeOrgId),
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

	// Get team permissions from employee record
	const permissions = authContext.employee
		? {
				canCreateTeams: authContext.employee.role === "admin", // Simplified - can be extended
				canManageTeamSettings: authContext.employee.role === "admin",
				canManageTeamMembers: authContext.employee.role === "admin",
				canApproveTeamRequests: authContext.employee.role === "admin",
			}
		: {
				canCreateTeams: false,
				canManageTeamSettings: false,
				canManageTeamMembers: false,
				canApproveTeamRequests: false,
			};

	return (
		<OrganizationsPageClient
			organization={organization}
			members={membersData}
			invitations={invitations}
			teams={teamsResult.success ? teamsResult.data : []}
			currentMemberRole={currentMember.role as "owner" | "admin" | "member"}
			currentUserId={authContext.user.id}
			canCreateOrganizations={
				authContext.user.canCreateOrganizations || authContext.user.role === "admin"
			}
			permissions={permissions}
		/>
	);
}
