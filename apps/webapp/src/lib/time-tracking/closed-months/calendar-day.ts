import { Temporal } from "temporal-polyfill";

/**
 * Whether a calendar day, in the timezone the calendar shows, touches one of
 * the employee's closed ranges (#762). The ranges are the instants fixed at
 * close, so after a timezone change the days at a month's edge follow the
 * close, not the calendar month.
 */
export function dayTouchesClosedRange(
	dateKey: string,
	timeZone: string,
	ranges: readonly { start: string; endExclusive: string }[],
): boolean {
	if (ranges.length === 0) return false;
	const day = Temporal.PlainDate.from(dateKey);
	const dayStart = day.toZonedDateTime(timeZone).toInstant();
	const dayEnd = day.add({ days: 1 }).toZonedDateTime(timeZone).toInstant();
	return ranges.some(
		(range) =>
			Temporal.Instant.compare(dayStart, Temporal.Instant.from(range.endExclusive)) < 0 &&
			Temporal.Instant.compare(dayEnd, Temporal.Instant.from(range.start)) > 0,
	);
}
