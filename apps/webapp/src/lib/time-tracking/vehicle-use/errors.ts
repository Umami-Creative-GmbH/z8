/**
 * Why a vehicle use enablement action was refused (#1119). The client
 * translates the code; the English message is a diagnostic for logs only.
 * Shared by the server actions and the client, so this file has no server-only
 * imports.
 */
export type VehicleUseErrorCode =
	| "admin_only"
	| "invalid_target"
	| "invalid_selection"
	| "invalid_mode"
	| "team_not_found"
	| "employee_not_found"
	| "assignment_not_found"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the vehicle use store and actions. */
export class VehicleUseRefusal extends Error {
	readonly code: VehicleUseErrorCode;

	constructor(code: VehicleUseErrorCode, message: string) {
		super(message);
		this.name = "VehicleUseRefusal";
		this.code = code;
	}
}

/** A vehicle use server action's result; a failure always carries a stable code. */
export type VehicleUseActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: VehicleUseErrorCode };
