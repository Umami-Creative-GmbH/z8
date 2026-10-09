import "server-only";

import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { invoicedWork, project, timeEntry, workPeriod } from "@/db/schema";
import { workDayOf } from "@/lib/billable-time/applicable-rate";
import { listBillableRatesForWork } from "@/lib/billable-time/billable-rates";
import { listCostRatesForWork } from "@/lib/billable-time/cost-rates";
import { parsePlainDay } from "@/lib/billable-time/input";
import { rateFromStored } from "@/lib/billable-time/money";
import { activeProjectCustomerIdSql } from "@/lib/billable-time/project-customer";
import type { ReportedWork, ReportRates } from "@/lib/billable-time/report-figures";
import { dateFromInstant, instantFromDate, type PlainDate } from "@/lib/datetime/temporal-core";
import { unresolvedWorkPeriodReviewSql } from "@/lib/time-tracking/unresolved-work-period-review";
import { completedWorkPeriodCondition } from "./completed-work";

type Reader = Pick<typeof db, "select">;

/** A report period as calendar days, both inclusive. */
export interface ReportDayRange {
	fromDay: PlainDate;
	toDay: PlainDate;
}

/**
 * The calendar days of a report request. The report filters send each day as
 * its UTC midnight (`new Date("2026-03-31")`), so the day is read in UTC; a
 * later instant on the same UTC day (`23:59:59Z`) names the same day.
 */
export function reportDayRangeFromDates(startDate: Date, endDate: Date): ReportDayRange {
	const dayOf = (value: Date) => instantFromDate(value).toZonedDateTimeISO("UTC").toPlainDate();
	return { fromDay: dayOf(startDate), toDay: dayOf(endDate) };
}

/**
 * The calendar days of a report request sent as ISO dates ("2026-03-31"), both
 * inclusive. Null for anything else, or when the range ends before it starts.
 */
export function reportDayRangeFromDays(fromDay: unknown, toDay: unknown): ReportDayRange | null {
	const from = parsePlainDay(fromDay);
	const to = parsePlainDay(toDay);
	if (!from || !to || Temporal.PlainDate.compare(from, to) > 0) return null;
	return { fromDay: from, toDay: to };
}

export function isWithinDayRange(day: PlainDate, range: ReportDayRange): boolean {
	return (
		Temporal.PlainDate.compare(range.fromDay, day) <= 0 &&
		Temporal.PlainDate.compare(day, range.toDay) <= 0
	);
}

/** The employee-local day a work period started on, at its start entry's offset. */
export function reportedWorkDay(work: Pick<ReportedWork, "startedAt" | "startOffsetMinutes">) {
	return workDayOf(work.startedAt, work.startOffsetMinutes);
}

/** UTC offsets span -12:00 to +14:00; a day of margin covers every local day. */
function instantWindow(range: ReportDayRange) {
	const start = range.fromDay.subtract({ days: 1 }).toZonedDateTime("UTC").toInstant();
	const end = range.toDay.add({ days: 2 }).toZonedDateTime("UTC").toInstant();
	return { start: dateFromInstant(start), end: dateFromInstant(end) };
}

/**
 * The work a project report counts (#794, #902): completed, non-deleted work of
 * the given projects in the organization whose employee-local start day (at the
 * offset captured on its start entry) falls in the range. Live work never
 * counts. Each row carries the project's current active customer, whether a
 * correction or submission for it is pending, and whether it is invoiced work
 * (in an unreleased invoice draft, #903) with its frozen rates.
 */
export async function loadReportedProjectWork(
	reader: Reader,
	organizationId: string,
	scope: { projectIds: readonly string[]; range: ReportDayRange },
): Promise<ReportedWork[]> {
	if (scope.projectIds.length === 0) return [];
	const window = instantWindow(scope.range);
	const rows = await reader
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			projectId: workPeriod.projectId,
			// A deleted (inactive) customer counts as no customer.
			customerId: activeProjectCustomerIdSql(),
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			isBillable: workPeriod.isBillable,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
			pendingReview: unresolvedWorkPeriodReviewSql(),
			invoicedShares: invoicedWork.shares,
			changedAfterInvoicingAt: invoicedWork.changedAfterInvoicingAt,
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.innerJoin(
			project,
			and(eq(project.id, workPeriod.projectId), eq(project.organizationId, organizationId)),
		)
		.leftJoin(
			invoicedWork,
			and(
				eq(invoicedWork.workPeriodId, workPeriod.id),
				eq(invoicedWork.organizationId, organizationId),
				isNull(invoicedWork.releasedAt),
			),
		)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(workPeriod.projectId, [...scope.projectIds]),
				completedWorkPeriodCondition(),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, window.start),
				lt(workPeriod.startTime, window.end),
			),
		)
		.orderBy(workPeriod.startTime, workPeriod.id);

	const work: ReportedWork[] = [];
	for (const row of rows) {
		if (row.projectId === null || row.endTime === null || row.durationMinutes === null) continue;
		const item: ReportedWork = {
			id: row.id,
			employeeId: row.employeeId,
			projectId: row.projectId,
			customerId: row.customerId,
			startedAt: instantFromDate(row.startTime),
			endedAt: instantFromDate(row.endTime),
			startOffsetMinutes: row.startOffsetMinutes,
			durationMinutes: row.durationMinutes,
			isBillable: row.isBillable,
			pendingReview: row.pendingReview === true,
			invoiced:
				row.invoicedShares === null
					? null
					: {
							shares: row.invoicedShares.map((share) => ({
								durationMs: share.durationMs,
								rate: rateFromStored(share.rate),
								...(share.amount === undefined ? {} : { amount: rateFromStored(share.amount) }),
							})),
							changedAfterInvoicing: row.changedAfterInvoicingAt !== null,
						},
		};
		if (isWithinDayRange(reportedWorkDay(item), scope.range)) work.push(item);
	}
	return work;
}

/**
 * The billable and cost rate periods that can apply to the given work, read
 * now (Billable Time ADR 0001). Cost rates are only read when the caller may
 * see them.
 */
export async function loadReportRates(
	reader: Reader,
	organizationId: string,
	work: readonly ReportedWork[],
	options: { includeCost: boolean },
): Promise<ReportRates> {
	if (work.length === 0) return { billable: [], cost: [] };
	let fromDay = reportedWorkDay(work[0]);
	let toDay = fromDay;
	for (const item of work) {
		const first = reportedWorkDay(item);
		const last = workDayOf(item.endedAt, item.startOffsetMinutes);
		if (Temporal.PlainDate.compare(first, fromDay) < 0) fromDay = first;
		if (Temporal.PlainDate.compare(last, toDay) > 0) toDay = last;
	}
	const employeeIds = [...new Set(work.map((item) => item.employeeId))];
	const [billable, cost] = await Promise.all([
		listBillableRatesForWork(reader, organizationId, {
			employeeIds,
			projectIds: [...new Set(work.map((item) => item.projectId))],
			customerIds: [
				...new Set(work.flatMap((item) => (item.customerId === null ? [] : [item.customerId]))),
			],
			fromDay,
			toDay,
		}),
		options.includeCost
			? listCostRatesForWork(reader, organizationId, { employeeIds, fromDay, toDay })
			: Promise.resolve([]),
	]);
	return { billable, cost };
}
