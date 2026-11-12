"use server";

import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { Effect } from "effect";
import { organization, session } from "@/db/auth-schema";
import {
	absenceEntry,
	approvalRequest,
	employee,
	team,
	teamPermissions,
	timeEntry,
} from "@/db/schema";
import { instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { monthStartsAt } from "./month-starts";

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

export interface ManagerStatisticsReadView extends StatisticsBase {}

/**
 * The teams whose statistics a scoped manager reads: the teams whose settings they
 * manage, when their employee role is manager; none otherwise. An org admin reads
 * the organization's statistics instead.
 */
function manageableTeamIds(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		const managerId =
			actor.settingsAccess === "scopedManager" && actor.employee?.role === "manager"
				? actor.employee.id
				: null;
		if (!managerId) {
			return new Set<string>();
		}
		const dbService = yield* DatabaseService;
		const teamPermissionRows = yield* dbService.query("statistics.manageableTeams", () =>
			dbService.db.query.teamPermissions.findMany({
				where: and(
					eq(teamPermissions.employeeId, managerId),
					eq(teamPermissions.organizationId, organizationId),
					eq(teamPermissions.canManageTeamSettings, true),
				),
				columns: { teamId: true },
			}),
		);
		return new Set(
			teamPermissionRows
				.map((permission) => permission.teamId)
				.filter((teamId): teamId is string => Boolean(teamId)),
		);
	});
}

/** This and last month's starts in the organization's time zone (docs/refs/timekeeping.md). */
function organizationMonthStarts(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("statistics.organizationTimezone", () =>
			dbService.db.query.organization.findFirst({
				where: eq(organization.id, organizationId),
				columns: { timezone: true },
			}),
		);
		const { timezone } = resolveOrganizationTimezone(row?.timezone);
		return monthStartsAt(systemClock.nowInstant(), timezone);
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
		fetchedAt: instantToCanonicalString(systemClock.nowInstant()),
	};
}

/**
 * Get active-organization statistics.
 * Only accessible by org admins.
 */
export const getOrganizationStats = organizationAction(
	{ name: "statistics.getOrganizationStats", requires: "orgAdmin", schema: noInput },
	({ organizationId }) => organizationStats(organizationId),
);


function organizationStats(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const { db } = dbService;

		const { thisMonth: firstDayThisMonth, lastMonth: firstDayLastMonth } =
			yield* organizationMonthStarts(organizationId);

		const results = yield* dbService.query("statistics.getOrganizationCounts", () =>
			Promise.all([
				db
					.select({ count: count() })
					.from(employee)
					.where(eq(employee.organizationId, organizationId)),
				db
					.select({ count: count() })
					.from(employee)
					.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true))),
				db.select({ count: count() }).from(team).where(eq(team.organizationId, organizationId)),
				db
					.select({ count: count() })
					.from(timeEntry)
					.where(eq(timeEntry.organizationId, organizationId)),
				db
					.select({ count: count() })
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, organizationId),
							gte(timeEntry.timestamp, firstDayThisMonth),
						),
					),
				db
					.select({ count: count() })
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, organizationId),
							gte(timeEntry.timestamp, firstDayLastMonth),
							lt(timeEntry.timestamp, firstDayThisMonth),
						),
					),
				db
					.select({ count: count() })
					.from(absenceEntry)
					.where(eq(absenceEntry.organizationId, organizationId)),
				db
					.select({ count: count() })
					.from(absenceEntry)
					.where(
						and(
							eq(absenceEntry.organizationId, organizationId),
							eq(absenceEntry.status, "pending"),
						),
					),
				db
					.select({ count: count() })
					.from(absenceEntry)
					.where(
						and(
							eq(absenceEntry.organizationId, organizationId),
							eq(absenceEntry.status, "approved"),
						),
					),
				db
					.select({ count: count() })
					.from(absenceEntry)
					.where(
						and(
							eq(absenceEntry.organizationId, organizationId),
							eq(absenceEntry.status, "rejected"),
						),
					),
				db
					.select({ count: count() })
					.from(approvalRequest)
					.where(eq(approvalRequest.organizationId, organizationId)),
				db
					.select({ count: count() })
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.organizationId, organizationId),
							eq(approvalRequest.status, "pending"),
						),
					),
				db
					.select({ count: count() })
					.from(session)
					.where(eq(session.activeOrganizationId, organizationId)),
			]),
		);

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
}

/** Statistics of the teams whose settings a scoped manager manages. */
export const getManagerStatisticsReadView = organizationAction(
	{ name: "statistics.getManagerReadView", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const { db } = dbService;
			const teamIdSet = yield* manageableTeamIds(actor, organizationId);

			if (teamIdSet.size === 0) {
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

			const teamIds = [...teamIdSet];
			const { thisMonth: firstDayThisMonth, lastMonth: firstDayLastMonth } =
				yield* organizationMonthStarts(organizationId);

			const teamScopedEmployees = yield* dbService.query("statistics.getScopedEmployees", () =>
				db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, organizationId),
						inArray(employee.teamId, teamIds),
					),
					columns: {
						id: true,
						isActive: true,
					},
				}),
			);

			const scopedEmployeeIds = teamScopedEmployees.map((employeeRecord) => employeeRecord.id);
			const totalEmployees = teamScopedEmployees.length;
			const activeEmployees = teamScopedEmployees.filter(
				(employeeRecord) => employeeRecord.isActive,
			).length;

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

			const results = yield* dbService.query("statistics.getManagerCounts", () =>
				Promise.all([
					db
						.select({ count: count() })
						.from(team)
						.where(and(eq(team.organizationId, organizationId), inArray(team.id, teamIds))),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, organizationId),
								inArray(timeEntry.employeeId, scopedEmployeeIds),
							),
						),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, organizationId),
								inArray(timeEntry.employeeId, scopedEmployeeIds),
								gte(timeEntry.timestamp, firstDayThisMonth),
							),
						),
					db
						.select({ count: count() })
						.from(timeEntry)
						.where(
							and(
								eq(timeEntry.organizationId, organizationId),
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
								eq(absenceEntry.organizationId, organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
								eq(absenceEntry.status, "pending"),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
								eq(absenceEntry.status, "approved"),
							),
						),
					db
						.select({ count: count() })
						.from(absenceEntry)
						.where(
							and(
								eq(absenceEntry.organizationId, organizationId),
								inArray(absenceEntry.employeeId, scopedEmployeeIds),
								eq(absenceEntry.status, "rejected"),
							),
						),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, organizationId),
								inArray(approvalRequest.requestedBy, scopedEmployeeIds),
							),
						),
					db
						.select({ count: count() })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, organizationId),
								inArray(approvalRequest.requestedBy, scopedEmployeeIds),
								eq(approvalRequest.status, "pending"),
							),
						),
				]),
			);

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
		}),
);
