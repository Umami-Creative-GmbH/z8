/**
 * Why a kiosk PIN or kiosk-only employee action was refused (#857). The client
 * translates the code; the English message is a diagnostic for logs only.
 * Shared by the server actions and the client, so this file has no
 * server-only imports.
 */
export type KioskPinErrorCode =
	| "sign_in_required"
	| "not_allowed"
	| "employee_not_found"
	| "invalid_pin"
	| "pin_exists"
	| "no_pin"
	| "invalid_name"
	| "invalid_email"
	| "reserved_email"
	| "email_in_use"
	| "email_not_allowed"
	| "team_not_found"
	| "location_not_found"
	| "not_kiosk_only"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the kiosk PIN and kiosk-only employee stores. */
export class KioskPinRefusal extends Error {
	readonly code: KioskPinErrorCode;

	constructor(code: KioskPinErrorCode, message: string) {
		super(message);
		this.name = "KioskPinRefusal";
		this.code = code;
	}
}

/** A kiosk PIN server action's result; a failure always carries a stable code. */
export type KioskPinActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: KioskPinErrorCode };
