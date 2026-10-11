import type { Instant } from "@/lib/datetime/temporal-core";
import {
	closedRangeTouchedByWork,
	type DayRange,
	type WorkInterval,
} from "@/lib/time-tracking/closed-months/rules";

/**
 * What a writer of work, work attribution or absences changed (#1062), in the terms closed months
 * use (Time Tracking ADR-0004): the work before and after the change as instants, and an
 * absence's local days before and after it. Notes are never a change.
 */
export interface PeriodChange {
	work?: readonly WorkInterval[];
	days?: readonly DayRange[];
}

/** A submitted period as it was fixed at submission. */
export interface SubmittedPeriodRange {
	/** First and last local day, inclusive (`YYYY-MM-DD`). */
	startDate: string;
	endDate: string;
	/** The same range as instants, `[rangeStart, rangeEnd)`. */
	rangeStart: Instant;
	rangeEnd: Instant;
}

/**
 * Whether a change touches a submitted period, even in part. Work matches by instants with the
 * closed-month rule (a moment equal to the range's start is inside it, its exclusive end is
 * not); absence days match by the period's local days.
 */
export function periodChangeTouches(change: PeriodChange, period: SubmittedPeriodRange): boolean {
	const work = change.work ?? [];
	if (
		work.length > 0 &&
		closedRangeTouchedByWork(work, [
			{
				month: period.startDate.slice(0, 7),
				start: period.rangeStart,
				endExclusive: period.rangeEnd,
			},
		])
	) {
		return true;
	}
	return (change.days ?? []).some(
		(days) => days.startDate <= period.endDate && days.endDate >= period.startDate,
	);
}
