import { and, asc, eq } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, team } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type { GoLiveAsOf, GoLiveGroup, GoLiveMember } from "./types";

/**
 * The go-live group: who go-live checks run over. Today that is the
 * organization's current roster, so former employees and owners without an
 * employee record are never checked. Every check takes this group; none
 * builds its own population. One query.
 */
export async function resolveGoLiveGroup(
	db: DatabaseClient,
	organizationId: string,
	asOf: GoLiveAsOf,
): Promise<GoLiveGroup> {
	const rows = await db
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
		.where(onCurrentRoster(organizationId, employee, asOf.instant))
		.orderBy(asc(user.name), asc(employee.id));

	const teamNames = new Map<string, string>();
	const members: GoLiveMember[] = rows.map((row) => {
		if (row.primaryTeamId && row.teamName) teamNames.set(row.primaryTeamId, row.teamName);
		return {
			kind: "employee",
			employeeId: row.employeeId,
			primaryTeamId: row.primaryTeamId,
			displayName: row.name || row.email,
		};
	});

	return { members, teamNames };
}
