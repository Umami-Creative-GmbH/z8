import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	ne,
	notExists,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team, teamMembership } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type {
	OrgExplorerGroup,
	OrgExplorerPerson,
	OrgExplorerSearchResult,
	OrgExplorerTeam,
} from "./org-explorer-types";

/**
 * The Org Explorer's reads (#1576). Everyone they return is on the
 * organization's current roster, and every id they return points at someone
 * who is too: former employees appear nowhere, not even as a manager or a
 * team lead. Team membership comes from team memberships alone (ADR 0010).
 */

/** The longest reporting line a path walks before it stops, in case the data loops. */
const MAX_PATH_DEPTH = 50;

const managerEmployee = alias(employee, "manager_employee");
const managerUser = alias(user, "manager_user");
const reportEmployee = alias(employee, "report_employee");
const lineLink = alias(employeeManagers, "line_link");
const lineManagerEmployee = alias(employee, "line_manager_employee");
const lineManagerUser = alias(user, "line_manager_user");

/** How many people are on the current roster. */
export async function countCurrentRoster(
	db: DatabaseClient,
	organizationId: string,
) {
	const [row] = await db
		.select({ value: count() })
		.from(employee)
		.where(onCurrentRoster(organizationId));
	return row?.value ?? 0;
}

/** The viewer's own employee record, when they are on the current roster. */
export async function findCurrentRosterViewer(
	db: DatabaseClient,
	organizationId: string,
	userId: string,
) {
	const [row] = await db
		.select({ employeeId: employee.id })
		.from(employee)
		.where(and(eq(employee.userId, userId), onCurrentRoster(organizationId)))
		.limit(1);
	return row?.employeeId ?? null;
}

/**
 * People on the current roster with their teams and reporting lines: everyone
 * when `employeeIds` is "all", else the ones named. Ordered by name.
 */
export async function loadCurrentRosterPeople(
	db: DatabaseClient,
	organizationId: string,
	employeeIds: readonly string[] | "all",
): Promise<OrgExplorerPerson[]> {
	if (employeeIds !== "all" && employeeIds.length === 0) return [];

	const rows = await db
		.select({
			employeeId: employee.id,
			userId: employee.userId,
			name: user.name,
			pronouns: employee.pronouns,
			email: user.email,
			image: user.image,
			position: employee.position,
			primaryTeamId: employee.teamId,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			employeeIds === "all"
				? onCurrentRoster(organizationId)
				: and(
						onCurrentRoster(organizationId),
						inArray(employee.id, [...employeeIds]),
					),
		)
		.orderBy(asc(user.name), asc(employee.id));
	if (rows.length === 0) return [];

	const ids = rows.map((row) => row.employeeId);
	const [teamsByEmployee, { managers, primaryManagers }, reportsByManager] =
		await Promise.all([
			loadTeamsByEmployee(db, organizationId, rows),
			loadCurrentManagersByEmployee(db, organizationId, ids),
			loadCurrentReportsByManager(db, organizationId, ids),
		]);
	const unresolvedReports = [
		...new Set([...reportsByManager.values()].flat()),
	].filter((id) => !managers.has(id));
	const reportManagers = new Map([
		...managers,
		...(
			await loadCurrentManagersByEmployee(db, organizationId, unresolvedReports)
		).managers,
	]);

	return rows.map((row) => {
		const reportIds = reportsByManager.get(row.employeeId) ?? [];
		return {
			...row,
			...(teamsByEmployee.get(row.employeeId) ?? {
				primaryTeamId: null,
				teamIds: [],
			}),
			managerIds: managers.get(row.employeeId) ?? [],
			primaryManagerId: primaryManagers.get(row.employeeId) ?? null,
			reportIds,
			lineReportIds: reportIds.filter(
				(reportId) => reportManagers.get(reportId)?.[0] === row.employeeId,
			),
		};
	});
}

/** The named people and everyone on their reporting lines up to the top. */
export async function loadCurrentRosterPeopleWithPaths(
	db: DatabaseClient,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<OrgExplorerPerson[]> {
	const loaded = new Map<string, OrgExplorerPerson>();
	let frontier = [...new Set(employeeIds)];

	for (
		let depth = 0;
		frontier.length > 0 && depth < MAX_PATH_DEPTH;
		depth += 1
	) {
		const people = await loadCurrentRosterPeople(db, organizationId, frontier);
		for (const entry of people) loaded.set(entry.employeeId, entry);
		frontier = [
			...new Set(
				people
					.map((entry) => entry.managerIds[0])
					.filter(
						(id): id is string => Boolean(id) && !loaded.has(id as string),
					),
			),
		];
	}

	return [...loaded.values()];
}

/** The organization's teams, with their current team lead and the current roster's memberships. */
export async function loadOrgExplorerTeams(
	db: DatabaseClient,
	organizationId: string,
): Promise<OrgExplorerTeam[]> {
	const leadEmployee = alias(employee, "lead_employee");
	const [teams, memberCounts] = await Promise.all([
		db
			.select({
				teamId: team.id,
				name: team.name,
				description: team.description,
				leadEmployeeId: leadEmployee.id,
			})
			.from(team)
			.leftJoin(
				leadEmployee,
				and(
					eq(team.primaryManagerId, leadEmployee.id),
					onCurrentRoster(organizationId, leadEmployee),
				),
			)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name), asc(team.id)),
		db
			.select({ teamId: teamMembership.teamId, value: count() })
			.from(teamMembership)
			.innerJoin(employee, eq(teamMembership.employeeId, employee.id))
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					onCurrentRoster(organizationId),
				),
			)
			.groupBy(teamMembership.teamId),
	]);
	const countsByTeam = new Map(
		memberCounts.map((row) => [row.teamId, row.value]),
	);

	return teams.map((row) => ({
		...row,
		memberCount: countsByTeam.get(row.teamId) ?? 0,
	}));
}

