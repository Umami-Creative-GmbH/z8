/**
 * Why a kiosk badge management action was refused (#1364). The client
 * translates the code; the English message is a diagnostic for logs only and
 * never carries badge material. Shared by the server actions and the client,
 * so this file has no server-only imports.
 */
export type KioskBadgeErrorCode =
	| "sign_in_required"
	| "not_allowed"
	| "employee_not_found"
	/** Not an active employee now (inactive, or a departure has taken effect). */
	| "employee_inactive"
	| "badge_exists"
	| "no_badge"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the kiosk badge store. */
export class KioskBadgeRefusal extends Error {
	readonly code: KioskBadgeErrorCode;

	constructor(code: KioskBadgeErrorCode, message: string) {
		super(message);
		this.name = "KioskBadgeRefusal";
		this.code = code;
	}
}

/** A kiosk badge server action's result; a failure always carries a stable code. */
export type KioskBadgeActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: KioskBadgeErrorCode };
