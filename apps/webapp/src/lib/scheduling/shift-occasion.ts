import { resolveScheduledWallClock } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";

/** Work started up to this long before a shift start still belongs to that shift. */
export const SHIFT_WORK_ASSOCIATION_LEAD_MINUTES = 120;

export interface ShiftInterval {
	start: Instant;
	end: Instant;
}

export interface ShiftWallTimes {
	/** Calendar date of the shift, `YYYY-MM-DD`. */
	date: string;
	/** Wall-clock `HH:mm`. */
	startTime: string;
	/** Wall-clock `HH:mm`; at or before the start means the next day. */
	endTime: string;
}

/** Reads a shift's wall-clock times as instants in `timezone`. DST gaps move forward. */
export function shiftInterval(shift: ShiftWallTimes, timezone: string): ShiftInterval {
	const start = resolveScheduledWallClock({ date: shift.date, time: shift.startTime, timezone });
	const sameDayEnd = resolveScheduledWallClock({ date: shift.date, time: shift.endTime, timezone });
	const end =
		compareInstants(sameDayEnd.toInstant(), start.toInstant()) <= 0
			? resolveScheduledWallClock({
					date: start.toPlainDate().add({ days: 1 }).toString(),
					time: shift.endTime,
					timezone,
				})
			: sameDayEnd;
	return { start: start.toInstant(), end: end.toInstant() };
}

/**
 * Whether work belongs to a shift: it started from two hours before the shift start until the
 * shift end, and had not already ended by the shift start. Shared by the manager briefing and
 * clocking reminders.
 */
export function workMatchesShift(
	shift: ShiftInterval,
	work: { start: Instant; end: Instant | null },
): boolean {
	const associationStart = shift.start.subtract({ minutes: SHIFT_WORK_ASSOCIATION_LEAD_MINUTES });
	return (
		compareInstants(work.start, associationStart) >= 0 &&
		compareInstants(work.start, shift.end) < 0 &&
		(work.end === null || compareInstants(work.end, shift.start) > 0)
	);
}
