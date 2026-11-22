import { and, asc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { payrollSettledDay, timeEntry, workPeriod } from "@/db/schema";
import { employeeDepartureReview } from "@/db/schema/employee-lifecycle";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { closedRangesForEmployee } from "@/lib/time-tracking/closed-months/store";
import type { LifecycleClient } from "./types";
import type { PastDepartureImpactSummary } from "./view-types";

type ImpactReader = Pick<typeof rootDatabase, "select">;

const MAX_PREVIEW_WORK_PERIOD_IDS = 50;
const MAX_PREVIEW_SETTLED_DATES = 62;

/**
 * Read-only inspection of what a retrospective leaving date touches:
 * 1. Recorded work (`work_period` and `time_entry`) after the cutoff instant;
 * 2. Active closed months (`closed_month_employee` where `reopened_at IS NULL`)
 *    whose range extends past the cutoff;
 * 3. Active settled payroll days (`payroll_settled_day` where `unsettled_at IS NULL`)
 *    on or after the cutoff local calendar date (`lastWorkingDay + 1`).
 *
 * Strictly read-only — never mutates work, closed months, or settled payroll.
 */
export async function inspectRetrospectiveDepartureImpact(
	database: ImpactReader,
	input: {
		organizationId: string;
		employeeId: string;
		cutoff: Instant;
		/** Optional exclusive upper bound (e.g. subsequent rehire period start) to avoid flagging a later stint (A1-25). */
		upperBound?: Instant | null;
		timezone: string;
		lastWorkingDay: string;
	},
): Promise<PastDepartureImpactSummary> {
	const cutoffDate = dateFromInstant(input.cutoff);
	const cutoffLocalDate = input.cutoff.toZonedDateTimeISO(input.timezone).toPlainDate().toString();
	const upperBound = input.upperBound ?? null;
	const upperBoundDate = upperBound ? dateFromInstant(upperBound) : null;
	const upperBoundLocalDate = upperBound
		? upperBound.toZonedDateTimeISO(input.timezone).toPlainDate().toString()
		: null;

	const [workRows, timeEntryAgg, closedRanges, settledRows] = await Promise.all([
		database
			.select({
				id: workPeriod.id,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
			})
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, input.employeeId),
					isNull(workPeriod.deletedAt),
					or(
						gte(workPeriod.startTime, cutoffDate),
						gt(workPeriod.endTime, cutoffDate),
						isNull(workPeriod.endTime),
					),
					...(upperBoundDate ? [lt(workPeriod.startTime, upperBoundDate)] : []),
				),
			)
			.orderBy(asc(workPeriod.startTime), asc(workPeriod.id)),
		database
			.select({
				count: sql<number>`count(*)::int`,
				earliest: sql<Date | null>`min(${timeEntry.timestamp})`,
				latest: sql<Date | null>`max(${timeEntry.timestamp})`,
			})
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, input.employeeId),
					gt(timeEntry.timestamp, cutoffDate),
					...(upperBoundDate ? [lt(timeEntry.timestamp, upperBoundDate)] : []),
				),
			),
		closedRangesForEmployee(database, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
		}),
		database
			.select({
				date: payrollSettledDay.date,
			})
			.from(payrollSettledDay)
			.where(
				and(
					eq(payrollSettledDay.organizationId, input.organizationId),
					eq(payrollSettledDay.employeeId, input.employeeId),
					isNull(payrollSettledDay.unsettledAt),
					gte(payrollSettledDay.date, cutoffLocalDate),
					...(upperBoundLocalDate ? [lt(payrollSettledDay.date, upperBoundLocalDate)] : []),
				),
			)
			.orderBy(asc(payrollSettledDay.date)),
	]);

	// Separate open timers that started before the cutoff (handled by clock-out) from
	// recorded work that actually occurs after the cutoff instant.
	let hasRunningTimer = false;
	const postCutoffPeriods: Array<{ id: string; startTime: Date; endTime: Date | null }> = [];
	for (const row of workRows) {
		if (row.endTime === null) {
			hasRunningTimer = true;
			if (row.startTime.getTime() >= cutoffDate.getTime()) {
				postCutoffPeriods.push(row);
			}
			continue;
		}
		if (
			row.startTime.getTime() >= cutoffDate.getTime() ||
			row.endTime.getTime() > cutoffDate.getTime()
		) {
			postCutoffPeriods.push(row);
		}
	}

	const timeEntryCount = Number(timeEntryAgg[0]?.count ?? 0);
	const upperBoundMs = upperBoundDate ? upperBoundDate.getTime() : null;
	const timestamps: Date[] = [];
	for (const row of postCutoffPeriods) {
		const clippedStartMs = Math.max(row.startTime.getTime(), cutoffDate.getTime());
		if (upperBoundMs === null || clippedStartMs < upperBoundMs) {
			timestamps.push(new Date(clippedStartMs));
		}
		if (row.endTime) {
			// A2-20: Clip work-period end time to upperBound so a work period spanning rehire
			// never extends an old-stint review's latestWorkAt/affectedEndAt into the later stint.
			const clippedEndMs =
				upperBoundMs !== null
					? Math.min(row.endTime.getTime(), upperBoundMs)
					: row.endTime.getTime();
			timestamps.push(new Date(clippedEndMs));
		}
	}
	if (timeEntryAgg[0]?.earliest) timestamps.push(new Date(timeEntryAgg[0].earliest));
	if (timeEntryAgg[0]?.latest) timestamps.push(new Date(timeEntryAgg[0].latest));

	let earliestWorkAt: string | null = null;
	let latestWorkAt: string | null = null;
	if (timestamps.length > 0) {
		let minTs = timestamps[0]!.getTime();
		let maxTs = timestamps[0]!.getTime();
		for (const ts of timestamps) {
			const ms = ts.getTime();
			if (ms < minTs) minTs = ms;
			if (ms > maxTs) maxTs = ms;
		}
		earliestWorkAt = new Date(minTs).toISOString();
		latestWorkAt = new Date(maxTs).toISOString();
	}

	const overlappingClosedMonths = closedRanges
		.filter(
			(range) =>
				compareInstants(range.endExclusive, input.cutoff) > 0 &&
				(upperBound === null || compareInstants(range.start, upperBound) < 0),
		)
		.map((range) => range.month);

	const uniqueSettledDates = [...new Set(settledRows.map((row) => row.date))].sort();
	const settledDayCount = settledRows.length;
	const requiresPayrollReconciliation = overlappingClosedMonths.length > 0 || settledDayCount > 0;
	const requiresWorkAfterCutoffReview = postCutoffPeriods.length > 0 || timeEntryCount > 0;

	return {
		workAfterCutoff: {
			workPeriodCount: postCutoffPeriods.length,
			timeEntryCount,
			workPeriodIds: postCutoffPeriods.slice(0, MAX_PREVIEW_WORK_PERIOD_IDS).map((row) => row.id),
			earliestWorkAt,
			latestWorkAt,
			hasRunningTimer,
		},
		payrollReconciliation: {
			closedMonths: overlappingClosedMonths,
			settledDayCount,
			settledDates: uniqueSettledDates.slice(0, MAX_PREVIEW_SETTLED_DATES),
			earliestSettledDate: uniqueSettledDates[0] ?? null,
			latestSettledDate: uniqueSettledDates.at(-1) ?? null,
			requiresReconciliation: requiresPayrollReconciliation,
		},
		requiresWorkAfterCutoffReview,
		requiresPayrollReconciliationReview: requiresPayrollReconciliation,
	};
}

