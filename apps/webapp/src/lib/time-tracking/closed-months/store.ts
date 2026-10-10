import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	absenceEntry,
	approvalRequest,
	approvalWorkflow,
	auditLog,
	closedMonth,
	closedMonthEmployee,
	closedMonthReopening,
	employee,
	team,
	userSettings,
	workPeriod,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import {
	acquireOrganizationConfigurationGuard,
	withOrganizationConfigurationMutation,
} from "@/lib/time-tracking/work-transaction/ranks";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { monthClosedError } from "./refusal";
import {
	type ClosedMonthKey,
	type ClosedRange,
	closedMonthTouchedByDays,
	closedRangeTouchedByWork,
	type DayRange,
	employeeMonthRange,
	firstDayOfMonth,
	monthOfFirstDay,
	type WorkInterval,
} from "./rules";

/**
 * Closing and reopening months (#762, Time Tracking ADR-0004). Closed months
 * are organization configuration: both hold its guard exclusively, so they
 * serialize with every coordinator writer that holds it shared, and with the
 * absence writers that take it shared (`assertAbsenceDaysOpen`).
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type ClosedMonthReader = Pick<Database, "select"> | Pick<Transaction, "select">;

export const CLOSED_MONTH_AUDIT_ENTITY_TYPE = "closed_month";

export type CloseMonthScope = { kind: "organization" } | { kind: "team"; teamId: string };
export type ClosedMonthActor = { kind: "user"; userId: string } | { kind: "system" };

export type CloseMonthBlocker =
	| { kind: "month_not_ended"; employeeId: string; employeeName: string }
	| {
			kind: "absence_request";
			employeeId: string;
			employeeName: string;
			absenceId: string;
			startDate: string;
			endDate: string;
	  }
	| {
			kind: "time_request";
			employeeId: string;
			employeeName: string;
			workPeriodId: string;
			startTime: string;
	  }
	| {
			kind: "live_work";
			employeeId: string;
			employeeName: string;
			workPeriodId: string;
			startTime: string;
	  };

export type CloseMonthResult =
	| { kind: "closed"; closedMonthId: string; month: ClosedMonthKey; employeeIds: string[] }
	| { kind: "blocked"; month: ClosedMonthKey; blockers: CloseMonthBlocker[] }
	| { kind: "nothing_to_close"; month: ClosedMonthKey }
	| { kind: "team_not_found" };

export type ReopenMonthScope =
	| { kind: "employees"; employeeIds: readonly string[] }
	| { kind: "team"; teamId: string }
	| { kind: "all" };

export type ReopenMonthResult =
	| { kind: "reopened"; reopeningId: string; month: ClosedMonthKey; employeeIds: string[] }
	| { kind: "nothing_to_reopen"; month: ClosedMonthKey }
	| { kind: "reason_required" };

interface CoveredEmployee {
	id: string;
	name: string;
	teamId: string | null;
	timezone: string;
	range: { start: Instant; endExclusive: Instant };
}

/** The employee's display name comes from their user (#264 name source). */
function employeeName(row: { userName: string | null }): string {
	return row.userName?.trim() || "—";
}

// ============================================
// READS
// ============================================

/** The ranges that are closed for an employee now (never reopened). */
export async function closedRangesForEmployee(
	database: ClosedMonthReader,
	input: { organizationId: string; employeeId: string },
): Promise<ClosedRange[]> {
	const rows = await database
		.select({
			month: closedMonthEmployee.month,
			rangeStart: closedMonthEmployee.rangeStart,
			rangeEnd: closedMonthEmployee.rangeEnd,
		})
		.from(closedMonthEmployee)
		.where(
			and(
				eq(closedMonthEmployee.organizationId, input.organizationId),
				eq(closedMonthEmployee.employeeId, input.employeeId),
				isNull(closedMonthEmployee.reopenedAt),
			),
		)
		.orderBy(asc(closedMonthEmployee.rangeStart));
	return rows.map((row) => ({
		month: monthOfFirstDay(row.month),
		start: instantFromDate(row.rangeStart),
		endExclusive: instantFromDate(row.rangeEnd),
	}));
}

/**
 * Refuses (throws `MonthClosedError`) when work before or after a change
 * touches one of the employee's closed ranges. Writers call it under their
 * guard, before writing.
 */
export async function assertWorkOpen(
	database: ClosedMonthReader,
	input: { organizationId: string; employeeId: string; intervals: readonly WorkInterval[] },
): Promise<void> {
	if (input.intervals.length === 0) return;
	const ranges = await closedRangesForEmployee(database, input);
	const touched = closedRangeTouchedByWork(input.intervals, ranges);
	if (touched) {
		throw monthClosedError(touched.month);
	}
}

