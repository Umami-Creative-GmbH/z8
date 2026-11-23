import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	auditLog,
	closedMonthEmployee,
	type PayrollSettledDayEventKind,
	type PayrollSettlementMethod,
	payrollSettledDay,
	payrollExportJob,
	payrollSettledDayEvent,
} from "@/db/schema";
import { user } from "@/db/auth-schema";
import { AuditAction } from "@/lib/audit-logger";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { dayHasEntries } from "./day-entries";
import {
	type DepartedEmployees,
	readPeriodForEmployees,
	resolveGrantEmployeeIds,
} from "./read-period";
import { loadActiveSettledDays } from "./settled-days-store";
import { settledDayValues } from "./settlement-values";
import type {
	PayrollPeriodActor,
	PayrollPeriodDay,
	PayrollPeriodScope,
	PayrollSettledDayValues,
} from "./types";

/**
 * Settling and unsettling employee-days (#1896, payroll-export ADR 0004). A settled
 * day records that its worked hours and absences were paid; it keeps a copy of
 * them, never freezes data and needs no closed month. Settling by hand covers only
 * days with entries (`dayHasEntries`); confirming an export as paid settles exactly
 * the days the export carried (export-confirmation.ts). Every operation is
 * organization-scoped and resolves employees through the actor's payroll access
 * grant: a request naming anyone outside it is rejected as a whole.
 */

/** The grant holder settling: their employee (the grant) and user (the history). */
export interface PayrollSettlementActor extends PayrollPeriodActor {
	userId: string;
}

/** One employee and one employee-local date. */
export interface PayrollDayKey {
	employeeId: string;
	date: string;
}

/** Inclusive employee-local dates. */
export interface PayrollDateRange {
	startDate: string;
	endDate: string;
}

/** The widest range one settle covers: a year, so a mistake stays small. */
export const MAX_SETTLE_RANGE_DAYS = 366;
/** The most days one unsettle names. */
export const MAX_UNSETTLE_DAYS = 5_000;
/** The most days one settle of specific days names, as for unsettling. */
export const MAX_SETTLE_SPECIFIC_DAYS = MAX_UNSETTLE_DAYS;
/**
 * Unsettling and the history cover the grant's employees whenever they left: a
 * settlement exists only for a day the grant could settle, so its record stays
 * reachable, also for a day after the employee's last working day.
 */
const WHENEVER_THEY_LEFT: DepartedEmployees = { anyDeparture: true };

export interface SettleDaysPlan {
	/** Days settled now (preview: days a settle would settle). */
	newlySettled: PayrollDayKey[];
	/** Days with an active settlement already; never settled twice. */
	alreadySettled: PayrollDayKey[];
	/** Days whose month is not closed for the employee: a warning, never a block. */
	inUnclosedMonths: PayrollDayKey[];
}

/** How settling by hand treats days a payroll officer may not want to settle yet. */
export interface SettleDaysOptions {
	/**
	 * Leave out days in months not closed for the employee. Default false: they are
	 * settled, and reported as a warning.
	 */
	skipUnclosedMonths?: boolean;
	/**
	 * Leave out days with a pending absence, which the settlement's copy does not pay.
	 * Default true for a date range; false for specific days, which the officer picked.
	 */
	skipPendingAbsences?: boolean;
}

/** One employee's part of a settle: the days it settles and their credited minutes. */
export interface PayrollSettleEmployeeBreakdown {
	employeeId: string;
	name: string;
	days: number;
	creditedMinutes: number;
}

/**
 * A settle by hand (#1896): the plan, plus the days it leaves out. Days without entries
 * (`dayHasEntries`) are never settled by hand, so settling shows no empty days as paid.
 */
