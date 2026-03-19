import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import type { TeamPermissions } from "@/lib/authorization";
import { buildTeamSettingsSurface, filterMembersForTeamSettingsSurface } from "./team-scope";

export async function loadTeamSettingsPageData(input: {
	organizationId: string;
	settingsRouteContext: { accessTier: "member" | "manager" | "orgAdmin" };
	principalContext: { permissions: TeamPermissions };
}) {
	const { organizationId, settingsRouteContext, principalContext } = input;

	const [membersData, allTeams] = await Promise.all([
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
		db.query.team.findMany({
			where: eq(team.organizationId, organizationId),
			orderBy: (currentTeam, { asc }) => [asc(currentTeam.name)],
		}),
	]);

	const teamSurface = buildTeamSettingsSurface({
		accessTier: settingsRouteContext.accessTier,
		teams: allTeams,
		permissions: principalContext.permissions,
	});
	const scopedTeamIds = new Set(teamSurface.teams.map((currentTeam) => currentTeam.id));

	return {
		teamSurface,
		scopedMembers: filterMembersForTeamSettingsSurface({
			members: membersData,
			manageableTeamIds: scopedTeamIds,
			canAccessOrganizationAdminSurface: teamSurface.canAccessOrganizationAdminSurface,
		}),
	};
}
