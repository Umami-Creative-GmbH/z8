import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	auditLog,
	closedMonthEmployee,
	type PayrollSettledDayEventKind,
	type PayrollSettlementMethod,
	payrollSettledDay,
	payrollSettledDayEvent,
} from "@/db/schema";
import { user } from "@/db/auth-schema";
import { AuditAction } from "@/lib/audit-logger";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { resolvePayrollAccessibleEmployeeIds } from "@/lib/payroll-access/permissions";
import { readPeriodForEmployees } from "./read-period";
import { loadActiveSettledDays } from "./settled-days-store";
import { settledDayValues } from "./settlement-values";
import type { PayrollPeriodActor, PayrollPeriodScope, PayrollSettledDayValues } from "./types";

/**
 * Settling and unsettling employee-days (#1896, payroll-export ADR 0004). A settled
 * day records that its worked hours and absences were paid; it keeps a copy of
 * them, never freezes data and needs no closed month. Every operation is
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

export interface SettleDaysPlan {
	/** Days settled now (preview: days a settle would settle). */
	newlySettled: PayrollDayKey[];
	/** Days with an active settlement already; never settled twice. */
	alreadySettled: PayrollDayKey[];
	/** Days whose month is not closed for the employee: a warning, never a block. */
	inUnclosedMonths: PayrollDayKey[];
}

export type SettleDaysRejection =
	/** Employees outside the grant or the organization; nothing was settled. */
	{ status: "out_of_scope"; employeeIds: string[] } | { status: "invalid_range" };

export type SettleDaysPreview = SettleDaysRejection | ({ status: "ready" } & SettleDaysPlan);
export type SettleDaysResult = SettleDaysRejection | ({ status: "settled" } & SettleDaysPlan);

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
): Promise<SettleDaysPreview> {
	const resolved = await resolveSettlement(organizationId, actor, scope, range);
	if (!resolved.ok) return resolved.rejection;
	return { status: "ready", ...(await planSettlement(organizationId, resolved)) };
}

/**
 * Settles the employees' days in the range by hand (#1896): each day not settled
 * yet gets a settlement with a copy of its current credited minutes and approved
 * absences, and a history event. Days settled before are reported, not duplicated.
 */
export async function settleDays(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
): Promise<SettleDaysResult> {
	const resolved = await resolveSettlement(organizationId, actor, scope, range);
	if (!resolved.ok) return resolved.rejection;
	const plan = await planSettlement(organizationId, resolved);
	if (plan.newlySettled.length === 0) return { status: "settled", ...plan };

	const read = await readPeriodForEmployees(
		organizationId,
		actor,
		{ ...range, label: `${range.startDate} – ${range.endDate}` },
		{ employeeIds: [...new Set(plan.newlySettled.map((day) => day.employeeId))] },
	);
	const toSettle = new Set(plan.newlySettled.map(dayKey));
	const values = read.employees.flatMap((employee) =>
		employee.days
			.filter((day) => toSettle.has(dayKey({ employeeId: employee.id, date: day.date })))
			.map((day) => ({
				employeeId: employee.id,
				date: day.date,
				timezone: employee.timezone,
				...settledDayValues(day),
			})),
	);

	const inserted = await db.transaction(async (tx) => {
		const rows = values.length
			? await tx
					.insert(payrollSettledDay)
					.values(
						values.map((value) => ({
							organizationId,
							employeeId: value.employeeId,
							date: value.date,
							timezone: value.timezone,
							creditedMinutes: value.creditedMinutes,
							absences: value.absences,
							method: "manual" as const,
							settledBy: actor.userId,
						})),
					)
					.onConflictDoNothing()
					.returning({
						id: payrollSettledDay.id,
						employeeId: payrollSettledDay.employeeId,
						date: payrollSettledDay.date,
					})
			: [];
		if (rows.length === 0) return rows;
		await tx.insert(payrollSettledDayEvent).values(
			rows.map((row) => ({
				organizationId,
				settledDayId: row.id,
				employeeId: row.employeeId,
				date: row.date,
				kind: "settled" as const,
				method: "manual" as const,
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
					method: "manual",
					dates: days.map((day) => day.date).toSorted(),
				}),
			})),
		);
		return rows;
	});

	// A day a concurrent settle took between the plan and the insert is already settled.
	const settledNow = new Set(inserted.map(dayKey));
	return {
		status: "settled",
		newlySettled: sortDays(inserted.map(({ employeeId, date }) => ({ employeeId, date }))),
		alreadySettled: sortDays([
			...plan.alreadySettled,
			...plan.newlySettled.filter(
				(day) => !settledNow.has(dayKey(day)) && values.some((value) => sameDay(value, day)),
			),
		]),
		inUnclosedMonths: plan.inUnclosedMonths,
	};
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
	const scope = await resolveScope(organizationId, actor, [
		...new Set(unique.map((day) => day.employeeId)),
	]);
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
 * outside the grant are left out.
 */
