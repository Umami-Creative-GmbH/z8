import "server-only";

import {
	and,
	count,
	countDistinct,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	type SQL,
	sql,
} from "drizzle-orm";
import { Effect, Exit } from "effect";
import { organization, session } from "@/db/auth-schema";
import {
	absenceEntry,
	employee,
	team,
	teamPermissions,
	timeRecord,
	workPeriod,
	workPolicyViolation,
} from "@/db/schema";
import {
	type AbsenceDayRange,
	clipAbsenceDayRange,
	countAbsenceDays,
	mondayToFriday,
} from "@/lib/absences/absence-days";
import { loadWorkingDaysForEmployees } from "@/lib/absences/absence-days-resolver";
import {
	type RequirementEmployee,
	loadDailyWorkRequirementsForEmployees,
} from "@/lib/calendar/work-policy-range-requirements";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { onCurrentRoster, rosterCheckInstant } from "@/lib/employee-lifecycle/current-roster";
import { reachesWholeOrganization } from "@/lib/organization-action/managed-scope";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";
import { loadEmployeeTrackingContexts } from "@/lib/time-tracking/tracking-start";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { loadEffectiveWorkPolicies } from "@/lib/work-policy/effective-work-policies";
import { comparisonWindowsAt, type StatisticsWindow } from "./comparison-windows";
import type { Kpi, LikeForLike } from "./statistics-types";

/**
 * Whose figures a viewer reads: the whole organization (org admin, workforce
 * admin), or the employees of the teams whose settings a scoped manager manages.
 */
export type StatisticsScope =
	| { organizationWide: true; organizationId: string }
	| { organizationWide: false; organizationId: string; teamIds: string[] };

/** Live work older than this is stale live work (Time Tracking glossary). */
const STALE_LIVE_WORK_HOURS = 24;
/** Required-time reads run in bounded employee batches, as the payroll period read does. */
const REQUIREMENT_BATCH_SIZE = 64;

export function statisticsScope(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		if (reachesWholeOrganization(actor)) {
			return { organizationWide: true, organizationId } satisfies StatisticsScope;
		}
		const managerId =
			actor.settingsAccess === "scopedManager" && actor.employee?.role === "manager"
				? actor.employee.id
				: null;
		if (!managerId) {
			return { organizationWide: false, organizationId, teamIds: [] } satisfies StatisticsScope;
		}
		const dbService = yield* DatabaseService;
		const rows = yield* dbService.query("statistics.manageableTeams", () =>
			dbService.db.query.teamPermissions.findMany({
				where: and(
					eq(teamPermissions.employeeId, managerId),
					eq(teamPermissions.organizationId, organizationId),
					eq(teamPermissions.canManageTeamSettings, true),
				),
				columns: { teamId: true },
			}),
		);
		const teamIds = [...new Set(rows.flatMap((row) => (row.teamId ? [row.teamId] : [])))];
		return { organizationWide: false, organizationId, teamIds } satisfies StatisticsScope;
	});
}

/** A scope that reaches nobody: a scoped manager who manages no team's settings. */
export function isEmptyScope(scope: StatisticsScope): boolean {
	return !scope.organizationWide && scope.teamIds.length === 0;
}

/** The employees in scope, current or former, as a condition on `employee`. */
function employeesInScope(scope: StatisticsScope): SQL {
	return scope.organizationWide
		? eq(employee.organizationId, scope.organizationId)
		: (and(
				eq(employee.organizationId, scope.organizationId),
				inArray(employee.teamId, scope.teamIds),
			) as SQL);
}

/** The employee ids in scope, as a subquery for tables that name an employee. */
function scopedEmployeeIds(db: DatabaseClient, scope: StatisticsScope) {
	return db.select({ id: employee.id }).from(employee).where(employeesInScope(scope));
}

/** One KPI's value, or "failed" when its read did not succeed: unknown never reads as zero. */
export function settle<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Kpi<A>, never, R> {
	return Effect.map(Effect.exit(effect), (exit) =>
		Exit.isSuccess(exit) ? { status: "ok", value: exit.value } : { status: "failed" },
	);
}

