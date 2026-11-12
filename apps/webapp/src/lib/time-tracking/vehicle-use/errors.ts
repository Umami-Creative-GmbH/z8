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
	/** A new assignment names a former employee (#1438). */
	| "former_employee"
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

const VEHICLE_USE_ERROR_CODES: Record<VehicleUseErrorCode, true> = {
	admin_only: true,
	invalid_target: true,
	invalid_selection: true,
	invalid_mode: true,
	team_not_found: true,
	employee_not_found: true,
	former_employee: true,
	assignment_not_found: true,
	failed: true,
};

/** Whether a settings action's `refusal` is a vehicle use code (`refusalCodeOf`). */
export function isVehicleUseErrorCode(value: string): value is VehicleUseErrorCode {
	return Object.hasOwn(VEHICLE_USE_ERROR_CODES, value);
}