export interface ManualSettlePlan extends SettleDaysPlan {
	/** Unsettled days nobody recorded anything on: never settled by hand. */
	skippedWithoutEntries: PayrollDayKey[];
	/** Unsettled days with a pending absence, left out by `skipPendingAbsences`. */
	skippedPendingAbsences: PayrollDayKey[];
	/** Unsettled days in months not closed, left out by `skipUnclosedMonths`. */
	skippedUnclosedMonths: PayrollDayKey[];
	/** Days settled with a pending absence, which their copy does not pay: a warning. */
	withPendingAbsences: PayrollDayKey[];
	/** The days settled per employee, by name. */
	employees: PayrollSettleEmployeeBreakdown[];
}

export type SettleDaysRejection =
	/** Employees outside the grant or the organization; nothing was settled. */
	| { status: "out_of_scope"; employeeIds: string[] }
	| { status: "invalid_range" }
	/** Specific days: none, too many, malformed, or spread over more than a year. */
	| { status: "invalid_days" };

export type SettleDaysPreview = SettleDaysRejection | ({ status: "ready" } & ManualSettlePlan);
export type SettleDaysResult = SettleDaysRejection | ({ status: "settled" } & ManualSettlePlan);

export type UnsettleDaysResult =
	| { status: "reason_required" }
	| { status: "invalid_days" }
	| { status: "out_of_scope"; employeeIds: string[] }
	| { status: "unsettled"; unsettled: PayrollDayKey[]; notSettled: PayrollDayKey[] };

export interface PayrollSettlementHistoryEntry {
	id: string;
	employeeId: string;
	date: string;
	kind: PayrollSettledDayEventKind;
	method: PayrollSettlementMethod;
	payrollExportJobId: string | null;
	/** The file name of the export the day was settled with, if any (#1897). */
	payrollExportFileName: string | null;
	actorUserId: string | null;
	actorName: string | null;
	/** ISO instant. */
	occurredAt: string;
	/** Why the day was unsettled; null for a settle. */
	reason: string | null;
	/** The values the settlement paid. */
	paid: PayrollSettledDayValues;
}

/** What settling the employees for the range would do, without settling anything. */
export async function previewSettleDays(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
	options: SettleDaysOptions = {},
): Promise<SettleDaysPreview> {
	const resolved = await resolveRangeSettlement(organizationId, actor, scope, range, options);
	if (!resolved.ok) return resolved.rejection;
	const { plan } = await planManualSettlement(organizationId, actor, resolved);
	return { status: "ready", ...plan };
}

/**
 * Settles the employees' days in the range by hand (#1896): each day with entries not
 * settled yet gets a settlement with a copy of its current credited minutes and
 * approved absences, and a history event. Days settled before are reported, not
 * duplicated; days without entries, and the days the options leave out, are reported.
 */
export async function settleDays(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
	options: SettleDaysOptions = {},
): Promise<SettleDaysResult> {
	const resolved = await resolveRangeSettlement(organizationId, actor, scope, range, options);
	if (!resolved.ok) return resolved.rejection;
	return settlePlanned(organizationId, actor, resolved);
}

/** What settling the named employee-days would do, without settling anything. */
export async function previewSettleSpecificDays(
	organizationId: string,
	actor: PayrollSettlementActor,
	days: readonly PayrollDayKey[],
	options: SettleDaysOptions = {},
): Promise<SettleDaysPreview> {
	const resolved = await resolveSpecificSettlement(organizationId, actor, days, options);
	if (!resolved.ok) return resolved.rejection;
	const { plan } = await planManualSettlement(organizationId, actor, resolved);
	return { status: "ready", ...plan };
}

/**
 * Settles the named employee-days by hand, as picked in the Days tab: the same rules as
 * a range, except that a day with a pending absence is settled unless
 * `skipPendingAbsences` says otherwise. A request naming any employee outside the grant
 * is rejected as a whole.
 */
export async function settleSpecificDays(
	organizationId: string,
	actor: PayrollSettlementActor,
	days: readonly PayrollDayKey[],
	options: SettleDaysOptions = {},
): Promise<SettleDaysResult> {
	const resolved = await resolveSpecificSettlement(organizationId, actor, days, options);
	if (!resolved.ok) return resolved.rejection;
	return settlePlanned(organizationId, actor, resolved);
}

