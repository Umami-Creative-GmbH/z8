"use server";

import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, team, teamMembership } from "@/db/schema";
import { auth } from "@/lib/auth";
import { AuthenticationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { buildOrgChartGraph } from "./org-chart-graph";
import {
	EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT,
	SMALL_ORG_EMPLOYEE_LIMIT,
	TEAM_NEIGHBORHOOD_MEMBER_LIMIT,
	type OrgChartGraph,
	type OrgChartSearchResult,
} from "./org-chart-types";

type DatabaseServiceInstance = typeof DatabaseService.Service;

type EmployeeGraphRow = {
	id: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	position: string | null;
	role: "admin" | "manager" | "employee";
	isActive: boolean;
	teamIds: string[];
};

type TeamGraphRow = {
	id: string;
	name: string;
	description: string | null;
	memberCount: number;
	primaryManagerId: string | null;
};

type ManagerLinkRow = {
	managerId: string;
	employeeId: string;
};

type TeamMembershipRow = {
	teamId: string;
	employeeId: string;
};

type OrgChartContext = {
	organizationId: string;
	currentEmployee: typeof employee.$inferSelect;
};

export async function getOrgChartInitialGraph(): Promise<ServerActionResult<OrgChartGraph>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { organizationId, currentEmployee } = yield* _(resolveOrgChartContext(dbService));
		const employeeCount = yield* _(countActiveEmployees(dbService, organizationId));

		if (employeeCount < SMALL_ORG_EMPLOYEE_LIMIT) {
			return yield* _(loadFullGraph(dbService, organizationId, employeeCount, currentEmployee.id));
		}

		return yield* _(
			loadEmployeeNeighborhood(dbService, organizationId, employeeCount, currentEmployee.id, {
				partial: true,
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function searchOrgEmployees(
	query: string,
): Promise<ServerActionResult<OrgChartSearchResult[]>> {
	const trimmedQuery = query.trim();
	if (trimmedQuery.length < 2) {
		return { success: true, data: [] };
	}

	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { organizationId } = yield* _(resolveOrgChartContext(dbService));
		const pattern = `%${trimmedQuery}%`;

		return yield* _(
			dbService.query("searchOrgEmployees", async () => {
				const rows = await dbService.db
					.select({
						employeeId: employee.id,
						name: user.name,
						email: user.email,
						position: employee.position,
						image: user.image,
						role: employee.role,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.where(
						and(
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
							or(
								ilike(user.name, pattern),
								ilike(user.email, pattern),
								ilike(employee.firstName, pattern),
								ilike(employee.lastName, pattern),
								ilike(employee.position, pattern),
							),
						),
					)
					.orderBy(asc(user.name), asc(user.email))
					.limit(10);

				return rows satisfies OrgChartSearchResult[];
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getEmployeeNeighborhood(
	employeeId: string,
): Promise<ServerActionResult<OrgChartGraph>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { organizationId } = yield* _(resolveOrgChartContext(dbService));
		const employeeCount = yield* _(countActiveEmployees(dbService, organizationId));

		return yield* _(
			loadEmployeeNeighborhood(dbService, organizationId, employeeCount, employeeId, {
				partial: employeeCount >= SMALL_ORG_EMPLOYEE_LIMIT,
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function getTeamNeighborhood(teamId: string): Promise<ServerActionResult<OrgChartGraph>> {
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { organizationId } = yield* _(resolveOrgChartContext(dbService));
		const employeeCount = yield* _(countActiveEmployees(dbService, organizationId));

		return yield* _(loadTeamNeighborhood(dbService, organizationId, employeeCount, teamId));
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

function resolveOrgChartContext(dbService: DatabaseServiceInstance) {
	return Effect.gen(function* (_) {
		const session = yield* _(
			Effect.promise(async () => auth.api.getSession({ headers: await headers() })),
		);

		if (!session?.user) {
			return yield* _(
				Effect.fail(
					new AuthenticationError({
						message: "Authentication required",
					}),
				),
			);
		}

		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new AuthenticationError({
						message: "Active organization required",
						userId: session.user.id,
					}),
				),
			);
		}

		const currentEmployee = yield* _(
			dbService.query("getOrgChartCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
				});
			}),
		);

		if (!currentEmployee) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
			);
		}

		return { organizationId, currentEmployee } satisfies OrgChartContext;
	});
}

function countActiveEmployees(dbService: DatabaseServiceInstance, organizationId: string) {
	return Effect.gen(function* (_) {
		const [row] = yield* _(
			dbService.query("countActiveOrgChartEmployees", async () => {
				return await dbService.db
					.select({ value: count() })
					.from(employee)
					.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)));
			}),
		);

		return row?.value ?? 0;
	});
}

function loadFullGraph(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeCount: number,
	focusedEmployeeId: string,
) {
	return Effect.gen(function* (_) {
		const employees = yield* _(loadActiveEmployees(dbService, organizationId));
		const activeEmployeeIds = employees.map((row) => row.id);
		const teams = yield* _(loadTeams(dbService, organizationId));
		const managerLinks = yield* _(loadManagerLinks(dbService, activeEmployeeIds));
		const teamMemberships = yield* _(loadTeamMemberships(dbService, organizationId));

		return buildOrgChartGraph({
			mode: "full",
			focusedEmployeeId,
			employeeCount,
			partial: false,
			employees,
			teams,
			managerLinks,
			teamMemberships,
		});
	});
}

function loadEmployeeNeighborhood(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeCount: number,
	employeeId: string,
	options: { partial: boolean },
) {
	return Effect.gen(function* (_) {
		const targetEmployee = yield* _(ensureActiveEmployee(dbService, organizationId, employeeId));
		const directManagerLinks = yield* _(loadDirectManagerLinks(dbService, organizationId, employeeId));
		const directReportLinks = yield* _(loadDirectReportLinks(dbService, organizationId, employeeId));
		const targetTeamMemberships = yield* _(loadEmployeeTeamMemberships(dbService, organizationId, employeeId));
		const connectedTeamIds = targetTeamMemberships.map((membership) => membership.teamId);
		const teams = yield* _(loadTeamsByIds(dbService, organizationId, connectedTeamIds));
		const primaryManagerIds = teams
			.map((teamRow) => teamRow.primaryManagerId)
			.filter((id): id is string => Boolean(id));
		const teamMemberMemberships = yield* _(
			loadLimitedActiveTeamMemberships(
				dbService,
				organizationId,
				connectedTeamIds,
				EMPLOYEE_NEIGHBORHOOD_TEAM_MEMBER_LIMIT,
			),
		);
		const employeeIds = new Set<string>([
			targetEmployee.id,
			...directManagerLinks.map((link) => link.managerId),
			...directReportLinks.map((link) => link.employeeId),
			...teamMemberMemberships.map((membership) => membership.employeeId),
			...primaryManagerIds,
		]);
		const employees = yield* _(loadActiveEmployeesByIds(dbService, organizationId, [...employeeIds]));

		return buildOrgChartGraph({
			mode: "focused",
			focusedEmployeeId: targetEmployee.id,
			employeeCount,
			partial: options.partial,
			employees,
			teams,
			managerLinks: [...directManagerLinks, ...directReportLinks],
			teamMemberships: dedupeMemberships([...targetTeamMemberships, ...teamMemberMemberships]),
		});
	});
}

function loadTeamNeighborhood(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeCount: number,
	teamId: string,
) {
	return Effect.gen(function* (_) {
		const [targetTeam] = yield* _(loadTeamsByIds(dbService, organizationId, [teamId]));
		if (!targetTeam) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Team not found",
						entityType: "team",
						entityId: teamId,
					}),
				),
			);
		}

		const memberships = yield* _(
			loadLimitedActiveTeamMemberships(dbService, organizationId, [teamId], TEAM_NEIGHBORHOOD_MEMBER_LIMIT),
		);
		const employeeIds = new Set<string>(memberships.map((membership) => membership.employeeId));
		if (targetTeam.primaryManagerId) {
			employeeIds.add(targetTeam.primaryManagerId);
		}
		const employees = yield* _(loadActiveEmployeesByIds(dbService, organizationId, [...employeeIds]));

		return buildOrgChartGraph({
			mode: "focused",
			focusedEmployeeId: null,
			employeeCount,
			partial: employeeCount >= SMALL_ORG_EMPLOYEE_LIMIT,
			employees,
			teams: [targetTeam],
			managerLinks: [],
			teamMemberships: memberships,
		});
	});
}

