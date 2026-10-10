/**
 * Why an assigned-location action was refused (#858). The client translates
 * the code; the English message is a diagnostic for logs only. Shared by the
 * server actions and the client, so this file has no server-only imports.
 */
export type AssignedLocationErrorCode =
	| "admin_only"
	| "invalid_selection"
	| "employee_not_found"
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

/** An assigned-location server action's result; a failure always carries a stable code. */
export type AssignedLocationActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: AssignedLocationErrorCode };
