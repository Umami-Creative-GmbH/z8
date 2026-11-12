/**
 * Who decides a shift request (swap or pickup): any manager or admin on the roster at the
 * instant. One rule for the decision check (`ShiftRequestService`) and the approval route
 * preview, so the preview's deciders are exactly the employees the decision check admits.
 */

/** The employee roles that may decide shift requests. */
const SHIFT_REQUEST_DECIDER_ROLES: ReadonlySet<string> = new Set(["manager", "admin"]);

/** Whether an employee on the roster may decide shift requests. */
export function isShiftRequestDecider(employee: { role: string }): boolean {
	return SHIFT_REQUEST_DECIDER_ROLES.has(employee.role);
}

/** The ids of the roster's employees who may decide shift requests, in roster order. */
export function shiftRequestDeciders(
	roster: ReadonlyArray<{ id: string; role: string }>,
): string[] {
	return roster.filter(isShiftRequestDecider).map((row) => row.id);
}