/** A page of people by name: `nextOffset` is where the next page starts, or null after the last. */
export type IdPage = { ids: string[]; nextOffset: number | null };

export type PageRequest = { offset: number; limit: number };

/** A page of the current members of one of this organization's teams, by name. */
export async function loadCurrentTeamMemberIds(
	db: DatabaseClient,
	organizationId: string,
	teamId: string,
	page: PageRequest,
): Promise<IdPage> {
	const rows = await db
		.select({ employeeId: employee.id })
		.from(teamMembership)
		.innerJoin(team, eq(teamMembership.teamId, team.id))
		.innerJoin(employee, eq(teamMembership.employeeId, employee.id))
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(team.organizationId, organizationId),
				eq(teamMembership.teamId, teamId),
				onCurrentRoster(organizationId),
			),
		)
		.orderBy(asc(user.name), asc(employee.id))
		.offset(page.offset)
		.limit(page.limit + 1);
	return toIdPage(rows, page);
}

/** The top of the reporting lines: people with no current manager who have current line reports. */
export async function loadReportingLineRootIds(
	db: DatabaseClient,
	organizationId: string,
) {
	const rows = await db
		.select({ employeeId: employee.id })
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			and(
				onCurrentRoster(organizationId),
				notExists(currentManagerLink(db, organizationId)),
				exists(currentLineReportLink(db, organizationId)),
			),
		)
		.orderBy(asc(user.name), asc(employee.id));
	return rows.map((row) => row.employeeId);
}

/** How many people have no reporting line and how many have no team membership. */
export async function countUnplacedPeople(
	db: DatabaseClient,
	organizationId: string,
) {
	const [row] = await db
		.select({
			noReportingLine: sql<number>`count(*) filter (where ${noReportingLine(db, organizationId)})::int`,
			noTeam: sql<number>`count(*) filter (where ${notExists(currentTeamMembership(db, organizationId))})::int`,
		})
		.from(employee)
		.where(onCurrentRoster(organizationId));
	return {
		noReportingLineCount: row?.noReportingLine ?? 0,
		noTeamCount: row?.noTeam ?? 0,
	};
}

/** A page of the people in a group, by name. */
export async function loadUnplacedPeopleIds(
	db: DatabaseClient,
	organizationId: string,
	group: OrgExplorerGroup,
	page: PageRequest,
): Promise<IdPage> {
	const rows = await db
		.select({ employeeId: employee.id })
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			and(
				onCurrentRoster(organizationId),
				group === "noReportingLine"
					? noReportingLine(db, organizationId)
					: notExists(currentTeamMembership(db, organizationId)),
			),
		)
		.orderBy(asc(user.name), asc(employee.id))
		.offset(page.offset)
		.limit(page.limit + 1);
	return toIdPage(rows, page);
}