/** Work as a writer knows it: Date instants at the database boundary. */
export function workInterval(start: Date, end: Date | null): WorkInterval {
	return { start: instantFromDate(start), end: end ? instantFromDate(end) : null };
}

/**
 * Refuses (throws `MonthClosedError`) when an absence's days, before or after
 * a change, touch one of the employee's closed months. Absence writers run
 * outside the work-transaction coordinator, so this takes the organization
 * configuration guard shared first: a close or reopening in flight finishes
 * before the check, and none starts until the absence write commits.
 */
export async function assertAbsenceDaysOpen(
	transaction: Pick<Transaction, "execute" | "select">,
	input: { organizationId: string; employeeId: string; days: readonly DayRange[] },
): Promise<void> {
	await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
	if (input.days.length === 0) return;
	const months = (await closedRangesForEmployee(transaction, input)).map((range) => range.month);
	for (const days of input.days) {
		const touched = closedMonthTouchedByDays(days, months);
		if (touched) {
			throw monthClosedError(touched);
		}
	}
}

/**
 * `assertAbsenceDaysOpen` for an absence known by id: its employee and days
 * are read from the row. A missing row is left to the writer to refuse.
 */
export async function assertAbsenceOpenById(
	transaction: Pick<Transaction, "execute" | "select">,
	input: { organizationId: string; absenceId: string },
): Promise<void> {
	await acquireOrganizationConfigurationGuard(transaction, input.organizationId);
	const [absence] = await transaction
		.select({
			employeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
		})
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!absence) return;
	await assertAbsenceDaysOpen(transaction, {
		organizationId: input.organizationId,
		employeeId: absence.employeeId,
		days: [{ startDate: absence.startDate, endDate: absence.endDate }],
	});
}

export interface MonthClosureStatus {
	month: ClosedMonthKey;
	state: "closed" | "partly_closed" | "open";
	closedEmployees: number;
	employees: number;
}

/**
 * Closed, partly closed or open, for each month and the selected employees
 * (every employee of the organization when `employeeIds` is omitted).
 */
export async function monthClosureStatuses(
	database: ClosedMonthReader,
	input: {
		organizationId: string;
		months: readonly ClosedMonthKey[];
		employeeIds?: readonly string[];
	},
): Promise<MonthClosureStatus[]> {
	if (input.months.length === 0) return [];
	const employeeIds =
		input.employeeIds ??
		(
			await database
				.select({ id: employee.id })
				.from(employee)
				.where(eq(employee.organizationId, input.organizationId))
		).map((row) => row.id);
	if (employeeIds.length === 0) {
		return input.months.map((month) => ({
			month,
			state: "open",
			closedEmployees: 0,
			employees: 0,
		}));
	}
	const rows = await database
		.select({
			month: closedMonthEmployee.month,
			closed: sql<number>`count(distinct ${closedMonthEmployee.employeeId})::int`,
		})
		.from(closedMonthEmployee)
		.where(
			and(
				eq(closedMonthEmployee.organizationId, input.organizationId),
				isNull(closedMonthEmployee.reopenedAt),
				inArray(closedMonthEmployee.month, input.months.map(firstDayOfMonth)),
				inArray(closedMonthEmployee.employeeId, [...employeeIds]),
			),
		)
		.groupBy(closedMonthEmployee.month);
	const closedByMonth = new Map(rows.map((row) => [monthOfFirstDay(row.month), row.closed]));
	return input.months.map((month) => {
		const closedEmployees = closedByMonth.get(month) ?? 0;
		return {
			month,
			closedEmployees,
			employees: employeeIds.length,
			state:
				closedEmployees === 0
					? "open"
					: closedEmployees >= employeeIds.length
						? "closed"
						: "partly_closed",
		};
	});
}

// ============================================
// CLOSE
// ============================================

async function employeesInScope(
	transaction: Transaction,
	input: { organizationId: string; scope: CloseMonthScope; month: ClosedMonthKey },
) {
	const organizationRow = await transaction
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, input.organizationId))
		.limit(1);
	const organizationTimezone = organizationRow[0]?.timezone ?? null;
	const rows = await transaction
		.select({
			id: employee.id,
			userName: user.name,
			teamId: employee.teamId,
			userTimezone: userSettings.timezone,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				input.scope.kind === "team" ? eq(employee.teamId, input.scope.teamId) : undefined,
			),
		)
		.orderBy(asc(employee.id));
	const alreadyClosed = new Set(
		(
			await transaction
				.select({ employeeId: closedMonthEmployee.employeeId })
				.from(closedMonthEmployee)
				.where(
					and(
						eq(closedMonthEmployee.organizationId, input.organizationId),
						eq(closedMonthEmployee.month, firstDayOfMonth(input.month)),
						isNull(closedMonthEmployee.reopenedAt),
					),
				)
		).map((row) => row.employeeId),
	);
	return rows
		.filter((row) => !alreadyClosed.has(row.id))
		.map((row): CoveredEmployee => {
			const timezone = resolveEffectiveTimezone(row.userTimezone, organizationTimezone);
			return {
				id: row.id,
				name: employeeName(row),
				teamId: row.teamId,
				timezone,
				range: employeeMonthRange(input.month, timezone),
			};
		});
}

