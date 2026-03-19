"use server";

import { DateTime } from "luxon";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { member, session } from "@/db/auth-schema";
import { absenceEntry, approvalRequest, employee, team, teamPermissions, timeEntry } from "@/db/schema";
import { AuthorizationError, DatabaseError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";

interface StatisticsBase {
	totalEmployees: number;
	activeEmployees: number;
	inactiveEmployees: number;
	totalTeams: number;
	totalTimeEntries: number;
	timeEntriesThisMonth: number;
	timeEntriesLastMonth: number;
	totalAbsences: number;
	pendingAbsences: number;
	approvedAbsences: number;
	rejectedAbsences: number;
	totalApprovals: number;
	pendingApprovals: number;
	fetchedAt: string;
}

export interface OrganizationStats extends StatisticsBase {
	activeSessions: number;
}

export interface InstanceStats extends OrganizationStats {}

export interface ManagerStatisticsReadView extends StatisticsBase {}

interface StatisticsActorContext {
	organizationId: string;
	accessTier: SettingsAccessTier;
	currentEmployee: typeof employee.$inferSelect | null;
	userId: string;
}

function getStatisticsActorContext(queryName: string) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const authSession = yield* authService.getSession();
		const organizationId = authSession.session.activeOrganizationId;

		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "No active organization selected",
					resource: "statistics",
					action: "read",
				}),
			);
		}

		const [membershipRecord, currentEmployee] = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					db.query.member.findFirst({
						where: and(eq(member.userId, authSession.user.id), eq(member.organizationId, organizationId)),
						columns: { role: true },
					}),
					db.query.employee.findFirst({
						where: and(
							eq(employee.userId, authSession.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
					}),
				]),
			catch: () =>
				new DatabaseError({
					message: `Failed to resolve statistics actor for ${queryName}`,
					operation: "query",
				}),
		});

		const accessTier = resolveSettingsAccessTier({
			activeOrganizationId: organizationId,
			membershipRole: isSettingsAccessMembershipRole(membershipRecord?.role)
				? membershipRecord.role
				: null,
			employeeRole: currentEmployee?.role ?? null,
		});

		if (accessTier === "member") {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "You do not have access to statistics",
					resource: "statistics",
					action: "read",
				}),
			);
		}

		return {
			organizationId,
			accessTier,
			currentEmployee: currentEmployee ?? null,
			userId: authSession.user.id,
		} satisfies StatisticsActorContext;
	});
}

function requireOrgAdminStatisticsAccess(actor: StatisticsActorContext) {
	if (actor.accessTier === "orgAdmin") {
		return Effect.void;
	}

	return Effect.fail(
		new AuthorizationError({
			message: "Only org admins can view instance statistics",
			userId: actor.userId,
			resource: "instance-stats",
			action: "read",
		}),
	);
}