/** Rows fetched one past the page tell whether another page follows. */
function toIdPage(rows: Array<{ employeeId: string }>, page: PageRequest) {
	return {
		ids: rows.slice(0, page.limit).map((row) => row.employeeId),
		nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
	};
}

/** Current employees whose name, email or position matches the query. */
export async function searchCurrentRoster(
	db: DatabaseClient,
	organizationId: string,
	query: string,
): Promise<OrgExplorerSearchResult[]> {
	const pattern = `%${query}%`;
	return await db
		.select({
			employeeId: employee.id,
			name: user.name,
			pronouns: employee.pronouns,
			email: user.email,
			position: employee.position,
			image: user.image,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(
			and(
				onCurrentRoster(organizationId),
				or(
					ilike(user.name, pattern),
					ilike(user.email, pattern),
					ilike(user.firstName, pattern),
					ilike(user.lastName, pattern),
					ilike(employee.position, pattern),
				),
			),
		)
		.orderBy(asc(user.name), asc(user.email))
		.limit(10);
}

/**
 * Each person's team memberships, the primary team first, and their primary
 * team when it is one of them.
 */
async function loadTeamsByEmployee(
	db: DatabaseClient,
	organizationId: string,
	people: Array<{ employeeId: string; primaryTeamId: string | null }>,
) {
	const rows = await db
		.select({
			employeeId: teamMembership.employeeId,
			teamId: teamMembership.teamId,
		})
		.from(teamMembership)
		.innerJoin(team, eq(teamMembership.teamId, team.id))
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(team.organizationId, organizationId),
				inArray(
					teamMembership.employeeId,
					people.map((entry) => entry.employeeId),
				),
			),
		)
		.orderBy(asc(team.name), asc(team.id));
	const grouped = groupIds(rows.map((row) => [row.employeeId, row.teamId]));

	const teams = new Map<
		string,
		{ primaryTeamId: string | null; teamIds: string[] }
	>();
	for (const { employeeId, primaryTeamId } of people) {
		const teamIds = grouped.get(employeeId) ?? [];
		teams.set(
			employeeId,
			primaryTeamId && teamIds.includes(primaryTeamId)
				? {
						primaryTeamId,
						teamIds: [
							primaryTeamId,
							...teamIds.filter((id) => id !== primaryTeamId),
						],
					}
				: { primaryTeamId: null, teamIds },
		);
	}
	return teams;
}
/**
 * Each person's current managers, the reporting line first: the primary manager,
 * or, when they left or none is marked, the first remaining manager by name.
 * `primaryManagers` holds only managers actually marked primary.
 */
async function loadCurrentManagersByEmployee(
	db: DatabaseClient,
	organizationId: string,
	employeeIds: string[],
) {
	if (employeeIds.length === 0)
		return {
			managers: new Map<string, string[]>(),
			primaryManagers: new Map<string, string>(),
		};
	const rows = await db
		.select({
			employeeId: employeeManagers.employeeId,
			managerId: employeeManagers.managerId,
			isPrimary: employeeManagers.isPrimary,
		})
		.from(employeeManagers)
		.innerJoin(
			managerEmployee,
			eq(employeeManagers.managerId, managerEmployee.id),
		)
		.innerJoin(managerUser, eq(managerEmployee.userId, managerUser.id))
		.where(
			and(
				inArray(employeeManagers.employeeId, employeeIds),
				onCurrentRoster(organizationId, managerEmployee),
			),
		)
		.orderBy(
			desc(employeeManagers.isPrimary),
			asc(managerUser.name),
			asc(managerEmployee.id),
		);
	const current = rows.filter((row) => row.managerId !== row.employeeId);
	const primaryManagers = new Map<string, string>();
	for (const row of current) {
		if (row.isPrimary && !primaryManagers.has(row.employeeId))
			primaryManagers.set(row.employeeId, row.managerId);
	}
	return {
		managers: groupIds(current.map((row) => [row.employeeId, row.managerId])),
		primaryManagers,
	};
}