async function closeBlockers(
	transaction: Transaction,
	input: {
		organizationId: string;
		month: ClosedMonthKey;
		employees: readonly CoveredEmployee[];
		now: Instant;
	},
): Promise<CloseMonthBlocker[]> {
	const blockers: CloseMonthBlocker[] = [];
	const byId = new Map(input.employees.map((row) => [row.id, row]));
	const ids = [...byId.keys()];

	for (const covered of input.employees) {
		if (compareInstants(covered.range.endExclusive, input.now) > 0) {
			blockers.push({
				kind: "month_not_ended",
				employeeId: covered.id,
				employeeName: covered.name,
			});
		}
	}

	const first = firstDayOfMonth(input.month);
	const pendingAbsences = await transaction
		.select({
			id: absenceEntry.id,
			employeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
		})
		.from(absenceEntry)
		.where(
			and(
				inArray(absenceEntry.employeeId, ids),
				eq(absenceEntry.status, "pending"),
				lte(
					absenceEntry.startDate,
					sql`(${first}::date + interval '1 month' - interval '1 day')::date`,
				),
				sql`${absenceEntry.endDate} >= ${first}::date`,
			),
		);
	for (const absence of pendingAbsences) {
		const covered = byId.get(absence.employeeId);
		if (!covered) continue;
		blockers.push({
			kind: "absence_request",
			employeeId: covered.id,
			employeeName: covered.name,
			absenceId: absence.id,
			startDate: absence.startDate,
			endDate: absence.endDate,
		});
	}

	// Work touching any covered employee's range; checked per employee below.
	const earliest = input.employees.reduce(
		(min, row) => (compareInstants(row.range.start, min) < 0 ? row.range.start : min),
		input.employees[0].range.start,
	);
	const latest = input.employees.reduce(
		(max, row) => (compareInstants(row.range.endExclusive, max) > 0 ? row.range.endExclusive : max),
		input.employees[0].range.endExclusive,
	);
	const work = await transaction
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			approvalStatus: workPeriod.approvalStatus,
			pendingWorkflow: sql<boolean>`exists (
				select 1 from ${approvalWorkflow}
				where ${approvalWorkflow.organizationId} = ${workPeriod.organizationId}
					and ${approvalWorkflow.sourceType} = 'time_entry'
					and ${approvalWorkflow.sourceId} = ${workPeriod.id}
					and ${approvalWorkflow.status} = 'pending'
			)`,
			pendingRequest: sql<boolean>`exists (
				select 1 from ${approvalRequest}
				where ${approvalRequest.organizationId} = ${workPeriod.organizationId}
					and ${approvalRequest.entityId} = ${workPeriod.id}
					and ${approvalRequest.status} = 'pending'
			)`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, ids),
				isNull(workPeriod.deletedAt),
				lt(workPeriod.startTime, dateFromInstant(latest)),
				or(isNull(workPeriod.endTime), gt(workPeriod.endTime, dateFromInstant(earliest))),
			),
		);
	for (const period of work) {
		const covered = byId.get(period.employeeId);
		if (!covered) continue;
		const touched = closedRangeTouchedByWork(
			[workInterval(period.startTime, period.endTime)],
			[{ month: input.month, ...covered.range }],
		);
		if (!touched) continue;
		const base = {
			employeeId: covered.id,
			employeeName: covered.name,
			workPeriodId: period.id,
			startTime: period.startTime.toISOString(),
		};
		if (period.endTime === null) {
			blockers.push({ kind: "live_work", ...base });
		} else if (
			period.approvalStatus === "pending" ||
			period.pendingWorkflow ||
			period.pendingRequest
		) {
			blockers.push({ kind: "time_request", ...base });
		}
	}
	return blockers;
}

