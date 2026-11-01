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