function ensureActiveEmployee(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeId: string,
) {
	return Effect.gen(function* (_) {
		const targetEmployee = yield* _(
			dbService.query("getOrgChartTargetEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, employeeId),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
				});
			}),
		);

		if (!targetEmployee) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				),
			);
		}

		return targetEmployee;
	});
}

function loadActiveEmployees(dbService: DatabaseServiceInstance, organizationId: string) {
	return dbService.query("loadOrgChartEmployees", async () => {
		const rows = await dbService.db
			.select({
				id: employee.id,
				userId: employee.userId,
				name: user.name,
				email: user.email,
				image: user.image,
				position: employee.position,
				role: employee.role,
				isActive: employee.isActive,
			})
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
			.orderBy(asc(user.name), asc(user.email));

		return withEmployeeTeamIds(dbService, organizationId, rows);
	});
}

function loadActiveEmployeesByIds(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeIds: string[],
) {
	if (employeeIds.length === 0) {
		return Effect.succeed([] satisfies EmployeeGraphRow[]);
	}

	return dbService.query("loadOrgChartEmployeesByIds", async () => {
		const rows = await dbService.db
			.select({
				id: employee.id,
				userId: employee.userId,
				name: user.name,
				email: user.email,
				image: user.image,
				position: employee.position,
				role: employee.role,
				isActive: employee.isActive,
			})
			.from(employee)
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					inArray(employee.id, employeeIds),
				),
			)
			.orderBy(asc(user.name), asc(user.email));

		return withEmployeeTeamIds(dbService, organizationId, rows);
	});
}