/** An instant as a `timestamp without time zone` value, the UTC wall time those columns hold. */
function utcTimestamp(instant: Instant): SQL {
	return sql`${instant.toString()}::timestamp`;
}

/** The organization's "this month" and its like-for-like comparison at `now`. */
export function organizationWindows(organizationId: string, now: Instant) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("statistics.organizationTimezone", () =>
			dbService.db.query.organization.findFirst({
				where: eq(organization.id, organizationId),
				columns: { timezone: true },
			}),
		);
		const { timezone } = resolveOrganizationTimezone(row?.timezone);
		return comparisonWindowsAt(now, timezone);
	});
}

// ── Needs attention ───────────────────────────────────────────────────────────

/** Employees in scope with stale live work: clocked in for more than 24 hours. */
export function countStaleLiveWork(scope: StatisticsScope, now: Instant) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const [row] = yield* dbService.query("statistics.staleLiveWork", () =>
			dbService.db
				.select({ count: countDistinct(workPeriod.employeeId) })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, scope.organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
						isNull(workPeriod.deletedAt),
						lte(
							workPeriod.startTime,
							dateFromInstant(now.subtract({ hours: STALE_LIVE_WORK_HOURS })),
						),
						inArray(workPeriod.employeeId, inScope),
					),
				),
		);
		return row?.count ?? 0;
	});
}

/** Work-policy violations of employees in scope this month that nobody acknowledged yet. */
export function countOpenViolations(scope: StatisticsScope, window: StatisticsWindow) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const [row] = yield* dbService.query("statistics.openViolations", () =>
			dbService.db
				.select({ count: count() })
				.from(workPolicyViolation)
				.where(
					and(
						eq(workPolicyViolation.organizationId, scope.organizationId),
						isNull(workPolicyViolation.acknowledgedAt),
						gte(workPolicyViolation.violationDate, dateFromInstant(window.start)),
						inArray(workPolicyViolation.employeeId, inScope),
					),
				),
		);
		return row?.count ?? 0;
	});
}

// ── This month ────────────────────────────────────────────────────────────────

/**
 * Minutes worked by employees in scope inside a window: only the part of each
 * work period inside it counts, and live work counts up to the window's end.
 */
function workedMinutesIn(scope: StatisticsScope, window: StatisticsWindow) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const start = utcTimestamp(window.start);
		const end = utcTimestamp(window.end);
		const [row] = yield* dbService.query("statistics.workedMinutes", () =>
			dbService.db
				.select({
					minutes: sql<number>`coalesce(floor(sum(extract(epoch from (least(coalesce(${workPeriod.endTime}, ${end}), ${end}) - greatest(${workPeriod.startTime}, ${start}))) / 60)), 0)::int`,
				})
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, scope.organizationId),
						isNull(workPeriod.deletedAt),
						sql`${workPeriod.startTime} < ${end}`,
						sql`(${workPeriod.endTime} IS NULL OR ${workPeriod.endTime} > ${start})`,
						inArray(workPeriod.employeeId, inScope),
					),
				),
		);
		return Number(row?.minutes ?? 0);
	});
}

export function workedMinutes(
	scope: StatisticsScope,
	windows: { current: StatisticsWindow; previous: StatisticsWindow },
) {
	return Effect.map(
		Effect.all([workedMinutesIn(scope, windows.current), workedMinutesIn(scope, windows.previous)]),
		([current, previous]): LikeForLike => ({ current, previous }),
	);
}

/** Work periods of employees in scope that were completed (ended) inside a window. */
function completedWorkPeriodsIn(scope: StatisticsScope, window: StatisticsWindow) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const [row] = yield* dbService.query("statistics.completedWorkPeriods", () =>
			dbService.db
				.select({ count: count() })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, scope.organizationId),
						eq(workPeriod.isActive, false),
						isNull(workPeriod.deletedAt),
						gte(workPeriod.endTime, dateFromInstant(window.start)),
						lt(workPeriod.endTime, dateFromInstant(window.end)),
						inArray(workPeriod.employeeId, inScope),
					),
				),
		);
		return row?.count ?? 0;
	});
}

