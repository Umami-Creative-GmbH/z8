import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import {
	EmployeesPageClient,
	type InvitationWithInviter,
	type MemberWithUserAndEmployee,
} from "./employees-page-client";

async function loadPeopleManagementData(input: {
	organizationId: string;
	currentUserId: string;
}) {
	const [organization, currentMember, members, invitations] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, input.organizationId),
			columns: { name: true },
		}),
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, input.currentUserId),
				eq(authSchema.member.organizationId, input.organizationId),
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
				and(eq(employee.userId, authSchema.user.id), eq(employee.organizationId, input.organizationId)),
			)
			.where(eq(authSchema.member.organizationId, input.organizationId)),
		db.query.invitation.findMany({
			where: and(
				eq(authSchema.invitation.organizationId, input.organizationId),
				eq(authSchema.invitation.status, "pending"),
			),
			with: {
				user: true,
			},
			orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
		}),
	]);

	if (!organization || !currentMember) {
		redirect("/settings");
	}

	const targetTeamIds = Array.from(
		new Set(invitations.map((invitation) => invitation.targetTeamId).filter((id): id is string => !!id)),
	);
	const targetTeams = targetTeamIds.length
		? await db
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(and(eq(team.organizationId, input.organizationId), inArray(team.id, targetTeamIds)))
		: [];
	const targetTeamsById = new Map(targetTeams.map((team) => [team.id, { id: team.id, name: team.name }]));

	return {
		organizationName: organization.name,
		members: members as unknown as MemberWithUserAndEmployee[],
		invitations: invitations.map((invitation) => ({
			...invitation,
			targetTeam: invitation.targetTeamId ? (targetTeamsById.get(invitation.targetTeamId) ?? null) : null,
		})) as unknown as InvitationWithInviter[],
		currentMemberRole: currentMember.role as "owner" | "admin" | "member",
		currentUserId: input.currentUserId,
	};
}

export default async function EmployeesPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	const people =
		settingsRouteContext.accessTier === "orgAdmin"
			? await loadPeopleManagementData({
					organizationId,
					currentUserId: settingsRouteContext.authContext.user.id,
				})
			: undefined;

	return (
		<EmployeesPageClient
			accessTier={settingsRouteContext.accessTier}
			organizationId={organizationId}
			people={people}
		/>
	);
}