export interface ReconcileRetrospectiveReviewsResult {
	workAfterCutoffReviewOpened: boolean;
	payrollReconciliationReviewOpened: boolean;
	impact: PastDepartureImpactSummary;
}

/**
 * Creates, updates, or reconciles durable `work_after_cutoff` and
 * `payroll_reconciliation` reviews linked to a departure.
 *
 * NEVER mutates closed months, settled payroll days, or recorded work.
 * When `autoResolveCleared` is true (used by `correctPastDepartureDate` when a
 * date correction eliminates an earlier discrepancy), previously open reviews
 * with zero remaining discrepancies are resolved cleanly with an audit note.
 */
export async function reconcileRetrospectiveDepartureReviewsInTx(
	tx: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string;
		cutoff: Instant;
		upperBound?: Instant | null;
		timezone: string;
		lastWorkingDay: string;
		now: Instant;
		actorUserId?: string | null;
		autoResolveCleared?: boolean;
	},
): Promise<ReconcileRetrospectiveReviewsResult> {
	const impact = await inspectRetrospectiveDepartureImpact(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		cutoff: input.cutoff,
		upperBound: input.upperBound ?? null,
		timezone: input.timezone,
		lastWorkingDay: input.lastWorkingDay,
	});
	const cutoffDate = dateFromInstant(input.cutoff);
	const nowDate = dateFromInstant(input.now);

	const workAfterCutoffReviewOpened = await upsertOrResolveDepartureReview(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId: input.employmentPeriodId,
		departureId: input.departureId,
		kind: "work_after_cutoff",
		required: impact.requiresWorkAfterCutoffReview,
		metadata: {
			reason: "work_recorded_after_cutoff",
			cutoff: input.cutoff.toString(),
			lastWorkingDay: input.lastWorkingDay,
			workPeriodCount: impact.workAfterCutoff.workPeriodCount,
			timeEntryCount: impact.workAfterCutoff.timeEntryCount,
			workPeriodIds: impact.workAfterCutoff.workPeriodIds,
			earliestWorkAt: impact.workAfterCutoff.earliestWorkAt,
			latestWorkAt: impact.workAfterCutoff.latestWorkAt,
		},
		affectedStartAt: cutoffDate,
		affectedEndAt: computeWorkAffectedEnd(cutoffDate, impact.workAfterCutoff.latestWorkAt),
		nowDate,
		actorUserId: input.actorUserId ?? null,
		autoResolveCleared: input.autoResolveCleared === true,
		clearedResolutionNote: `Leaving date corrected to ${input.lastWorkingDay}; no recorded work remains after cutoff.`,
	});

	const payrollEndAt = await computePayrollAffectedEnd(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		cutoff: input.cutoff,
		upperBound: input.upperBound ?? null,
		timezone: input.timezone,
		latestSettledDate: impact.payrollReconciliation.latestSettledDate,
	});

	const payrollReconciliationReviewOpened = await upsertOrResolveDepartureReview(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId: input.employmentPeriodId,
		departureId: input.departureId,
		kind: "payroll_reconciliation",
		required: impact.requiresPayrollReconciliationReview,
		metadata: {
			reason: "closed_or_settled_payroll_overlap",
			cutoff: input.cutoff.toString(),
			lastWorkingDay: input.lastWorkingDay,
			closedMonths: impact.payrollReconciliation.closedMonths,
			settledDayCount: impact.payrollReconciliation.settledDayCount,
			settledDates: impact.payrollReconciliation.settledDates,
			earliestSettledDate: impact.payrollReconciliation.earliestSettledDate,
			latestSettledDate: impact.payrollReconciliation.latestSettledDate,
		},
		affectedStartAt: cutoffDate,
		affectedEndAt: payrollEndAt,
		nowDate,
		actorUserId: input.actorUserId ?? null,
		autoResolveCleared: input.autoResolveCleared === true,
		clearedResolutionNote: `Leaving date corrected to ${input.lastWorkingDay}; no closed or settled payroll overlap remains.`,
	});

	return {
		workAfterCutoffReviewOpened,
		payrollReconciliationReviewOpened,
		impact,
	};
}