/** Each manager's current direct reports, through any of the reports' managers. */
async function loadCurrentReportsByManager(
	db: DatabaseClient,
	organizationId: string,
	managerIds: string[],
) {
	const rows = await db
		.select({
			managerId: employeeManagers.managerId,
			employeeId: employeeManagers.employeeId,
		})
		.from(employeeManagers)
		.innerJoin(
			reportEmployee,
			eq(employeeManagers.employeeId, reportEmployee.id),
		)
		.innerJoin(user, eq(reportEmployee.userId, user.id))
		.where(
			and(
				inArray(employeeManagers.managerId, managerIds),
				onCurrentRoster(organizationId, reportEmployee),
			),
		)
		.orderBy(asc(user.name), asc(reportEmployee.id));
	return groupIds(
		rows
			.filter((row) => row.managerId !== row.employeeId)
			.map((row) => [row.managerId, row.employeeId]),
	);
}

/** A current manager of the outer `employee`. */
function currentManagerLink(db: DatabaseClient, organizationId: string) {
	return db
		.select({ id: employeeManagers.id })
		.from(employeeManagers)
		.innerJoin(
			managerEmployee,
			eq(employeeManagers.managerId, managerEmployee.id),
		)
		.where(
			and(
				eq(employeeManagers.employeeId, employee.id),
				ne(employeeManagers.managerId, employee.id),
				onCurrentRoster(organizationId, managerEmployee),
			),
		);
}

/** A current direct report of the outer `employee` whose reporting line runs to them. */
function currentLineReportLink(db: DatabaseClient, organizationId: string) {
	return db
		.select({ id: employeeManagers.id })
		.from(employeeManagers)
		.innerJoin(
			reportEmployee,
			eq(employeeManagers.employeeId, reportEmployee.id),
		)
		.where(
			and(
				eq(employeeManagers.managerId, employee.id),
				ne(employeeManagers.employeeId, employee.id),
				onCurrentRoster(organizationId, reportEmployee),
				eq(sql`(${lineManagerOfReport(db, organizationId)})`, employee.id),
			),
		);
}

/**
 * The outer `report_employee`'s line manager, in `loadCurrentManagersByEmployee`'s
 * order: the primary manager, or, when they left or none is marked, the first
 * remaining manager by name.
 */
function lineManagerOfReport(db: DatabaseClient, organizationId: string) {
	return db
		.select({ id: lineLink.managerId })
		.from(lineLink)
		.innerJoin(
			lineManagerEmployee,
			eq(lineLink.managerId, lineManagerEmployee.id),
		)
		.innerJoin(
			lineManagerUser,
			eq(lineManagerEmployee.userId, lineManagerUser.id),
		)
		.where(
			and(
				eq(lineLink.employeeId, reportEmployee.id),
				ne(lineLink.managerId, reportEmployee.id),
				onCurrentRoster(organizationId, lineManagerEmployee),
			),
		)
		.orderBy(
			desc(lineLink.isPrimary),
			asc(lineManagerUser.name),
			asc(lineManagerEmployee.id),
		)
		.limit(1);
}

/** A team membership of the outer `employee` in one of this organization's teams. */
function currentTeamMembership(db: DatabaseClient, organizationId: string) {
	return db
		.select({ id: teamMembership.id })
		.from(teamMembership)
		.innerJoin(team, eq(teamMembership.teamId, team.id))
		.where(
			and(
				eq(teamMembership.employeeId, employee.id),
				eq(teamMembership.organizationId, organizationId),
				eq(team.organizationId, organizationId),
			),
		);
}

/**
 * The outer `employee` has no current manager and no current line report:
 * `hasNoReportingLine` in `org-explorer-tree.ts` is the same rule.
 */
function noReportingLine(db: DatabaseClient, organizationId: string): SQL {
	return sql`(${notExists(currentManagerLink(db, organizationId))} and ${notExists(currentLineReportLink(db, organizationId))})`;
}

function groupIds(pairs: Array<[string, string]>) {
	const grouped = new Map<string, string[]>();
	for (const [key, id] of pairs) {
		const ids = grouped.get(key);
		if (!ids) grouped.set(key, [id]);
		else if (!ids.includes(id)) ids.push(id);
	}
	return grouped;
}