export function completedWorkPeriods(
	scope: StatisticsScope,
	windows: { current: StatisticsWindow; previous: StatisticsWindow },
) {
	return Effect.map(
		Effect.all([
			completedWorkPeriodsIn(scope, windows.current),
			completedWorkPeriodsIn(scope, windows.previous),
		]),
		([current, previous]): LikeForLike => ({ current, previous }),
	);
}

/**
 * Absence days of employees in scope in each window: approved absences only,
 * counted in working days under each employee's work policy and clipped to the
 * window's days.
 */
export function absenceDays(
	scope: StatisticsScope,
	windows: { current: StatisticsWindow; previous: StatisticsWindow },
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const firstDay = windows.previous.firstDay.toString();
		const lastDay = windows.current.lastDay.toString();
		const absences = yield* dbService.query("statistics.approvedAbsences", () =>
			dbService.db
				.select({
					employeeId: absenceEntry.employeeId,
					startDate: absenceEntry.startDate,
					startPeriod: absenceEntry.startPeriod,
					endDate: absenceEntry.endDate,
					endPeriod: absenceEntry.endPeriod,
				})
				.from(absenceEntry)
				.where(
					and(
						eq(absenceEntry.organizationId, scope.organizationId),
						eq(absenceEntry.status, "approved"),
						lte(absenceEntry.startDate, lastDay),
						gte(absenceEntry.endDate, firstDay),
						inArray(absenceEntry.employeeId, inScope),
					),
				),
		);
		if (absences.length === 0) {
			return { current: 0, previous: 0 } satisfies LikeForLike;
		}
		const workingDays = yield* dbService.query("statistics.absenceWorkingDays", () =>
			loadWorkingDaysForEmployees(dbService.db, {
				organizationId: scope.organizationId,
				employeeIds: absences.map((absence) => absence.employeeId),
				startDate: firstDay,
				endDate: lastDay,
			}),
		);
		const daysIn = (window: StatisticsWindow) =>
			absences.reduce((total, absence) => {
				const clipped = clipAbsenceDayRange(absence satisfies AbsenceDayRange, {
					startDate: window.firstDay.toString(),
					endDate: window.lastDay.toString(),
				});
				return clipped
					? total + countAbsenceDays(clipped, workingDays.get(absence.employeeId) ?? mondayToFriday)
					: total;
			}, 0);
		return {
			current: daysIn(windows.current),
			previous: daysIn(windows.previous),
		} satisfies LikeForLike;
	});
}

// ── Tracking adoption ─────────────────────────────────────────────────────────

/** Employees in scope with live work right now. */
export function countClockedIn(scope: StatisticsScope) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const [row] = yield* dbService.query("statistics.clockedIn", () =>
			dbService.db
				.select({ count: countDistinct(workPeriod.employeeId) })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, scope.organizationId),
						eq(workPeriod.isActive, true),
						isNull(workPeriod.endTime),
						isNull(workPeriod.deletedAt),
						inArray(workPeriod.employeeId, inScope),
					),
				),
		);
		return row?.count ?? 0;
	});
}

/**
 * This month's completed work hours of employees in scope, and the part of them
 * recorded as manual entries, by the origin of each work period's canonical work
 * record. Work without a canonical record counts as not manual.
 */