async function withEmployeeTeamIds(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	rows: Array<Omit<EmployeeGraphRow, "teamIds">>,
): Promise<EmployeeGraphRow[]> {
	if (rows.length === 0) {
		return [];
	}

	const memberships = await dbService.db
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
					rows.map((row) => row.id),
				),
			),
		);
	const teamIdsByEmployeeId = new Map<string, string[]>();
	for (const membership of memberships) {
		const teamIds = teamIdsByEmployeeId.get(membership.employeeId) ?? [];
		teamIds.push(membership.teamId);
		teamIdsByEmployeeId.set(membership.employeeId, teamIds);
	}

	return rows.map((row) => ({
		...row,
		teamIds: teamIdsByEmployeeId.get(row.id) ?? [],
	}));
}

function loadTeams(dbService: DatabaseServiceInstance, organizationId: string) {
	return dbService.query("loadOrgChartTeams", async () => {
		const rows = await dbService.db
			.select({
				id: team.id,
				name: team.name,
				description: team.description,
				primaryManagerId: team.primaryManagerId,
			})
			.from(team)
			.where(eq(team.organizationId, organizationId))
			.orderBy(asc(team.name));

		return withTeamMemberCounts(dbService, organizationId, rows);
	});
}

function loadTeamsByIds(dbService: DatabaseServiceInstance, organizationId: string, teamIds: string[]) {
	if (teamIds.length === 0) {
		return Effect.succeed([] satisfies TeamGraphRow[]);
	}

	return dbService.query("loadOrgChartTeamsByIds", async () => {
		const rows = await dbService.db
			.select({
				id: team.id,
				name: team.name,
				description: team.description,
				primaryManagerId: team.primaryManagerId,
			})
			.from(team)
			.where(and(eq(team.organizationId, organizationId), inArray(team.id, teamIds)))
			.orderBy(asc(team.name));

		return withTeamMemberCounts(dbService, organizationId, rows);
	});
}

async function withTeamMemberCounts(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	rows: Array<Omit<TeamGraphRow, "memberCount">>,
): Promise<TeamGraphRow[]> {
	if (rows.length === 0) {
		return [];
	}

	const memberCounts = await dbService.db
		.select({
			teamId: teamMembership.teamId,
			value: count(),
		})
		.from(teamMembership)
		.innerJoin(employee, eq(teamMembership.employeeId, employee.id))
		.innerJoin(team, eq(teamMembership.teamId, team.id))
		.where(
			and(
				eq(teamMembership.organizationId, organizationId),
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
				eq(team.organizationId, organizationId),
				inArray(
					teamMembership.teamId,
					rows.map((row) => row.id),
				),
			),
		)
		.groupBy(teamMembership.teamId);
	const countsByTeamId = new Map(memberCounts.map((row) => [row.teamId, row.value]));

	return rows.map((row) => ({
		...row,
		memberCount: countsByTeamId.get(row.id) ?? 0,
	}));
}

