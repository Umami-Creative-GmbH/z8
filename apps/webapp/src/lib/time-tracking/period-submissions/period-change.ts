import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type DayRange,
	type WorkInterval,
	workTouchesInstantRange,
} from "@/lib/time-tracking/closed-months/rules";
import { periodDaysOverlap } from "./period-overlap";

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
	const range = { start: period.rangeStart, endExclusive: period.rangeEnd };
	if ((change.work ?? []).some((interval) => workTouchesInstantRange(interval, range))) {
		return true;
	}
	return (change.days ?? []).some((days) =>
		periodDaysOverlap(period, { from: days.startDate, to: days.endDate }),
	);
}
