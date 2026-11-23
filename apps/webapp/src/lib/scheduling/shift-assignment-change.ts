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