export function manualEntryShare(scope: StatisticsScope, window: StatisticsWindow) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const inScope = scopedEmployeeIds(dbService.db, scope);
		const start = utcTimestamp(window.start);
		const end = utcTimestamp(window.end);
		const clipped = sql`extract(epoch from (least(${workPeriod.endTime}, ${end}) - greatest(${workPeriod.startTime}, ${start}))) / 60`;
		const [row] = yield* dbService.query("statistics.manualEntryShare", () =>
			dbService.db
				.select({
					totalMinutes: sql<number>`coalesce(floor(sum(${clipped})), 0)::int`,
					manualMinutes: sql<number>`coalesce(floor(sum(${clipped}) filter (where ${timeRecord.origin} = 'manual')), 0)::int`,
				})
				.from(workPeriod)
				.leftJoin(
					timeRecord,
					and(
						eq(timeRecord.id, workPeriod.canonicalRecordId),
						eq(timeRecord.organizationId, workPeriod.organizationId),
					),
				)
				.where(
					and(
						eq(workPeriod.organizationId, scope.organizationId),
						eq(workPeriod.isActive, false),
						isNull(workPeriod.deletedAt),
						sql`${workPeriod.startTime} < ${end}`,
						sql`${workPeriod.endTime} > ${start}`,
						inArray(workPeriod.employeeId, inScope),
					),
				),
		);
		return {
			manualMinutes: Number(row?.manualMinutes ?? 0),
			totalMinutes: Number(row?.totalMinutes ?? 0),
		};
	});
}

/**
 * Tracking coverage this month: of the employees on the current roster in scope
 * with required time so far this month, how many recorded completed work in it.
 * Employees with no required time (on absence since the 1st, no work policy) are
 * left out of both counts.
 */
export function trackingCoverage(scope: StatisticsScope, window: StatisticsWindow) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const { db } = dbService;
		const roster = yield* dbService.query("statistics.coverageRoster", () =>
			db.query.employee.findMany({
				where: and(
					employeesInScope(scope),
					onCurrentRoster(scope.organizationId, employee, window.end),
				),
				columns: {
					id: true,
					organizationId: true,
					teamId: true,
					startDate: true,
					contractType: true,
				},
				with: {
					user: { columns: { createdAt: true } },
					userSettings: { columns: { timezone: true } },
					organization: { columns: { timezone: true } },
				},
			}),
		);
		if (roster.length === 0) {
			return { tracked: 0, expected: 0 };
		}

		const firstDay = window.firstDay.toString();
		const lastDay = window.lastDay.toString();
		const expected = new Set<string>();
		for (let offset = 0; offset < roster.length; offset += REQUIREMENT_BATCH_SIZE) {
			const batch = roster.slice(offset, offset + REQUIREMENT_BATCH_SIZE);
			const trackingByEmployee = yield* dbService.query("statistics.coverageTracking", () =>
				loadEmployeeTrackingContexts(db, {
					organizationId: scope.organizationId,
					employeeIds: batch.map((person) => person.id),
				}),
			);
			const { requirements } = yield* loadDailyWorkRequirementsForEmployees({
				organizationId: scope.organizationId,
				employees: batch satisfies readonly RequirementEmployee[],
				// Requirement keys are each employee's local dates; a day either side covers every zone.
				startDate: dateFromInstant(window.start.subtract({ hours: 24 })),
				endDate: dateFromInstant(window.end.add({ hours: 24 })),
				trackingByEmployee,
				includeLegacy: true,
			});
			for (const [employeeId, days] of requirements) {
				const required = Object.entries(days).some(
					([date, day]) => date >= firstDay && date <= lastDay && day.requiredMinutes > 0,
				);
				if (required) expected.add(employeeId);
			}
		}
		if (expected.size === 0) {
			return { tracked: 0, expected: 0 };
		}

		const trackedRows = yield* dbService.query("statistics.coverageTracked", () =>
			db
				.selectDistinct({ employeeId: workPeriod.employeeId })
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.organizationId, scope.organizationId),
						eq(workPeriod.isActive, false),
						isNull(workPeriod.deletedAt),
						lt(workPeriod.startTime, dateFromInstant(window.end)),
						gt(workPeriod.endTime, dateFromInstant(window.start)),
						inArray(workPeriod.employeeId, [...expected]),
					),
				),
		);
		return { tracked: trackedRows.length, expected: expected.size };
	});
}

