import { and, asc, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team } from "@/db/schema";
import { formerSinceDate, isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import { formerSinceField } from "@/lib/employee-lifecycle/former-since";
import { type MissingDrivingDetail, missingDrivingDetail } from "./driving-details-missing";
import { listDrivingDetailsMissing } from "./driving-details-missing-store";

/**
 * The manager's "driving details missing" list (#1127, `/team/driving`): the flagged work of the
 * employees in the viewer's scope, filterable by team and employee. Read-only and filtered by
 * `organizationId`.
 */
type Database = Pick<typeof db, "select" | "selectDistinct">;

/** Whose work the viewer sees: owners and admins everyone's, managers their employees'. */
export type DrivingDetailsTeamScope =
	| { kind: "all" }
	| { kind: "managed"; managerEmployeeId: string };

/** The viewer's scope by settings access tier; null for everyone else. */
export function drivingDetailsTeamScope(input: {
	accessTier: "member" | "manager" | "orgAdmin";
	organizationId: string;
	employee: { id: string; organizationId: string } | null;
}): DrivingDetailsTeamScope | null {
	if (input.accessTier === "orgAdmin") return { kind: "all" };
	if (input.accessTier === "manager" && input.employee?.organizationId === input.organizationId) {
		return { kind: "managed", managerEmployeeId: input.employee.id };
	}
	return null;
}

/** One flagged work period as the list shows it. Plain data; crosses to the client. */
export interface TeamDrivingDetailsRow {
	workPeriodId: string;
	employeeId: string;
	name: string;
	teamName: string | null;
	/** A former employee's work: kept as what was driven, marked as former (#1438). */
	former: boolean;
	/**
	 * On a former employee's work only: the organization-local date they left
	 * (`YYYY-MM-DD`), null when not recorded (#1439).
	 */
	formerSince?: string | null;
	workDay: string;
	startedAt: string;
	endedAt: string;
	startOffsetMinutes: number;
	endOffsetMinutes: number | null;
	missing: MissingDrivingDetail;
}

export interface TeamDrivingDetails {
	/** The teams and employees in scope, for the filters. */
	teams: { id: string; name: string }[];
	employees: { id: string; name: string; teamId: string | null }[];
	/** The applied filters, after dropping values outside the scope. */
	filters: { teamId: string | null; employeeId: string | null };
	rows: TeamDrivingDetailsRow[];
	/** More flagged work exists than the list shows. */
	truncated: boolean;
}

/** How many flagged work periods the list shows at most. */
export const TEAM_DRIVING_DETAILS_LIMIT = 200;

const displayName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${user.firstName}, ${user.lastName})), ''), ${user.name})`;

/**
 * Everyone in the viewer's scope, former employees included and marked (#1438): their flagged
 * work is what was driven and stays listed. The filters offer only the current roster.
 */
async function listScopedPeople(
	database: Database,
	input: { organizationId: string; scope: DrivingDetailsTeamScope },
) {
	const columns = {
		id: employee.id,
		name: displayName,
		teamId: employee.teamId,
		teamName: team.name,
		former: isFormerEmployee(employee),
		formerSince: formerSinceDate(employee),
	};
	const conditions = eq(employee.organizationId, input.organizationId);
	if (input.scope.kind === "all") {
		return database
			.select(columns)
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.leftJoin(
				team,
				and(eq(team.id, employee.teamId), eq(team.organizationId, input.organizationId)),
			)
			.where(conditions)
			.orderBy(asc(displayName), asc(employee.id));
	}
	return database
		.selectDistinct(columns)
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			team,
			and(eq(team.id, employee.teamId), eq(team.organizationId, input.organizationId)),
		)
		.innerJoin(
			employeeManagers,
			and(
				eq(employeeManagers.employeeId, employee.id),
				eq(employeeManagers.managerId, input.scope.managerEmployeeId),
			),
		)
		.where(conditions)
		.orderBy(asc(displayName), asc(employee.id));
}

export async function loadTeamDrivingDetails(
	database: Database,
	input: {
		organizationId: string;
		scope: DrivingDetailsTeamScope;
		filters: { teamId: string | null; employeeId: string | null };
	},
): Promise<TeamDrivingDetails> {
	const people = await listScopedPeople(database, input);
	// The filters are who drives now: the current roster and its teams.
	const current = people.filter((person) => !person.former);
	const teams = new Map<string, string>();
	for (const person of current) {
		if (person.teamId && person.teamName) teams.set(person.teamId, person.teamName);
	}
	const teamId =
		input.filters.teamId && teams.has(input.filters.teamId) ? input.filters.teamId : null;
	const employeeId =
		input.filters.employeeId && current.some((person) => person.id === input.filters.employeeId)
			? input.filters.employeeId
			: null;
	const selected = people.filter(
		(person) =>
			(teamId === null || person.teamId === teamId) &&
			(employeeId === null || person.id === employeeId),
	);
	const flagged = await listDrivingDetailsMissing(database, {
		organizationId: input.organizationId,
		employeeIds: selected.map((person) => person.id),
		limit: TEAM_DRIVING_DETAILS_LIMIT + 1,
	});
	const byId = new Map(people.map((person) => [person.id, person]));
	return {
		teams: [...teams]
			.map(([id, name]) => ({ id, name }))
			.toSorted((a, b) => a.name.localeCompare(b.name)),
		employees: current.map((person) => ({
			id: person.id,
			name: person.name,
			teamId: person.teamId,
		})),
		filters: { teamId, employeeId },
		rows: flagged.slice(0, TEAM_DRIVING_DETAILS_LIMIT).map((work) => {
			const person = byId.get(work.employeeId);
			const former = person?.former ?? false;
			return {
				workPeriodId: work.workPeriodId,
				employeeId: work.employeeId,
				name: person?.name ?? work.employeeId,
				teamName: person?.teamName ?? null,
				former,
				...formerSinceField(former, person?.formerSince),
				workDay: work.workDay,
				startedAt: work.startedAt,
				endedAt: work.endedAt,
				startOffsetMinutes: work.startOffsetMinutes,
				endOffsetMinutes: work.endOffsetMinutes,
				missing: missingDrivingDetail(work.vehicleUse) ?? "vehicle",
			};
		}),
		truncated: flagged.length > TEAM_DRIVING_DETAILS_LIMIT,
	};
}