async function settlePlanned(
	organizationId: string,
	actor: PayrollSettlementActor,
	resolved: ResolvedSettlement,
): Promise<SettleDaysResult> {
	const { plan, values, names } = await planManualSettlement(organizationId, actor, resolved);
	if (values.length === 0) return { status: "settled", ...plan };

	const inserted = await insertSettlements(organizationId, actor, values, {
		method: "manual",
		payrollExportJobId: null,
	});

	// A day a concurrent settle took between the plan and the insert is already settled.
	const settledNow = new Set(inserted.map(dayKey));
	const isSettledNow = (day: PayrollDayKey) => settledNow.has(dayKey(day));
	return {
		status: "settled",
		...plan,
		newlySettled: sortDays(inserted),
		alreadySettled: sortDays([
			...plan.alreadySettled,
			...plan.newlySettled.filter((day) => !isSettledNow(day)),
		]),
		inUnclosedMonths: plan.inUnclosedMonths.filter(isSettledNow),
		withPendingAbsences: plan.withPendingAbsences.filter(isSettledNow),
		employees: employeeBreakdown(values.filter(isSettledNow), names),
	};
}

/** A day's values as a settlement copies them, with the zone its date was read in. */
export interface PayrollSettlementValues extends PayrollSettledDayValues, PayrollDayKey {
	timezone: string;
}

/**
 * Inserts a settlement per day not settled yet, its history event and one audit entry
 * per employee, in one transaction. Days with an active settlement are skipped by the
 * partial unique index. Returns the days settled now. Module-internal: shared by
 * manual settling and confirming an export as paid (#1899).
 */
export async function insertSettlements(
	organizationId: string,
	actor: PayrollSettlementActor,
	values: readonly PayrollSettlementValues[],
	source: { method: PayrollSettlementMethod; payrollExportJobId: string | null },
): Promise<PayrollDayKey[]> {
	if (values.length === 0) return [];
	return db.transaction(async (tx) => {
		const rows = await tx
			.insert(payrollSettledDay)
			.values(
				values.map((value) => ({
					organizationId,
					employeeId: value.employeeId,
					date: value.date,
					timezone: value.timezone,
					creditedMinutes: value.creditedMinutes,
					absences: value.absences,
					method: source.method,
					payrollExportJobId: source.payrollExportJobId,
					settledBy: actor.userId,
				})),
			)
			.onConflictDoNothing()
			.returning({
				id: payrollSettledDay.id,
				employeeId: payrollSettledDay.employeeId,
				date: payrollSettledDay.date,
			});
		if (rows.length === 0) return [];
		await tx.insert(payrollSettledDayEvent).values(
			rows.map((row) => ({
				organizationId,
				settledDayId: row.id,
				employeeId: row.employeeId,
				date: row.date,
				kind: "settled" as const,
				method: source.method,
				payrollExportJobId: source.payrollExportJobId,
				actorUserId: actor.userId,
			})),
		);
		await tx.insert(auditLog).values(
			[...Map.groupBy(rows, (row) => row.employeeId)].map(([employeeId, days]) => ({
				organizationId,
				entityType: "employee",
				entityId: employeeId,
				employeeId,
				action: AuditAction.PAYROLL_DAYS_SETTLED,
				performedBy: actor.userId,
				changes: JSON.stringify({
					method: source.method,
					...(source.payrollExportJobId ? { payrollExportJobId: source.payrollExportJobId } : {}),
					dates: days.map((day) => day.date).toSorted(),
				}),
			})),
		);
		return rows.map(({ employeeId, date }) => ({ employeeId, date }));
	});
}

/**
 * Unsettles the named days (#1896). A reason is required and kept in the history;
 * the day's settlement stays as the record of what was paid.
 */
