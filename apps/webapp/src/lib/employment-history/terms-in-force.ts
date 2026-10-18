import {
	comparePlainDates,
	dateFromInstant,
	earlierPlainDate,
	instantFromDate,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/**
 * Which confirmed employment terms are in force on a calendar day.
 *
 * Terms dates are calendar dates, and each day belongs to exactly one set of
 * terms or to none. Draft and pending terms never count. This module is the
 * pure core; `load-terms-in-force.ts` reads the rows for one organization.
 */

export type TermsReviewState = "draft" | "pending" | "confirmed";

/** The columns of a terms row the calendar depends on. */
export type TermsDatesRow = {
	validFrom: Date;
	validUntil: Date | null;
	reviewState: TermsReviewState;
};

/** Confirmed terms in force over the calendar dates `[from, until)`; a null `until` is open-ended. */
export type TermsSpan<T> = {
	terms: T;
	from: PlainDate;
	until: PlainDate | null;
};

/** A calendar date range `[from, toExclusive)`. */
export type CalendarDateRange = {
	from: PlainDate;
	toExclusive: PlainDate;
};

/**
 * The calendar date a stored terms timestamp stands for.
 *
 * Forms store a calendar date as UTC midnight of that date, so a timestamp at
 * exactly 00:00:00.000 UTC is that UTC date. Any other timestamp is an instant
 * (a departure cutoff at org-local midnight, or rehire terms that migration
 * 0277 had to skip) and means its org-local calendar date.
 */
export function termsCalendarDate(stored: Date, timezone: string): PlainDate {
	const instant = instantFromDate(stored);
	const utc = instant.toZonedDateTimeISO("UTC");
	const isUtcMidnight =
		utc.hour === 0 &&
		utc.minute === 0 &&
		utc.second === 0 &&
		utc.millisecond === 0 &&
		utc.microsecond === 0 &&
		utc.nanosecond === 0;
	return isUtcMidnight ? utc.toPlainDate() : plainDateAt(instant, timezone);
}

function isBefore(left: PlainDate, right: PlainDate | null): boolean {
	return right === null || comparePlainDates(left, right) < 0;
}

/** A terms calendar date as stored: UTC midnight of that date (D1). */
export function utcMidnight(date: PlainDate): Date {
	return dateFromInstant(date.toZonedDateTime({ timeZone: "UTC" }).toInstant());
}

/** The earlier of two exclusive ends, where null is open-ended. */
function earlierUntil(left: PlainDate | null, right: PlainDate | null): PlainDate | null {
	if (left === null) return right;
	if (right === null) return left;
	return earlierPlainDate(left, right);
}

/**
 * The confirmed terms as non-overlapping calendar spans, in date order.
 *
 * Where confirmed terms overlap, the later-starting terms win from their first
 * day; between terms starting on the same day, the later row in `rows` wins.
 * Terms whose span is empty are dropped.
 */
export function confirmedTermsSpans<T extends TermsDatesRow>(
	rows: readonly T[],
	timezone: string,
): TermsSpan<T>[] {
	const dated = rows
		.filter((row) => row.reviewState === "confirmed")
		.map((row, index) => ({
			index,
			span: {
				terms: row,
				from: termsCalendarDate(row.validFrom, timezone),
				until: row.validUntil ? termsCalendarDate(row.validUntil, timezone) : null,
			} satisfies TermsSpan<T>,
		}))
		.sort(
			(left, right) =>
				comparePlainDates(left.span.from, right.span.from) || left.index - right.index,
		)
		.map(({ span }) => span);

	return dated.flatMap((span, index) => {
		const next = dated[index + 1];
		const until = earlierUntil(span.until, next ? next.from : null);
		return isBefore(span.from, until) ? [{ ...span, until }] : [];
	});
}

/** The confirmed terms in force on `date`, or null. */
export function termsInForceOn<T extends TermsDatesRow>(
	rows: readonly T[],
	date: PlainDate,
	timezone: string,
): T | null {
	const span = confirmedTermsSpans(rows, timezone).find(
		(candidate) => comparePlainDates(candidate.from, date) <= 0 && isBefore(date, candidate.until),
	);
	return span?.terms ?? null;
}

/** The confirmed terms in force during `range`, each span clipped to it. */
export function termsInForceDuring<T extends TermsDatesRow>(
	rows: readonly T[],
	range: CalendarDateRange,
	timezone: string,
): TermsSpan<T>[] {
	return clipTermsSpans(confirmedTermsSpans(rows, timezone), range);
}

/** The spans with at least one day in `range`, unclipped. */
export function termsSpansOverlapping<T>(
	spans: readonly TermsSpan<T>[],
	range: CalendarDateRange,
): TermsSpan<T>[] {
	return spans.filter(
		(span) =>
			comparePlainDates(span.from, range.toExclusive) < 0 && isBefore(range.from, span.until),
	);
}

/** Clips spans to `range`, dropping those outside it. */
export function clipTermsSpans<T>(
	spans: readonly TermsSpan<T>[],
	range: CalendarDateRange,
): TermsSpan<T>[] {
	return spans.flatMap((span) => {
		const from = comparePlainDates(span.from, range.from) >= 0 ? span.from : range.from;
		const until = earlierUntil(span.until, range.toExclusive) ?? range.toExclusive;
		return comparePlainDates(from, until) < 0 ? [{ ...span, from, until }] : [];
	});
}