async function writeAudit(
	transaction: Transaction,
	input: {
		organizationId: string;
		entityId: string;
		action: AuditAction.CLOSED_MONTH_CLOSED | AuditAction.CLOSED_MONTH_REOPENED;
		actorUserId: string;
		metadata: Record<string, unknown>;
	},
) {
	await transaction.insert(auditLog).values({
		id: randomUUID(),
		organizationId: input.organizationId,
		entityType: CLOSED_MONTH_AUDIT_ENTITY_TYPE,
		entityId: input.entityId,
		action: input.action,
		performedBy: input.actorUserId,
		metadata: JSON.stringify(input.metadata),
	});
}

/**
 * Closes a month for the organization or one team. Covers only employees still
 * open for the month, and is refused (with the blockers) while a covered
 * employee has an undecided request about the month, live work touching it,
 * or the month has not ended yet in their timezone.
 */
export async function closeMonth(
	client: Pick<Database, "transaction">,
	input: {
		organizationId: string;
		month: ClosedMonthKey;
		scope: CloseMonthScope;
		actor: ClosedMonthActor;
		now: Instant;
	},
): Promise<CloseMonthResult> {
	return withOrganizationConfigurationMutation(client, input.organizationId, async (tx) => {
		if (input.scope.kind === "team") {
			const [found] = await tx
				.select({ id: team.id })
				.from(team)
				.where(and(eq(team.id, input.scope.teamId), eq(team.organizationId, input.organizationId)))
				.limit(1);
			if (!found) return { kind: "team_not_found" };
		}
		const covered = await employeesInScope(tx, input);
		if (covered.length === 0) {
			return { kind: "nothing_to_close", month: input.month };
		}
		const blockers = await closeBlockers(tx, { ...input, employees: covered });
		if (blockers.length > 0) {
			return { kind: "blocked", month: input.month, blockers };
		}

		const closedMonthId = randomUUID();
		const month = firstDayOfMonth(input.month);
		await tx.insert(closedMonth).values({
			id: closedMonthId,
			organizationId: input.organizationId,
			month,
			scope: input.scope.kind,
			teamId: input.scope.kind === "team" ? input.scope.teamId : null,
			coversNewEmployees: input.scope.kind === "organization",
			actorKind: input.actor.kind,
			closedBy: input.actor.kind === "user" ? input.actor.userId : null,
		});
		await tx.insert(closedMonthEmployee).values(
			covered.map((row) => ({
				organizationId: input.organizationId,
				closedMonthId,
				employeeId: row.id,
				month,
				rangeStart: dateFromInstant(row.range.start),
				rangeEnd: dateFromInstant(row.range.endExclusive),
				timezone: row.timezone,
				teamId: row.teamId,
			})),
		);
		const employeeIds = covered.map((row) => row.id);
		// The automatic close has no user to name; its `closed_month` row
		// (actor_kind 'system') is its record.
		if (input.actor.kind === "user") {
			await writeAudit(tx, {
				organizationId: input.organizationId,
				entityId: closedMonthId,
				action: AuditAction.CLOSED_MONTH_CLOSED,
				actorUserId: input.actor.userId,
				metadata: {
					month: input.month,
					scope: input.scope,
					employeeIds,
					ranges: covered.map((row) => ({
						employeeId: row.id,
						timezone: row.timezone,
						start: row.range.start.toString(),
						endExclusive: row.range.endExclusive.toString(),
					})),
				},
			});
		}
		return { kind: "closed", closedMonthId, month: input.month, employeeIds };
	});
}

// ============================================
// REOPEN
// ============================================

/**
 * Reopens a closed month for selected employees, a team (the primary team the
 * close recorded) or everything, with a reason. Reopened employees stay open
 * until the month is closed again; reopening everything also stops an
 * organization close from covering employees added later.
 */