function loadManagerLinks(dbService: DatabaseServiceInstance, activeEmployeeIds: string[]) {
	if (activeEmployeeIds.length === 0) {
		return Effect.succeed([] satisfies ManagerLinkRow[]);
	}

	return dbService.query("loadOrgChartManagerLinks", async () => {
		return await dbService.db
			.select({
				managerId: employeeManagers.managerId,
				employeeId: employeeManagers.employeeId,
			})
			.from(employeeManagers)
			.where(
				and(
					inArray(employeeManagers.managerId, activeEmployeeIds),
					inArray(employeeManagers.employeeId, activeEmployeeIds),
				),
			);
	});
}

function loadDirectManagerLinks(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeId: string,
) {
	return dbService.query("loadOrgChartDirectManagerLinks", async () => {
		return await dbService.db
			.select({
				managerId: employeeManagers.managerId,
				employeeId: employeeManagers.employeeId,
			})
			.from(employeeManagers)
			.innerJoin(employee, eq(employeeManagers.managerId, employee.id))
			.where(
				and(
					eq(employeeManagers.employeeId, employeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			);
	});
}

function loadDirectReportLinks(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeId: string,
) {
	return dbService.query("loadOrgChartDirectReportLinks", async () => {
		return await dbService.db
			.select({
				managerId: employeeManagers.managerId,
				employeeId: employeeManagers.employeeId,
			})
			.from(employeeManagers)
			.innerJoin(employee, eq(employeeManagers.employeeId, employee.id))
			.where(
				and(
					eq(employeeManagers.managerId, employeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			);
	});
}

function loadTeamMemberships(dbService: DatabaseServiceInstance, organizationId: string) {
	return dbService.query("loadOrgChartTeamMemberships", async () => {
		return await dbService.db
			.select({
				teamId: teamMembership.teamId,
				employeeId: teamMembership.employeeId,
			})
			.from(teamMembership)
			.innerJoin(employee, eq(teamMembership.employeeId, employee.id))
			.innerJoin(team, eq(teamMembership.teamId, team.id))
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					eq(team.organizationId, organizationId),
				),
			);
	});
}

function loadEmployeeTeamMemberships(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	employeeId: string,
) {
	return dbService.query("loadOrgChartEmployeeTeamMemberships", async () => {
		return await dbService.db
			.select({
				teamId: teamMembership.teamId,
				employeeId: teamMembership.employeeId,
			})
			.from(teamMembership)
			.innerJoin(team, eq(teamMembership.teamId, team.id))
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					eq(teamMembership.employeeId, employeeId),
					eq(team.organizationId, organizationId),
				),
			);
	});
}

function loadLimitedActiveTeamMemberships(
	dbService: DatabaseServiceInstance,
	organizationId: string,
	teamIds: string[],
	limitPerTeam: number,
) {
	if (teamIds.length === 0) {
		return Effect.succeed([] satisfies TeamMembershipRow[]);
	}

	return dbService.query("loadOrgChartLimitedActiveTeamMemberships", async () => {
		const rows = await Promise.all(
			teamIds.map((teamId) =>
				dbService.db
					.select({
						teamId: teamMembership.teamId,
						employeeId: teamMembership.employeeId,
					})
					.from(teamMembership)
					.innerJoin(employee, eq(teamMembership.employeeId, employee.id))
					.innerJoin(team, eq(teamMembership.teamId, team.id))
					.innerJoin(user, eq(employee.userId, user.id))
					.where(
						and(
							eq(teamMembership.organizationId, organizationId),
							eq(teamMembership.teamId, teamId),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
							eq(team.organizationId, organizationId),
						),
					)
					.orderBy(asc(user.name), asc(user.email))
					.limit(limitPerTeam),
			),
		);

		return rows.flat();
	});
}

function dedupeMemberships(memberships: TeamMembershipRow[]) {
	return Array.from(
		new Map(memberships.map((membership) => [`${membership.teamId}:${membership.employeeId}`, membership])).values(),
	);
}
