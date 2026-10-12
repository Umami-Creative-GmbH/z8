import { and, gte, lte, type SQL } from "drizzle-orm";
import { periodSubmission } from "@/db/schema";

/**
 * When a submitted period's local days share a day with other local days (#805): the one overlap
 * rule of period submissions, in SQL and in memory. Days are inclusive `YYYY-MM-DD` strings, which
 * order as the dates do.
 */

/** Whether the period's days `[startDate, endDate]` share a day with `[from, to]`. */
export function periodDaysOverlap(
	period: { startDate: string; endDate: string },
	days: { from: string; to: string },
): boolean {
	return period.startDate <= days.to && period.endDate >= days.from;
}

/** `periodDaysOverlap` as a condition on `period_submission` rows. */
export function periodSubmissionOverlaps(from: string, to: string): SQL {
	return and(lte(periodSubmission.startDate, to), gte(periodSubmission.endDate, from)) as SQL;
}
