import "server-only";

import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { timeEntry, workPeriod } from "@/db/schema";
import { dateFromInstant, instantFromDate, type PlainDate } from "@/lib/datetime/temporal-core";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { type ContractorPricing, type ContractorWork, priceContractorWork } from "./pricing";
import { listContractorTermsForPricing } from "./store";

/**
 * Feeds the contractor pricing engine (`pricing.ts`) from the database (#1998).
 * Read-only and organization-scoped.
 */

type Reader = Pick<Transaction, "select">;

export interface ContractorDayRange {
	employeeIds: readonly string[];
	/** First local day, inclusive. */
	fromDay: PlainDate;
	/** Last local day, inclusive. */
	toDay: PlainDate;
}

/**
 * Wide enough for every captured offset (-23:59 to +23:59) and for work that
 * started the day before and runs past local midnight into the range.
 */
function instantWindow(range: Pick<ContractorDayRange, "fromDay" | "toDay">) {
	const start = range.fromDay.subtract({ days: 2 }).toZonedDateTime("UTC").toInstant();
	const end = range.toDay.add({ days: 2 }).toZonedDateTime("UTC").toInstant();
	return { start: dateFromInstant(start), end: dateFromInstant(end) };
}

/**
 * The given contractors' completed work that may touch a local day of the
 * range: completed, not deleted, with its start entry's captured offset.
 * The engine cuts it to the range's local days.
 */
export async function loadContractorWork(
	reader: Reader,
	organizationId: string,
	range: ContractorDayRange,
): Promise<ContractorWork[]> {
	if (range.employeeIds.length === 0) return [];
	const window = instantWindow(range);
	const rows = await reader
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			startOffsetMinutes: timeEntry.utcOffsetMinutes,
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				inArray(workPeriod.employeeId, [...range.employeeIds]),
				completedWorkPeriodCondition(),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, window.start),
				lt(workPeriod.startTime, window.end),
			),
		)
		.orderBy(workPeriod.startTime, workPeriod.id);

	return rows.flatMap((row) =>
		row.endTime === null || row.durationMinutes === null
			? []
			: [
					{
						id: row.id,
						employeeId: row.employeeId,
						startedAt: instantFromDate(row.startTime),
						endedAt: instantFromDate(row.endTime),
						startOffsetMinutes: row.startOffsetMinutes,
						durationMinutes: row.durationMinutes,
					},
				],
	);
}

/**
 * Prices the given contractors' completed work on the local days of the range
 * with the terms in force on each day. The one entry point for Billable Time
 * margin and Contractor Statements; it never writes.
 */
export async function priceContractorDays(
	reader: Reader,
	organizationId: string,
	range: ContractorDayRange,
): Promise<ContractorPricing> {
	const [work, terms] = await Promise.all([
		loadContractorWork(reader, organizationId, range),
		listContractorTermsForPricing(reader, organizationId, range),
	]);
	return priceContractorWork({
		work,
		terms,
		range: { fromDay: range.fromDay, toDay: range.toDay },
	});
}