export async function reopenMonth(
	client: Pick<Database, "transaction">,
	input: {
		organizationId: string;
		month: ClosedMonthKey;
		scope: ReopenMonthScope;
		reason: string;
		actorUserId: string;
	},
): Promise<ReopenMonthResult> {
	const reason = input.reason.trim();
	if (reason.length === 0) {
		return { kind: "reason_required" };
	}
	return withOrganizationConfigurationMutation(client, input.organizationId, async (tx) => {
		const month = firstDayOfMonth(input.month);
		const scopeFilter =
			input.scope.kind === "employees"
				? inArray(closedMonthEmployee.employeeId, [...input.scope.employeeIds])
				: input.scope.kind === "team"
					? eq(closedMonthEmployee.teamId, input.scope.teamId)
					: undefined;
		if (input.scope.kind === "employees" && input.scope.employeeIds.length === 0) {
			return { kind: "nothing_to_reopen", month: input.month };
		}
		const rows = await tx
			.select({ id: closedMonthEmployee.id, employeeId: closedMonthEmployee.employeeId })
			.from(closedMonthEmployee)
			.where(
				and(
					eq(closedMonthEmployee.organizationId, input.organizationId),
					eq(closedMonthEmployee.month, month),
					isNull(closedMonthEmployee.reopenedAt),
					scopeFilter,
				),
			)
			.for("update");
		if (rows.length === 0 && input.scope.kind !== "all") {
			return { kind: "nothing_to_reopen", month: input.month };
		}

		let stoppedCoveringNewEmployees = false;
		if (input.scope.kind === "all") {
			const stopped = await tx
				.update(closedMonth)
				.set({ coversNewEmployees: false })
				.where(
					and(
						eq(closedMonth.organizationId, input.organizationId),
						eq(closedMonth.month, month),
						eq(closedMonth.coversNewEmployees, true),
					),
				)
				.returning({ id: closedMonth.id });
			stoppedCoveringNewEmployees = stopped.length > 0;
		}
		if (rows.length === 0 && !stoppedCoveringNewEmployees) {
			return { kind: "nothing_to_reopen", month: input.month };
		}

		const reopeningId = randomUUID();
		const employeeIds = rows.map((row) => row.employeeId);
		await tx.insert(closedMonthReopening).values({
			id: reopeningId,
			organizationId: input.organizationId,
			month,
			scope: input.scope.kind,
			teamId: input.scope.kind === "team" ? input.scope.teamId : null,
			reason,
			employeeCount: rows.length,
			reopenedBy: input.actorUserId,
		});
		if (rows.length > 0) {
			await tx
				.update(closedMonthEmployee)
				.set({ reopenedAt: sql`now()`, reopeningId })
				.where(
					and(
						eq(closedMonthEmployee.organizationId, input.organizationId),
						inArray(
							closedMonthEmployee.id,
							rows.map((row) => row.id),
						),
					),
				);
		}
		await writeAudit(tx, {
			organizationId: input.organizationId,
			entityId: reopeningId,
			action: AuditAction.CLOSED_MONTH_REOPENED,
			actorUserId: input.actorUserId,
			metadata: { month: input.month, scope: input.scope, reason, employeeIds },
		});
		return { kind: "reopened", reopeningId, month: input.month, employeeIds };
	});
}

// ============================================
// HISTORY
// ============================================

export interface ClosedMonthHistoryEntry {
	kind: "close" | "reopening";
	id: string;
	month: ClosedMonthKey;
	scope: string;
	teamId: string | null;
	automatic: boolean;
	actorUserId: string | null;
	at: string;
	employeeCount: number;
	reason: string | null;
}

/** Close and reopen history of the organization, newest first. */
export async function closedMonthHistory(
	database: ClosedMonthReader,
	input: { organizationId: string; limit?: number },
): Promise<ClosedMonthHistoryEntry[]> {
	const limit = input.limit ?? 100;
	const closes = await database
		.select({
			id: closedMonth.id,
			month: closedMonth.month,
			scope: closedMonth.scope,
			teamId: closedMonth.teamId,
			actorKind: closedMonth.actorKind,
			closedBy: closedMonth.closedBy,
			closedAt: closedMonth.closedAt,
			employeeCount: sql<number>`(select count(*)::int from ${closedMonthEmployee} where ${closedMonthEmployee.closedMonthId} = ${closedMonth.id})`,
		})
		.from(closedMonth)
		.where(eq(closedMonth.organizationId, input.organizationId))
		.orderBy(desc(closedMonth.closedAt))
		.limit(limit);
	const reopenings = await database
		.select()
		.from(closedMonthReopening)
		.where(eq(closedMonthReopening.organizationId, input.organizationId))
		.orderBy(desc(closedMonthReopening.reopenedAt))
		.limit(limit);
	return [
		...closes.map(
			(row): ClosedMonthHistoryEntry => ({
				kind: "close",
				id: row.id,
				month: monthOfFirstDay(row.month),
				scope: row.scope,
				teamId: row.teamId,
				automatic: row.actorKind === "system",
				actorUserId: row.closedBy,
				at: row.closedAt.toISOString(),
				employeeCount: row.employeeCount,
				reason: null,
			}),
		),
		...reopenings.map(
			(row): ClosedMonthHistoryEntry => ({
				kind: "reopening",
				id: row.id,
				month: monthOfFirstDay(row.month),
				scope: row.scope,
				teamId: row.teamId,
				automatic: false,
				actorUserId: row.reopenedBy,
				at: row.reopenedAt.toISOString(),
				employeeCount: row.employeeCount,
				reason: row.reason,
			}),
		),
	]
		.sort((left, right) => right.at.localeCompare(left.at))
		.slice(0, limit);
}
