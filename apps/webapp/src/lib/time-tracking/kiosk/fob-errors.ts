/**
 * Why a kiosk fob registration did nothing (#1505, decision O2). Client-safe.
 * The kiosk PIN's own refusals (`wrong_pin`, `pin_locked`, `no_pin`,
 * `rate_limited`) come beside these, exactly as for clocking.
 *
 * - `fob_reader_disabled`: the kiosk's NFC fob reader switch is off.
 * - `invalid_serial`: the input is no 4, 7 or 10-byte hex serial number.
 * - `employee_not_eligible`: the employee is not active and assigned to the
 *   kiosk's location (or has no open employment).
 * - `fob_linked_to_other_employee`: the serial number is linked to another
 *   employee of the organization; it names nobody and moves nothing.
 */
export type KioskFobRefusalCode =
	| "fob_reader_disabled"
	| "invalid_serial"
	| "employee_not_eligible"
	| "fob_linked_to_other_employee";

export class KioskFobRefusal extends Error {
	constructor(
		readonly code: KioskFobRefusalCode,
		message: string,
	) {
		super(message);
		this.name = "KioskFobRefusal";
	}
}

/**
 * Why viewing or removing a fob in settings was refused (#1508): by an owner,
 * admin or direct manager on the employee page, or by the employee themselves
 * on their security page. The client translates the code; the English message
 * is a diagnostic for logs only and never carries the serial number.
 */
export type KioskFobManagementErrorCode =
	| "sign_in_required"
	| "not_allowed"
	/** Not an employee of this organization (for oneself: no profile here, or no access). */
	| "employee_not_found"
	| "no_fob"
	/** The fob the person saw was replaced or ended meanwhile; they should reload. */
	| "fob_changed"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

export class KioskFobManagementRefusal extends Error {
	constructor(
		readonly code: KioskFobManagementErrorCode,
		message: string,
	) {
		super(message);
		this.name = "KioskFobManagementRefusal";
	}
}

/** A fob management server action's result; a failure always carries a stable code. */
export type KioskFobActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: KioskFobManagementErrorCode };