export async function unsettleDays(
	organizationId: string,
	actor: PayrollSettlementActor,
	days: readonly PayrollDayKey[],
	reason: string,
): Promise<UnsettleDaysResult> {
	const trimmedReason = typeof reason === "string" ? reason.trim() : "";
	if (trimmedReason.length === 0) return { status: "reason_required" };
	const unique = uniqueDays(days);
	if (!unique || unique.length > MAX_UNSETTLE_DAYS) return { status: "invalid_days" };
	const scope = await resolveScope(
		organizationId,
		actor,
		[...new Set(unique.map((day) => day.employeeId))],
		WHENEVER_THEY_LEFT,
	);
	if (!scope.ok) return { status: "out_of_scope", employeeIds: scope.employeeIds };
	if (unique.length === 0) return { status: "unsettled", unsettled: [], notSettled: [] };

	const unsettled = await db.transaction(async (tx) => {
		const rows = await tx
			.update(payrollSettledDay)
			.set({ unsettledAt: sql`now()`, unsettledBy: actor.userId, unsettleReason: trimmedReason })
			.where(
				and(
					eq(payrollSettledDay.organizationId, organizationId),
					isNull(payrollSettledDay.unsettledAt),
					or(
						...unique.map((day) =>
							and(
								eq(payrollSettledDay.employeeId, day.employeeId),
								eq(payrollSettledDay.date, day.date),
							),
						),
					),
				),
			)
			.returning({
				id: payrollSettledDay.id,
				employeeId: payrollSettledDay.employeeId,
				date: payrollSettledDay.date,
				method: payrollSettledDay.method,
				payrollExportJobId: payrollSettledDay.payrollExportJobId,
			});
		if (rows.length === 0) return rows;
		await tx.insert(payrollSettledDayEvent).values(
			rows.map((row) => ({
				organizationId,
				settledDayId: row.id,
				employeeId: row.employeeId,
				date: row.date,
				kind: "unsettled" as const,
				method: row.method,
				payrollExportJobId: row.payrollExportJobId,
				actorUserId: actor.userId,
				reason: trimmedReason,
			})),
		);
		await tx.insert(auditLog).values(
			[...Map.groupBy(rows, (row) => row.employeeId)].map(([employeeId, settled]) => ({
				organizationId,
				entityType: "employee",
				entityId: employeeId,
				employeeId,
				action: AuditAction.PAYROLL_DAYS_UNSETTLED,
				performedBy: actor.userId,
				changes: JSON.stringify({
					reason: trimmedReason,
					dates: settled.map((day) => day.date).toSorted(),
				}),
			})),
		);
		return rows;
	});

	const done = new Set(unsettled.map(dayKey));
	return {
		status: "unsettled",
		unsettled: sortDays(unsettled.map(({ employeeId, date }) => ({ employeeId, date }))),
		notSettled: sortDays(unique.filter((day) => !done.has(dayKey(day)))),
	};
}

/**
 * The settlement history of the grant's employees in the range, newest first: who
 * settled or unsettled each day, when, how, why, and the values it paid. Employees
 * outside the grant are left out. `limit` keeps only the newest events.
 */
