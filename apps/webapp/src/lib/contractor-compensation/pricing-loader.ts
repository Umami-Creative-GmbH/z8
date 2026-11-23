import "server-only";

import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { employeeEmploymentPeriod, timeEntry, workPeriod } from "@/db/schema";
import { dateFromInstant, instantFromDate, type PlainDate } from "@/lib/datetime/temporal-core";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import {
	type ContractorEngagement,
	type ContractorPricing,
	type ContractorWork,
	priceContractorWork,
} from "./pricing";
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
 * The given people's completed work that may touch a local day of the range:
 * completed, not deleted, with its start entry's captured offset, whatever
 * the engagement. The engine keeps only the parts inside contractor
 * engagements and on the range's local days.
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
 * The given people's External Contractor employment periods that may touch a
 * local day of the range, as instant spans `[startedAt, endedAt)`. A start is
 * bounded only when it was recorded, as the contract resolver counts it
 * (`resolveEmploymentPeriodForDay`).
 */
export async function loadContractorEngagements(
	reader: Reader,
	organizationId: string,
	range: ContractorDayRange,
): Promise<ContractorEngagement[]> {
	if (range.employeeIds.length === 0) return [];
	const window = instantWindow(range);
	const rows = await reader
		.select({
			id: employeeEmploymentPeriod.id,
			employeeId: employeeEmploymentPeriod.employeeId,
			startedAt: employeeEmploymentPeriod.startedAt,
			startProvenance: employeeEmploymentPeriod.startProvenance,
			endedAt: employeeEmploymentPeriod.endedAt,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				inArray(employeeEmploymentPeriod.employeeId, [...range.employeeIds]),
				eq(employeeEmploymentPeriod.engagementKind, "contractor"),
				or(
					ne(employeeEmploymentPeriod.startProvenance, "recorded"),
					isNull(employeeEmploymentPeriod.startedAt),
					lt(employeeEmploymentPeriod.startedAt, window.end),
				),
				or(
					isNull(employeeEmploymentPeriod.endedAt),
					gt(employeeEmploymentPeriod.endedAt, window.start),
				),
			),
		)
		.orderBy(employeeEmploymentPeriod.employeeId, employeeEmploymentPeriod.startedAt);
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		startedAt:
			row.startProvenance === "recorded" && row.startedAt ? instantFromDate(row.startedAt) : null,
		endedAt: row.endedAt ? instantFromDate(row.endedAt) : null,
	}));
}

/**
 * Prices the given contractors' completed work inside their contractor
 * engagements on the local days of the range, with each engagement's terms in
 * force on each day. Work as an employee (before or after a conversion) is
 * neither priced nor reported as unpriced. The one entry point for Billable
 * Time margin and Contractor Statements; it never writes.
 */
export async function priceContractorDays(
	reader: Reader,
	organizationId: string,
	range: ContractorDayRange,
): Promise<ContractorPricing> {
	const [work, engagements, terms] = await Promise.all([
		loadContractorWork(reader, organizationId, range),
		loadContractorEngagements(reader, organizationId, range),
		listContractorTermsForPricing(reader, organizationId, range),
	]);
	return priceContractorWork({
		work,
		engagements,
		terms,
		range: { fromDay: range.fromDay, toDay: range.toDay },
	});
}