function getManageableTeamIds(actor: StatisticsActorContext, queryName: string) {
	return Effect.gen(function* () {
		if (actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		if (!actor.currentEmployee || actor.currentEmployee.role !== "manager") {
			return new Set<string>();
		}

		const currentEmployee = actor.currentEmployee;

		const teamPermissionRows = yield* Effect.tryPromise({
			try: () =>
				db.query.teamPermissions.findMany({
					where: and(
						eq(teamPermissions.employeeId, currentEmployee.id),
						eq(teamPermissions.organizationId, actor.organizationId),
						eq(teamPermissions.canManageTeamSettings, true),
					),
					columns: { teamId: true },
				}),
			catch: () =>
				new DatabaseError({
					message: `Failed to fetch manageable teams for ${queryName}`,
					operation: "query",
					table: "team_permissions",
				}),
		});

		return new Set(
			teamPermissionRows
				.map((permission) => permission.teamId)
				.filter((teamId): teamId is string => Boolean(teamId)),
		);
	});
}

function buildStatisticsBase(params: {
	totalEmployees: number;
	activeEmployees: number;
	totalTeams: number;
	totalTimeEntries: number;
	timeEntriesThisMonth: number;
	timeEntriesLastMonth: number;
	totalAbsences: number;
	pendingAbsences: number;
	approvedAbsences: number;
	rejectedAbsences: number;
	totalApprovals: number;
	pendingApprovals: number;
}): StatisticsBase {
	return {
		...params,
		inactiveEmployees: params.totalEmployees - params.activeEmployees,
		fetchedAt: DateTime.utc().toISO() ?? new Date().toISOString(),
	};
}

/**
 * Get active-organization statistics.
 * Only accessible by org admins.
 */
export async function getOrganizationStats(): Promise<ServerActionResult<OrganizationStats>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getStatisticsActorContext("getOrganizationStats");
		yield* requireOrgAdminStatisticsAccess(actor);

		const firstDayThisMonth = DateTime.now().startOf("month").toJSDate();
		const firstDayLastMonth = DateTime.now().minus({ months: 1 }).startOf("month").toJSDate();

		const results = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					db
						.select({ count: count() })
						.from(employee)
						.where(eq(employee.organizationId, actor.organizationId)),
					db
						.select({ count: count() })
						.from(employee)
						.where(
							and(eq(employee.organizationId, actor.organizationId), eq(employee.isActive, true)),
						),
					db
						.select({ count: count() })
						.from(team)
						.where(eq(team.organizationId, actor.organizationId)),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(eq(timeEntry.organizationId, actor.organizationId)),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, actor.organizationId),
								gte(timeEntry.timestamp, firstDayThisMonth),
							),
						),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, actor.organizationId),
								gte(timeEntry.timestamp, firstDayLastMonth),
								lt(timeEntry.timestamp, firstDayThisMonth),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(eq(absenceEntry.organizationId, actor.organizationId)),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								eq(absenceEntry.status, "pending"),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								eq(absenceEntry.status, "approved"),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								eq(absenceEntry.status, "rejected"),
							),
						),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(eq(approvalRequest.organizationId, actor.organizationId)),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, actor.organizationId),
								eq(approvalRequest.status, "pending"),
							),
						),
					db
						.select({ count: count() })
						.from(session)
						.where(eq(session.activeOrganizationId, actor.organizationId)),
				]),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch instance statistics",
					operation: "query",
				}),
		});

		const [
			employeesResult,
			activeEmployeesResult,
			teamsResult,
			timeEntriesResult,
			timeEntriesThisMonthResult,
			timeEntriesLastMonthResult,
			absencesResult,
			pendingAbsencesResult,
			approvedAbsencesResult,
			rejectedAbsencesResult,
			approvalsResult,
			pendingApprovalsResult,
			sessionsResult,
		] = results;

		const totalEmployees = employeesResult[0]?.count ?? 0;
		const activeEmployees = activeEmployeesResult[0]?.count ?? 0;

		return {
			...buildStatisticsBase({
				totalEmployees,
				activeEmployees,
				totalTeams: teamsResult[0]?.count ?? 0,
				totalTimeEntries: timeEntriesResult[0]?.count ?? 0,
				timeEntriesThisMonth: timeEntriesThisMonthResult[0]?.count ?? 0,
				timeEntriesLastMonth: timeEntriesLastMonthResult[0]?.count ?? 0,
				totalAbsences: absencesResult[0]?.count ?? 0,
				pendingAbsences: pendingAbsencesResult[0]?.count ?? 0,
				approvedAbsences: approvedAbsencesResult[0]?.count ?? 0,
				rejectedAbsences: rejectedAbsencesResult[0]?.count ?? 0,
				totalApprovals: approvalsResult[0]?.count ?? 0,
				pendingApprovals: pendingApprovalsResult[0]?.count ?? 0,
			}),
			activeSessions: sessionsResult[0]?.count ?? 0,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

export async function getInstanceStats(): Promise<ServerActionResult<InstanceStats>> {
	return getOrganizationStats();
}

export async function getManagerStatisticsReadView(): Promise<
	ServerActionResult<ManagerStatisticsReadView>
> {
	const effect = Effect.gen(function* () {
		const actor = yield* getStatisticsActorContext("getManagerStatisticsReadView");
		const manageableTeamIds = yield* getManageableTeamIds(actor, "getManagerStatisticsReadView");

		if (!manageableTeamIds || manageableTeamIds.size === 0) {
			return buildStatisticsBase({
				totalEmployees: 0,
				activeEmployees: 0,
				totalTeams: 0,
				totalTimeEntries: 0,
				timeEntriesThisMonth: 0,
				timeEntriesLastMonth: 0,
				totalAbsences: 0,
				pendingAbsences: 0,
				approvedAbsences: 0,
				rejectedAbsences: 0,
				totalApprovals: 0,
				pendingApprovals: 0,
			});
		}

		const teamIds = [...manageableTeamIds];
		const firstDayThisMonth = DateTime.now().startOf("month").toJSDate();
		const firstDayLastMonth = DateTime.now().minus({ months: 1 }).startOf("month").toJSDate();

		const teamScopedEmployees = yield* Effect.tryPromise({
			try: () =>
				db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, actor.organizationId),
						inArray(employee.teamId, teamIds),
					),
					columns: {
						id: true,
						isActive: true,
					},
				}),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch scoped statistics employees",
					operation: "query",
					table: "employee",
				}),
		});

		const scopedEmployeeIds = teamScopedEmployees.map((employeeRecord) => employeeRecord.id);
		const totalEmployees = teamScopedEmployees.length;
		const activeEmployees = teamScopedEmployees.filter((employeeRecord) => employeeRecord.isActive).length;

		if (scopedEmployeeIds.length === 0) {
			return buildStatisticsBase({
				totalEmployees,
				activeEmployees,
				totalTeams: 0,
				totalTimeEntries: 0,
				timeEntriesThisMonth: 0,
				timeEntriesLastMonth: 0,
				totalAbsences: 0,
				pendingAbsences: 0,
				approvedAbsences: 0,
				rejectedAbsences: 0,
				totalApprovals: 0,
				pendingApprovals: 0,
			});
		}

		const results = yield* Effect.tryPromise({
			try: () =>
				Promise.all([
					db
						.select({ count: count() })
						.from(team)
						.where(and(eq(team.organizationId, actor.organizationId), inArray(team.id, teamIds))),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, actor.organizationId),
								inArray(timeEntry.employeeId, scopedEmployeeIds),
							),
						),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, actor.organizationId),
								inArray(timeEntry.employeeId, scopedEmployeeIds),
								gte(timeEntry.timestamp, firstDayThisMonth),
							),
						),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, actor.organizationId),
								inArray(timeEntry.employeeId, scopedEmployeeIds),
								gte(timeEntry.timestamp, firstDayLastMonth),
								lt(timeEntry.timestamp, firstDayThisMonth),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
								eq(absenceEntry.status, "pending"),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
								eq(absenceEntry.status, "approved"),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, actor.organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
								eq(absenceEntry.status, "rejected"),
							),
						),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, actor.organizationId),
								inArray(approvalRequest.requestedBy, scopedEmployeeIds),
							),
						),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, actor.organizationId),
								inArray(approvalRequest.requestedBy, scopedEmployeeIds),
								eq(approvalRequest.status, "pending"),
							),
						),
				]),
			catch: () =>
				new DatabaseError({
					message: "Failed to fetch manager statistics",
					operation: "query",
				}),
		});

		const [
			teamsResult,
			timeEntriesResult,
			timeEntriesThisMonthResult,
			timeEntriesLastMonthResult,
			absencesResult,
			pendingAbsencesResult,
			approvedAbsencesResult,
			rejectedAbsencesResult,
			approvalsResult,
			pendingApprovalsResult,
		] = results;

		return buildStatisticsBase({
			totalEmployees,
			activeEmployees,
			totalTeams: teamsResult[0]?.count ?? 0,
			totalTimeEntries: timeEntriesResult[0]?.count ?? 0,
			timeEntriesThisMonth: timeEntriesThisMonthResult[0]?.count ?? 0,
			timeEntriesLastMonth: timeEntriesLastMonthResult[0]?.count ?? 0,
			totalAbsences: absencesResult[0]?.count ?? 0,
			pendingAbsences: pendingAbsencesResult[0]?.count ?? 0,
			approvedAbsences: approvedAbsencesResult[0]?.count ?? 0,
			rejectedAbsences: rejectedAbsencesResult[0]?.count ?? 0,
			totalApprovals: approvalsResult[0]?.count ?? 0,
			pendingApprovals: pendingApprovalsResult[0]?.count ?? 0,
		});
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