export async function settlementHistory(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
): Promise<PayrollSettlementHistoryEntry[]> {
	const allowed = new Set(
		await resolvePayrollAccessibleEmployeeIds({
			organizationId,
			payrollEmployeeId: actor.employeeId,
		}),
	);
	const employeeIds = scope.employeeIds
		? scope.employeeIds.filter((id) => allowed.has(id))
		: [...allowed];
	if (employeeIds.length === 0 || !rangeDates(range)) return [];
	const rows = await db
		.select({
			id: payrollSettledDayEvent.id,
			employeeId: payrollSettledDayEvent.employeeId,
			date: payrollSettledDayEvent.date,
			kind: payrollSettledDayEvent.kind,
			method: payrollSettledDayEvent.method,
			payrollExportJobId: payrollSettledDayEvent.payrollExportJobId,
			actorUserId: payrollSettledDayEvent.actorUserId,
			actorName: user.name,
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
		);
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
	dates: string[];
	range: PayrollDateRange;
}

async function resolveSettlement(
	organizationId: string,
	actor: PayrollSettlementActor,
	scope: PayrollPeriodScope,
	range: PayrollDateRange,
): Promise<ResolvedSettlement | { ok: false; rejection: SettleDaysRejection }> {
	const dates = rangeDates(range);
	if (!dates) return { ok: false, rejection: { status: "invalid_range" } };
	const resolved = await resolveScope(organizationId, actor, scope.employeeIds);
	if (!resolved.ok) {
		return { ok: false, rejection: { status: "out_of_scope", employeeIds: resolved.employeeIds } };
	}
	return { ok: true, employeeIds: resolved.employeeIds, dates, range };
}

/**
 * The requested employees when the grant covers every one of them, otherwise the
 * ones it does not cover. No request means the whole grant.
 */
async function resolveScope(
	organizationId: string,
	actor: PayrollSettlementActor,
	requested: readonly string[] | undefined,
): Promise<{ ok: true; employeeIds: string[] } | { ok: false; employeeIds: string[] }> {
	const allowed = await resolvePayrollAccessibleEmployeeIds({
		organizationId,
		payrollEmployeeId: actor.employeeId,
	});
	const requestedIds = requested ? [...new Set(requested)] : undefined;
	if (allowed.length === 0) return { ok: false, employeeIds: requestedIds ?? [] };
	if (!requestedIds) return { ok: true, employeeIds: [...allowed] };
	const allowedSet = new Set(allowed);
	const outside = requestedIds.filter((id) => !allowedSet.has(id));
	return outside.length > 0
		? { ok: false, employeeIds: outside }
		: { ok: true, employeeIds: requestedIds };
}

async function planSettlement(
	organizationId: string,
	resolved: ResolvedSettlement,
): Promise<SettleDaysPlan> {
	const { employeeIds, dates, range } = resolved;
	if (employeeIds.length === 0) {
		return { newlySettled: [], alreadySettled: [], inUnclosedMonths: [] };
	}
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
	for (const employeeId of employeeIds.toSorted()) {
		for (const date of dates) {
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

function sameDay(left: PayrollDayKey, right: PayrollDayKey): boolean {
	return left.employeeId === right.employeeId && left.date === right.date;
}

function sortDays(days: PayrollDayKey[]): PayrollDayKey[] {
	return days.toSorted(
		(left, right) =>
			left.employeeId.localeCompare(right.employeeId) || left.date.localeCompare(right.date),
	);
}
