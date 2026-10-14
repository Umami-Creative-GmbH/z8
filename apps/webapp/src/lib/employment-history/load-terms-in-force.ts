import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { type EmployeeEmploymentHistory, employeeEmploymentHistory } from "@/db/schema";
import type { PlainDate } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	type CalendarDateRange,
	confirmedTermsSpans,
	type TermsSpan,
	termsSpansOverlapping,
	utcMidnight,
} from "./terms-in-force";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/**
 * A stored terms timestamp can stand for a calendar date up to a day away
 * from its UTC date (see `termsCalendarDate`), so rows are read with this
 * margin and the calendar decides in TypeScript.
 */
const STORED_DATE_MARGIN_DAYS = 2;

/**
 * The employee's confirmed terms overlapping `range`, in date order, read for
 * one organization. Spans are not clipped to the range, so wage boundaries at
 * its edges are never invented; use `clipTermsSpans` for per-day work.
 * `timezone` defaults to the organization's.
 */
export async function loadConfirmedTermsSpans(
	reader: Reader,
	input: {
		organizationId: string;
		employeeId: string;
		range: CalendarDateRange;
		timezone?: string;
	},
): Promise<TermsSpan<EmployeeEmploymentHistory>[]> {
	const timezone = input.timezone ?? (await loadOrganizationTimezone(reader, input.organizationId));
	const rows = await reader
		.select()
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				eq(employeeEmploymentHistory.employeeId, input.employeeId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lt(
					employeeEmploymentHistory.validFrom,
					utcMidnight(input.range.toExclusive.add({ days: STORED_DATE_MARGIN_DAYS })),
				),
				or(
					isNull(employeeEmploymentHistory.validUntil),
					gt(
						employeeEmploymentHistory.validUntil,
						utcMidnight(input.range.from.subtract({ days: STORED_DATE_MARGIN_DAYS })),
					),
				),
			),
		)
		.orderBy(asc(employeeEmploymentHistory.validFrom), asc(employeeEmploymentHistory.createdAt));

	return termsSpansOverlapping(confirmedTermsSpans(rows, timezone), input.range);
}

/** The employee's confirmed terms in force on `date`, read for one organization. */
export async function loadTermsInForceOn(
	reader: Reader,
	input: { organizationId: string; employeeId: string; date: PlainDate; timezone?: string },
): Promise<EmployeeEmploymentHistory | null> {
	const [span] = await loadConfirmedTermsSpans(reader, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		range: { from: input.date, toExclusive: input.date.add({ days: 1 }) },
		timezone: input.timezone,
	});
	return span?.terms ?? null;
}
