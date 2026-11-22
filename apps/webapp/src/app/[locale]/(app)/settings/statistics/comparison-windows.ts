import { earlierInstant, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";

/** A stretch of time and the local days it touches, in the organization's time zone. */
export interface StatisticsWindow {
	start: Instant;
	end: Instant;
	/** The first local day of the window. */
	firstDay: PlainDate;
	/** The last local day the window reaches, inclusive. */
	lastDay: PlainDate;
}

/**
 * "This month" and its like-for-like comparison, as the organization counts them
 * (docs/refs/timekeeping.md): the month so far in its time zone, and the same
 * elapsed span of the previous month. When the previous month has no such day
 * (Mar 31 against February), the comparison is the whole previous month.
 */
export function comparisonWindowsAt(
	now: Instant,
	timezone: string,
): { current: StatisticsWindow; previous: StatisticsWindow } {
	const zonedNow = now.toZonedDateTimeISO(timezone);
	const firstDay = zonedNow.toPlainDate().with({ day: 1 });
	const previousFirstDay = firstDay.subtract({ months: 1 });
	const startOf = (day: PlainDate) => day.toZonedDateTime({ timeZone: timezone }).toInstant();

	const currentStart = startOf(firstDay);
	const previousStart = startOf(previousFirstDay);
	const previousHasDay = zonedNow.day <= previousFirstDay.daysInMonth;
	const previousEnd = previousHasDay
		? earlierInstant(zonedNow.subtract({ months: 1 }).toInstant(), currentStart)
		: currentStart;

	return {
		current: {
			start: currentStart,
			end: now,
			firstDay,
			lastDay: zonedNow.toPlainDate(),
		},
		previous: {
			start: previousStart,
			end: previousEnd,
			firstDay: previousFirstDay,
			lastDay: previousHasDay
				? previousFirstDay.with({ day: zonedNow.day })
				: previousFirstDay.with({ day: previousFirstDay.daysInMonth }),
		},
	};
}
