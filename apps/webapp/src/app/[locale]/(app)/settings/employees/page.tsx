import { and, eq, inArray } from "drizzle-orm";
import type {
	InvitationWithInviter,
	MemberWithUserAndEmployee,
} from "@/components/organization/people-management-types";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import { getCurrentSettingsAccess, getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { EmployeesPageClient } from "./employees-page-client";

async function loadPeopleManagementData(input: {
	organizationId: string;
	currentUserId: string;
	settingsAccess: SettingsAccess | null;
}) {
	const [organization, members, invitations] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, input.organizationId),
			columns: { name: true, timezone: true },
		}),
		db
			.select({
				member: authSchema.member,
				user: authSchema.user,
				employee: employee,
			})
			.from(authSchema.member)
			.innerJoin(
				authSchema.user,
				eq(authSchema.member.userId, authSchema.user.id),
			)
			.leftJoin(
				employee,
				and(
					eq(employee.userId, authSchema.user.id),
					eq(employee.organizationId, input.organizationId),
				),
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

	if (!organization) {
		return redirectWithLocale("/settings");
	}

	const targetTeamIds = Array.from(
		new Set(
			invitations
				.map((invitation) => invitation.targetTeamId)
				.filter((id): id is string => !!id),
		),
	);
	const targetTeams = targetTeamIds.length
		? await db
				.select({ id: team.id, name: team.name })
				.from(team)
				.where(
					and(
						eq(team.organizationId, input.organizationId),
						inArray(team.id, targetTeamIds),
					),
				)
		: [];
	const targetTeamsById = new Map(
		targetTeams.map((team) => [team.id, { id: team.id, name: team.name }]),
	);

	return {
		organizationName: organization.name,
		organizationToday: systemClock
			.nowInstant()
			.toZonedDateTimeISO(organization.timezone || "UTC")
			.toPlainDate()
			.toString(),
		members: members as unknown as MemberWithUserAndEmployee[],
		invitations: invitations.map((invitation) => ({
			...invitation,
			targetTeam: invitation.targetTeamId
				? (targetTeamsById.get(invitation.targetTeamId) ?? null)
				: null,
		})) as unknown as InvitationWithInviter[],
		currentUserId: input.currentUserId,
		settingsAccess: input.settingsAccess,
	};
}

export default async function EmployeesPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}
	const currentUserId = settingsRouteContext.authContext.user.id;
	// Controls and people tabs follow the shared settings access resolver (ADR 0002, #1623).
	const caller = await getCurrentSettingsAccess();
	const settingsAccess =
		caller?.organizationId === organizationId ? caller.settingsAccess : null;

	if (!settingsAccess) {
		return redirectWithLocale("/settings");
	}

	const people = meetsSettingsAccess(settingsAccess, "orgAdmin")
		? await loadPeopleManagementData({
				organizationId,
				currentUserId,
				settingsAccess,
			})
		: undefined;

	return (
		<EmployeesPageClient
			accessTier={settingsRouteContext.accessTier}
			organizationId={organizationId}
			currentUserId={currentUserId}
			settingsAccess={settingsAccess}
			people={people}
		/>
	);
}
