import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { buildEligibleInvitationDraftPredicate } from "@/app/[locale]/(app)/settings/employees/employee-invitation-draft-eligibility";
import { invitation, user } from "@/db/auth-schema";
import {
	employee,
	employeeInvitationDraft,
	goLiveExclusion,
	goLiveGroupTeam,
	team,
} from "@/db/schema";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type { GoLiveAsOf, GoLiveGroup, GoLiveMember } from "./types";

/**
 * The go-live group: who go-live checks run over. The organization's current
 * roster, so former employees and owners without an employee record are never
 * checked, plus pending invitees, placed by their invitation draft's team (or
 * at organization level without one), narrowed to the chosen teams. Every
 * check takes this group; none builds its own population. A bounded number of
 * queries.
 */
export async function resolveGoLiveGroup(
	db: DatabaseClient,
	organizationId: string,
	asOf: GoLiveAsOf,
): Promise<GoLiveGroup> {
	const [employees, invitees] = await Promise.all([
		db
			.select({
				employeeId: employee.id,
				primaryTeamId: employee.teamId,
				teamName: team.name,
				name: user.name,
				email: user.email,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.leftJoin(team, and(eq(team.id, employee.teamId), eq(team.organizationId, organizationId)))
			.where(
				and(
					onCurrentRoster(organizationId, employee, asOf.instant),
					inChosenTeams(organizationId, employee.teamId),
					notExcluded(organizationId),
				),
			)
			.orderBy(asc(user.name), asc(employee.id)),
		db
			.select({
				draftId: employeeInvitationDraft.id,
				teamId: employeeInvitationDraft.teamId,
				teamName: team.name,
				firstName: employeeInvitationDraft.firstName,
				lastName: employeeInvitationDraft.lastName,
				email: invitation.email,
			})
			.from(employeeInvitationDraft)
			.innerJoin(invitation, eq(invitation.id, employeeInvitationDraft.invitationId))
			.leftJoin(
				team,
				and(eq(team.id, employeeInvitationDraft.teamId), eq(team.organizationId, organizationId)),
			)
			.where(
				and(
					buildEligibleInvitationDraftPredicate({
						organizationId,
						now: dateFromInstant(asOf.instant),
					}),
					inChosenTeams(organizationId, employeeInvitationDraft.teamId),
				),
			)
			.orderBy(asc(invitation.email), asc(employeeInvitationDraft.id)),
	]);

	const teamNames = new Map<string, string>();
	const members: GoLiveMember[] = [];
	for (const row of employees) {
		if (row.primaryTeamId && row.teamName) teamNames.set(row.primaryTeamId, row.teamName);
		members.push({
			kind: "employee",
			employeeId: row.employeeId,
			primaryTeamId: row.primaryTeamId,
			displayName: row.name || row.email,
		});
	}
	for (const row of invitees) {
		if (row.teamId && row.teamName) teamNames.set(row.teamId, row.teamName);
		const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
		members.push({
			kind: "invitee",
			draftId: row.draftId,
			email: row.email,
			teamId: row.teamId,
			displayName: name || row.email,
		});
	}

	return { members, teamNames };
}

/**
 * Team narrowing: with no chosen teams everyone is in; otherwise only those
 * whose primary team (or an invitee's draft team) is chosen. Other team
 * memberships don't count.
 */
function inChosenTeams(organizationId: string, teamColumn: AnyPgColumn): SQL {
	const chosen = sql`(select ${goLiveGroupTeam.teamId} from ${goLiveGroupTeam} where ${goLiveGroupTeam.organizationId} = ${organizationId})`;
	return sql`(not exists ${chosen} or ${teamColumn} in ${chosen})`;
}

/** No open go-live exclusion leaves the employee out. */
function notExcluded(organizationId: string): SQL {
	return sql`(not exists (select 1 from ${goLiveExclusion} where ${goLiveExclusion.organizationId} = ${organizationId} and ${goLiveExclusion.employeeId} = ${employee.id} and ${goLiveExclusion.liftedAt} is null and ${goLiveExclusion.endedAt} is null))`;
}