export async function settlementHistory(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
	options: { limit?: number } = {},
): Promise<PayrollSettlementHistoryEntry[]> {
	if (!rangeDates(range)) return [];
	const employeeIds = await resolveGrantEmployeeIds(
		organizationId,
		actor,
		WHENEVER_THEY_LEFT,
		scope,
	);
	if (employeeIds.length === 0) return [];
	const query = db
		.select({
			id: payrollSettledDayEvent.id,
			employeeId: payrollSettledDayEvent.employeeId,
			date: payrollSettledDayEvent.date,
			kind: payrollSettledDayEvent.kind,
			method: payrollSettledDayEvent.method,
			payrollExportJobId: payrollSettledDayEvent.payrollExportJobId,
			actorUserId: payrollSettledDayEvent.actorUserId,
			actorName: user.name,
			payrollExportFileName: payrollExportJob.fileName,
			occurredAt: payrollSettledDayEvent.occurredAt,
			reason: payrollSettledDayEvent.reason,
			creditedMinutes: payrollSettledDay.creditedMinutes,
			absences: payrollSettledDay.absences,
		})
		.from(payrollSettledDayEvent)
		.innerJoin(
			payrollSettledDay,
			and(
				eq(payrollSettledDay.id, payrollSettledDayEvent.settledDayId),
				eq(payrollSettledDay.organizationId, payrollSettledDayEvent.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, payrollSettledDayEvent.actorUserId))
		.leftJoin(
			payrollExportJob,
			and(
				eq(payrollExportJob.id, payrollSettledDayEvent.payrollExportJobId),
				eq(payrollExportJob.organizationId, payrollSettledDayEvent.organizationId),
			),
		)
		.where(
			and(
				eq(payrollSettledDayEvent.organizationId, organizationId),
				inArray(payrollSettledDayEvent.employeeId, employeeIds),
				gte(payrollSettledDayEvent.date, range.startDate),
				lte(payrollSettledDayEvent.date, range.endDate),
			),
		)
		.orderBy(
			desc(payrollSettledDayEvent.occurredAt),
			// Within one instant, an unsettle follows the settle it ends.
			desc(payrollSettledDayEvent.kind),
			asc(payrollSettledDayEvent.employeeId),
			asc(payrollSettledDayEvent.date),
		)
		.$dynamic();
	const rows = await (options.limit === undefined ? query : query.limit(options.limit));
	return rows.map(({ creditedMinutes, absences, occurredAt, ...row }) => ({
		...row,
		occurredAt: occurredAt.toISOString(),
		paid: { creditedMinutes, absences },
	}));
}

// ============================================
// INTERNALS
// ============================================

interface ResolvedSettlement {
	ok: true;
	employeeIds: string[];
	/** The employee-days asked for, within `range`. */
	days: PayrollDayKey[];
	/** The range the days span, read once for their values and entries. */
	range: PayrollDateRange;
	options: Required<SettleDaysOptions>;
}

type SettlementResolution = ResolvedSettlement | { ok: false; rejection: SettleDaysRejection };

async function resolveRangeSettlement(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
	options: SettleDaysOptions,
): Promise<SettlementResolution> {
	const dates = rangeDates(range);
	if (!dates) return { ok: false, rejection: { status: "invalid_range" } };
	const resolved = await resolveScope(organizationId, actor, scope.employeeIds, {
		leftAfterStartOf: range.startDate,
	});
	if (!resolved.ok) {
		return { ok: false, rejection: { status: "out_of_scope", employeeIds: resolved.employeeIds } };
	}
	return {
		ok: true,
		employeeIds: resolved.employeeIds,
		days: resolved.employeeIds.flatMap((employeeId) => dates.map((date) => ({ employeeId, date }))),
		range: { startDate: range.startDate, endDate: range.endDate },
		options: {
			skipUnclosedMonths: options.skipUnclosedMonths === true,
			skipPendingAbsences: options.skipPendingAbsences !== false,
		},
	};
}

async function resolveSpecificSettlement(
	organizationId: string,
	actor: PayrollSettlementActor,
	days: readonly PayrollDayKey[],
	options: SettleDaysOptions,
): Promise<SettlementResolution> {
	const unique = uniqueDays(days);
	if (!unique || unique.length === 0 || unique.length > MAX_SETTLE_SPECIFIC_DAYS) {
		return { ok: false, rejection: { status: "invalid_days" } };
	}
	const dates = unique.map((day) => day.date).toSorted();
	const range = { startDate: dates[0], endDate: dates[dates.length - 1] };
	if (!rangeDates(range)) return { ok: false, rejection: { status: "invalid_days" } };
	const resolved = await resolveScope(
		organizationId,
		actor,
		[...new Set(unique.map((day) => day.employeeId))],
		{ leftAfterStartOf: range.startDate },
	);
	if (!resolved.ok) {
		return { ok: false, rejection: { status: "out_of_scope", employeeIds: resolved.employeeIds } };
	}
	return {
		ok: true,
		employeeIds: resolved.employeeIds,
		days: unique,
		range,
		options: {
			skipUnclosedMonths: options.skipUnclosedMonths === true,
			skipPendingAbsences: options.skipPendingAbsences === true,
		},
	};
}

/**
 * Reads the days once and sorts them: already settled, without entries (never settled
 * by hand), left out by the options, or to settle with the values of the read.
 */
async function planManualSettlement(
	organizationId: string,
	actor: PayrollSettlementActor,
	resolved: ResolvedSettlement,
): Promise<{
	plan: ManualSettlePlan;
	values: PayrollSettlementValues[];
	names: ReadonlyMap<string, string>;
}> {
	const { range, options } = resolved;
	const [read, base] = await Promise.all([
		readPeriodForEmployees(
			organizationId,
			actor,
			{ ...range, label: `${range.startDate} – ${range.endDate}` },
			{ employeeIds: resolved.employeeIds },
		),
		planDays(organizationId, resolved.days),
	]);
	const names = new Map(read.employees.map((employee) => [employee.id, employee.name]));
	const readDays = new Map<string, { day: PayrollPeriodDay; timezone: string }>();
	for (const employee of read.employees) {
		for (const day of employee.days) {
			readDays.set(dayKey({ employeeId: employee.id, date: day.date }), {
				day,
				timezone: employee.timezone,
			});
		}
	}

	const unclosed = new Set(base.inUnclosedMonths.map(dayKey));
	const plan: ManualSettlePlan = {
		newlySettled: [],
		alreadySettled: base.alreadySettled,
		inUnclosedMonths: [],
		skippedWithoutEntries: [],
		skippedPendingAbsences: [],
		skippedUnclosedMonths: [],
		withPendingAbsences: [],
		employees: [],
	};
	const values: PayrollSettlementValues[] = [];
	for (const key of base.newlySettled) {
		const entry = readDays.get(dayKey(key));
		if (!entry || !dayHasEntries(entry.day)) {
			plan.skippedWithoutEntries.push(key);
			continue;
		}
		const pending = entry.day.absences.some((absence) => absence.approvalState === "pending");
		if (pending && options.skipPendingAbsences) {
			plan.skippedPendingAbsences.push(key);
			continue;
		}
		const inUnclosedMonth = unclosed.has(dayKey(key));
		if (inUnclosedMonth && options.skipUnclosedMonths) {
			plan.skippedUnclosedMonths.push(key);
			continue;
		}
		plan.newlySettled.push(key);
		if (inUnclosedMonth) plan.inUnclosedMonths.push(key);
		if (pending) plan.withPendingAbsences.push(key);
		values.push({ ...key, timezone: entry.timezone, ...settledDayValues(entry.day) });
	}
	plan.employees = employeeBreakdown(values, names);
	return { plan, values, names };
}

function employeeBreakdown(
	values: readonly PayrollSettlementValues[],
	names: ReadonlyMap<string, string>,
): PayrollSettleEmployeeBreakdown[] {
	return [...Map.groupBy(values, (value) => value.employeeId)]
		.map(([employeeId, days]) => ({
			employeeId,
			name: names.get(employeeId) ?? employeeId,
			days: days.length,
			creditedMinutes: days.reduce((sum, day) => sum + day.creditedMinutes, 0),
		}))
		.toSorted(
			(left, right) =>
				left.name.localeCompare(right.name) || left.employeeId.localeCompare(right.employeeId),
		);
}

/**
 * The requested employees when the grant covers every one of them, otherwise the
 * ones it does not cover. No request means the whole grant. The grant covers its
 * employees who left after `startDate` too (#1894, spec story 24), so their final
 * days can be settled and unsettled.
 */
async function resolveScope(
	organizationId: string,
	actor: PayrollSettlementActor,
	requested: readonly string[] | undefined,
	departed: DepartedEmployees,
): Promise<{ ok: true; employeeIds: string[] } | { ok: false; employeeIds: string[] }> {
	const allowed = await resolveGrantEmployeeIds(organizationId, actor, departed);
	const requestedIds = requested ? [...new Set(requested)] : undefined;
	if (allowed.length === 0) return { ok: false, employeeIds: requestedIds ?? [] };
	if (!requestedIds) return { ok: true, employeeIds: [...allowed] };
	const allowedSet = new Set(allowed);
	const outside = requestedIds.filter((id) => !allowedSet.has(id));
	return outside.length > 0
		? { ok: false, employeeIds: outside }
		: { ok: true, employeeIds: requestedIds };
}

/**
 * Splits the days into those to settle and those already settled, and flags the days
 * to settle whose month is not closed for the employee. Module-internal.
 */
export async function planDays(
	organizationId: string,
	days: readonly PayrollDayKey[],
): Promise<SettleDaysPlan> {
	if (days.length === 0) {
		return { newlySettled: [], alreadySettled: [], inUnclosedMonths: [] };
	}
	const employeeIds = [...new Set(days.map((day) => day.employeeId))];
	const dates = days.map((day) => day.date).toSorted();
	const range = { startDate: dates[0], endDate: dates[dates.length - 1] };
	const months = [...new Set(dates.map(firstDayOfMonth))];
	const [settled, closed] = await Promise.all([
		loadActiveSettledDays(db, { organizationId, employeeIds, ...range }),
		db
			.select({ employeeId: closedMonthEmployee.employeeId, month: closedMonthEmployee.month })
			.from(closedMonthEmployee)
			.where(
				and(
					eq(closedMonthEmployee.organizationId, organizationId),
					inArray(closedMonthEmployee.employeeId, employeeIds),
					inArray(closedMonthEmployee.month, months),
					isNull(closedMonthEmployee.reopenedAt),
				),
			),
	]);
	const settledKeys = new Set(settled.map(dayKey));
	const closedKeys = new Set(closed.map((row) => `${row.employeeId}:${row.month}`));
	const plan: SettleDaysPlan = { newlySettled: [], alreadySettled: [], inUnclosedMonths: [] };
	for (const { employeeId, date } of sortDays([...days])) {
		const day = { employeeId, date };
		if (settledKeys.has(dayKey(day))) {
			plan.alreadySettled.push(day);
			continue;
		}
		plan.newlySettled.push(day);
		if (!closedKeys.has(`${employeeId}:${firstDayOfMonth(date)}`)) {
			plan.inUnclosedMonths.push(day);
		}
	}
	return plan;
}

function rangeDates(range: PayrollDateRange): string[] | null {
	try {
		const start = parsePlainDate(range.startDate);
		const end = parsePlainDate(range.endDate);
		const length = start.until(end, { largestUnit: "days" }).days + 1;
		if (length < 1 || length > MAX_SETTLE_RANGE_DAYS) return null;
		return Array.from({ length }, (_, index) => start.add({ days: index }).toString());
	} catch {
		return null;
	}
}

function uniqueDays(days: readonly PayrollDayKey[]): PayrollDayKey[] | null {
	if (!Array.isArray(days)) return null;
	const unique = new Map<string, PayrollDayKey>();
	for (const day of days) {
		if (typeof day?.employeeId !== "string" || typeof day.date !== "string") return null;
		try {
			parsePlainDate(day.date);
		} catch {
			return null;
		}
		unique.set(dayKey(day), { employeeId: day.employeeId, date: day.date });
	}
	return [...unique.values()];
}

function firstDayOfMonth(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

function dayKey(day: PayrollDayKey): string {
	return `${day.employeeId}:${day.date}`;
}

function sortDays(days: PayrollDayKey[]): PayrollDayKey[] {
	return days.toSorted(
		(left, right) =>
			left.employeeId.localeCompare(right.employeeId) || left.date.localeCompare(right.date),
	);
}