function computeWorkAffectedEnd(cutoffDate: Date, latestWorkAt: string | null): Date {
	if (!latestWorkAt) return cutoffDate;
	const latest = new Date(latestWorkAt);
	return latest.getTime() >= cutoffDate.getTime() ? latest : cutoffDate;
}

async function computePayrollAffectedEnd(
	tx: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		cutoff: Instant;
		upperBound?: Instant | null;
		timezone: string;
		latestSettledDate: string | null;
	},
): Promise<Date> {
	const cutoffMs = input.cutoff.epochMilliseconds;
	const upperBound = input.upperBound ?? null;
	const upperBoundMs = upperBound ? upperBound.epochMilliseconds : null;
	let maxMs = cutoffMs;

	const closedRanges = await closedRangesForEmployee(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	});
	for (const range of closedRanges) {
		if (
			compareInstants(range.endExclusive, input.cutoff) > 0 &&
			(upperBound === null || compareInstants(range.start, upperBound) < 0)
		) {
			const effectiveEndMs =
				upperBoundMs !== null
					? Math.min(range.endExclusive.epochMilliseconds, upperBoundMs)
					: range.endExclusive.epochMilliseconds;
			if (effectiveEndMs > maxMs) {
				maxMs = effectiveEndMs;
			}
		}
	}

	if (input.latestSettledDate) {
		const nextDay = parsePlainDate(input.latestSettledDate)
			.add({ days: 1 })
			.toZonedDateTime(input.timezone)
			.toInstant();
		const effectiveSettledMs =
			upperBoundMs !== null
				? Math.min(nextDay.epochMilliseconds, upperBoundMs)
				: nextDay.epochMilliseconds;
		if (effectiveSettledMs > maxMs) {
			maxMs = effectiveSettledMs;
		}
	}

	return dateFromInstant(instantFromDate(new Date(maxMs)));
}

