import { Temporal } from "temporal-polyfill";
import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";

/**
 * Retention of employee documents (#870, CONTEXT.md "Retention"). Pure rules:
 *
 * - The **retention start** of a document is the end of the later of two
 *   calendar years: the year the employee's last employment period ended and
 *   the year of the document date. It is the first day of the following year.
 * - While the employee has an open employment period (also after a rehire),
 *   their documents have no retention start. Neither do they without a known
 *   employment end (no period, or a legacy period whose end was never recorded).
 * - A document is **due for deletion** once its retention start plus the
 *   category's retention period has passed. A category without a period never
 *   has due documents.
 *
 * Employment ends are instants; they are read in the organization's timezone.
 */

export interface EmploymentPeriodForRetention {
	status: "open" | "closed" | "legacy_unknown";
	/** The departure cutoff: the start of the day after the last day of employment. */
	endedAt: Instant | null;
}

export interface RetentionInput {
	periods: readonly EmploymentPeriodForRetention[];
	/** YYYY-MM-DD */
	documentDate: string;
	timezone: string;
}

const ONE_NANOSECOND = { nanoseconds: 1 } as const;

/** The calendar year of the employee's last day of employment, or null while none is known. */
export function lastEmploymentYear(
	periods: readonly EmploymentPeriodForRetention[],
	timezone: string,
): number | null {
	if (periods.length === 0) return null;
	let lastEnd: Instant | null = null;
	for (const period of periods) {
		// An open period (current or after a rehire) stops the clock; so does a
		// legacy period whose end was never recorded.
		if (period.status !== "closed" || !period.endedAt) return null;
		if (!lastEnd || Temporal.Instant.compare(period.endedAt, lastEnd) > 0) {
			lastEnd = period.endedAt;
		}
	}
	if (!lastEnd) return null;
	// The cutoff is the start of the next day: the last day is just before it.
	return lastEnd.subtract(ONE_NANOSECOND).toZonedDateTimeISO(timezone).year;
}

export function retentionStart(input: RetentionInput): PlainDate | null {
	const endYear = lastEmploymentYear(input.periods, input.timezone);
	if (endYear === null) return null;
	const documentYear = parsePlainDate(input.documentDate).year;
	return Temporal.PlainDate.from({ year: Math.max(endYear, documentYear) + 1, month: 1, day: 1 });
}

/** The day the document becomes due for deletion, or null when it never does as things stand. */
export function retentionDueDate(
	input: RetentionInput & { retentionYears: number | null },
): PlainDate | null {
	if (input.retentionYears === null) return null;
	return retentionStart(input)?.add({ years: input.retentionYears }) ?? null;
}

export function isDueForDeletion(
	input: RetentionInput & { retentionYears: number | null; today: PlainDate },
): boolean {
	const dueOn = retentionDueDate(input);
	return dueOn !== null && comparePlainDates(input.today, dueOn) >= 0;
}

export const RETENTION_YEARS_MIN = 1;
export const RETENTION_YEARS_MAX = 100;

/** Whole years between the bounds; anything else is refused. */
export function isValidRetentionYears(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= RETENTION_YEARS_MIN &&
		value <= RETENTION_YEARS_MAX
	);
}