// ── Workforce & setup ─────────────────────────────────────────────────────────

/**
 * Whether an employee was on the roster at an instant: created by then, not
 * switched off by a deactivation in effect then, and not denied by a departure
 * that had taken effect then.
 */
function onRosterAt(at: Instant): SQL {
	const instant = rosterCheckInstant(at);
	return sql`(${employee.createdAt} <= ${utcTimestamp(at)}
		AND NOT employee_departure_denies_access(${employee.organizationId}, ${employee.id}, ${instant})
		AND NOT EXISTS (
			SELECT 1 FROM employee_deactivation d
			WHERE d.organization_id = ${employee.organizationId}
				AND d.employee_id = ${employee.id}
				AND d.status <> 'withdrawn'
				AND d.deactivated_at <= ${instant}
				AND (d.reactivated_at IS NULL OR d.reactivated_at > ${instant})
		))`;
}

/**
 * The current roster in scope, and how it changed this month: who is on it now
 * but was not at the start of the month, and who was on it then but has left
 * since. Someone who left and came back within the month counts in neither.
 */
export function rosterMovement(scope: StatisticsScope, window: StatisticsWindow) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		// The window ends now: the roster now against the roster at the start of the month.
		const current = onCurrentRoster(scope.organizationId, employee, window.end);
		const atStart = onRosterAt(window.start);
		const leftAt = sql`employee_left_at(${employee.organizationId}, ${employee.id}, ${employee.deactivatedAt}, ${rosterCheckInstant(window.end)})`;
		const [row] = yield* dbService.query("statistics.rosterMovement", () =>
			dbService.db
				.select({
					roster: sql<number>`count(*) filter (where ${current})::int`,
					joined: sql<number>`count(*) filter (where ${current} AND NOT ${atStart})::int`,
					left: sql<number>`count(*) filter (where NOT ${current} AND ${atStart} AND ${leftAt} >= ${rosterCheckInstant(window.start)})::int`,
				})
				.from(employee)
				.where(employeesInScope(scope)),
		);
		return {
			roster: Number(row?.roster ?? 0),
			joined: Number(row?.joined ?? 0),
			left: Number(row?.left ?? 0),
		};
	});
}

export function countTeams(scope: StatisticsScope) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [row] = yield* dbService.query("statistics.teams", () =>
			dbService.db
				.select({ count: count() })
				.from(team)
				.where(
					scope.organizationWide
						? eq(team.organizationId, scope.organizationId)
						: and(eq(team.organizationId, scope.organizationId), inArray(team.id, scope.teamIds)),
				),
		);
		return row?.count ?? 0;
	});
}

/**
 * Employees on the current roster in scope whose setup is incomplete: no primary
 * team, or no effective work policy now.
 */
export function countIncompleteSetup(scope: StatisticsScope, now: Instant) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const roster = yield* dbService.query("statistics.setupRoster", () =>
			dbService.db
				.select({ id: employee.id, teamId: employee.teamId })
				.from(employee)
				.where(and(employeesInScope(scope), onCurrentRoster(scope.organizationId, employee, now))),
		);
		if (roster.length === 0) return 0;
		const policies = yield* dbService.query("statistics.setupPolicies", () =>
			loadEffectiveWorkPolicies(dbService.db, {
				organizationId: scope.organizationId,
				employees: roster,
				at: now,
			}),
		);
		return roster.filter((person) => !person.teamId || !policies.get(person.id)).length;
	});
}

/** Distinct users with an unexpired session in this organization. Org admins only. */
export function countUsersSignedIn(organizationId: string, now: Instant) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [row] = yield* dbService.query("statistics.usersSignedIn", () =>
			dbService.db
				.select({ count: countDistinct(session.userId) })
				.from(session)
				.where(
					and(
						eq(session.activeOrganizationId, organizationId),
						gt(session.expiresAt, dateFromInstant(now)),
					),
				),
		);
		return row?.count ?? 0;
	});
}
