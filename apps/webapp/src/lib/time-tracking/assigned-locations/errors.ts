/**
 * Why an assigned-location action was refused (#858). The client translates
 * the code; the English message is a diagnostic for logs only. Shared by the
 * server actions and the client, so this file has no server-only imports.
 */
export type AssignedLocationErrorCode =
	| "admin_only"
	| "invalid_selection"
	| "employee_not_found"
	/** The employee is a former employee (#1438). */
	| "former_employee"
	| "location_not_found"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the assigned-location store and actions. */
export class AssignedLocationRefusal extends Error {
	readonly code: AssignedLocationErrorCode;

	constructor(code: AssignedLocationErrorCode, message: string) {
		super(message);
		this.name = "AssignedLocationRefusal";
		this.code = code;
	}
}

const REFUSAL_CODES: ReadonlySet<string> = new Set<AssignedLocationErrorCode>([
	"invalid_selection",
	"employee_not_found",
	"former_employee",
	"location_not_found",
]);

/**
 * The refusal code of a failed assigned-location action (a `ServerActionResult`
 * failure): a store refusal travels as `refusal`, missing settings access as
 * `AuthorizationError`, invalid input as a `ValidationError` without one.
 */
export function assignedLocationErrorCodeOf(failure: {
	code?: string;
	refusal?: string;
}): AssignedLocationErrorCode {
	if (failure.refusal && REFUSAL_CODES.has(failure.refusal)) {
		return failure.refusal as AssignedLocationErrorCode;
	}
	if (failure.code === "AuthorizationError") return "admin_only";
	if (failure.code === "ValidationError") return "invalid_selection";
	return "failed";
}
