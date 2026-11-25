import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import { shiftCalendarDate } from "./shift-date";
import { shiftInterval } from "./shift-occasion";

/**
 * A material assignment change is one an assigned employee must be told about again: a new
 * assignee, day, start or end. Notes, colour, template or subarea changes are not. The instant of
 * the last one is `shift.assignment_changed_at`; with `published_at` it is when an on-call
 * employee learns of a call-in (§ 12 Abs. 3 TzBfG, #1992).
 */
export interface ShiftAssignment {
	readonly employeeId: string | null;
	readonly date: Date;
	readonly startTime: string;
	readonly endTime: string;
}

export function isMaterialShiftAssignmentChange(
	before: ShiftAssignment | null | undefined,
	after: ShiftAssignment,
): boolean {
	if (!before) return true;
	return (
		before.employeeId !== after.employeeId ||
		before.date.getTime() !== after.date.getTime() ||
		before.startTime !== after.startTime ||
		before.endTime !== after.endTime
	);
}

/**
 * Whether an edit is a new call-in whose notification instant is `now`: a new assignee at any
 * time (the employee taking over learns of the call now), or a material change to a shift that
 * has not started yet. Correcting the times of a shift once it has started (its recorded end, say)
 * announces nothing, so the notification instant of the call stays as it was. A new assignee
 * stamped after the shift has ended is a record of who worked it, not a call-in: the on-call
 * monitor judges notice only for an announcement made before the shift's end.
 */
export function isNewShiftCallIn(
	before: ShiftAssignment | null | undefined,
	after: ShiftAssignment,
	input: { readonly timezone: string; readonly now: Instant },
): boolean {
	if (!isMaterialShiftAssignmentChange(before, after)) return false;
	if (before && before.employeeId !== after.employeeId) return true;
	const { start } = shiftInterval(
		{
			date: shiftCalendarDate(after.date, input.timezone),
			startTime: after.startTime,
			endTime: after.endTime,
		},
		input.timezone,
	);
	return compareInstants(start, input.now) > 0;
}