async function upsertOrResolveDepartureReview(
	tx: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string;
		kind: "work_after_cutoff" | "payroll_reconciliation";
		required: boolean;
		metadata: Record<string, unknown>;
		affectedStartAt: Date;
		affectedEndAt: Date;
		nowDate: Date;
		actorUserId: string | null;
		autoResolveCleared: boolean;
		clearedResolutionNote: string;
	},
): Promise<boolean> {
	const [existing] = await tx
		.select({
			id: employeeDepartureReview.id,
			status: employeeDepartureReview.status,
		})
		.from(employeeDepartureReview)
		.where(
			and(
				eq(employeeDepartureReview.organizationId, input.organizationId),
				eq(employeeDepartureReview.departureId, input.departureId),
				eq(employeeDepartureReview.kind, input.kind),
				isNull(employeeDepartureReview.subjectId),
			),
		)
		.for("update");

	if (!input.required) {
		if (existing && existing.status === "open" && input.autoResolveCleared) {
			await tx
				.update(employeeDepartureReview)
				.set({
					status: "resolved",
					resolvedBy: input.actorUserId,
					resolvedAt: input.nowDate,
					resolution: input.clearedResolutionNote,
					metadata: input.metadata,
				})
				.where(
					and(
						eq(employeeDepartureReview.organizationId, input.organizationId),
						eq(employeeDepartureReview.id, existing.id),
					),
				);
		}
		return false;
	}

	if (existing) {
		await tx
			.update(employeeDepartureReview)
			.set({
				status: "open",
				resolvedBy: null,
				resolvedAt: null,
				resolution: null,
				metadata: input.metadata,
				affectedStartAt: input.affectedStartAt,
				affectedEndAt: input.affectedEndAt,
			})
			.where(
				and(
					eq(employeeDepartureReview.organizationId, input.organizationId),
					eq(employeeDepartureReview.id, existing.id),
				),
			);
		return true;
	}

	await tx
		.insert(employeeDepartureReview)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId: input.employmentPeriodId,
			departureId: input.departureId,
			kind: input.kind,
			subjectId: null,
			status: "open",
			metadata: input.metadata,
			affectedStartAt: input.affectedStartAt,
			affectedEndAt: input.affectedEndAt,
		})
		.onConflictDoNothing();
	return true;
}
