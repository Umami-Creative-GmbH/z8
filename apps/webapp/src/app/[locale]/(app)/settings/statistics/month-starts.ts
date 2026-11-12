import { dateFromInstant, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";

/**
 * The starts of the current and the previous calendar month at `now`, as the
 * organization counts them: midnight on the 1st in its time zone (#1592,
 * docs/refs/timekeeping.md). Database boundaries, so native `Date`s.
 */
export function monthStartsAt(
	now: Instant,
	timezone: string,
): { thisMonth: Date; lastMonth: Date } {
	const firstOfThisMonth = now.toZonedDateTimeISO(timezone).toPlainDate().with({ day: 1 });
	const startOf = (day: PlainDate) =>
		dateFromInstant(day.toZonedDateTime({ timeZone: timezone }).toInstant());
	return {
		thisMonth: startOf(firstOfThisMonth),
		lastMonth: startOf(firstOfThisMonth.subtract({ months: 1 })),
	};
}
