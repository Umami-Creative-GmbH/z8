/**
 * Who decides a shift request (swap or pickup): any manager or admin on the roster at the
 * instant, except the requester (ADR-0004). One rule for the decision check
 * (`ShiftRequestService`), the pending shift request list and the approval route preview, so the
 * preview's deciders are exactly the employees the decision check admits.
 */

/** The employee roles that may decide shift requests. */
export const SHIFT_REQUEST_DECIDER_ROLES = ["manager", "admin"] as const;
const deciderRoles: ReadonlySet<string> = new Set(SHIFT_REQUEST_DECIDER_ROLES);

/** Whether an employee on the roster may decide shift requests (other than their own). */
export function isShiftRequestDecider(employee: { role: string }): boolean {
	return deciderRoles.has(employee.role);
}

/** Whether an employee on the roster may decide this request: a decider who did not request it. */
export function mayDecideShiftRequest(
	employee: { id: string; role: string },
	request: { requesterId: string },
): boolean {
	return isShiftRequestDecider(employee) && employee.id !== request.requesterId;
}

/** The ids of the roster's employees who may decide a request of `requesterId`, in roster order. */
export function shiftRequestDeciders(
	roster: ReadonlyArray<{ id: string; role: string }>,
	requesterId: string,
): string[] {
	return roster.filter((row) => mayDecideShiftRequest(row, { requesterId })).map((row) => row.id);
}

/**
 * Whether the requester is the roster's only decider, so nobody else can decide their request
 * and it is approved on submission (ADR-0004).
 */
export function isOnlyShiftRequestDecider(
	roster: ReadonlyArray<{ id: string; role: string }>,
	requesterId: string,
): boolean {
	return (
		roster.some((row) => row.id === requesterId && isShiftRequestDecider(row)) &&
		shiftRequestDeciders(roster, requesterId).length === 0
	);
}
