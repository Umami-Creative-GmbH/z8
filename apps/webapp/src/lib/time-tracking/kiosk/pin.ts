/**
 * Kiosk PIN rules (#857): 4 to 6 digits, and the per-employee lockout.
 * Shared with client code (the PIN fields), so no server-only imports.
 */

/** Consecutive failed verifications, across all kiosks, that lock the employee. */
export const KIOSK_PIN_MAX_FAILED_ATTEMPTS = 5;

/** How long a lockout lasts. */
export const KIOSK_PIN_LOCK_MINUTES = 15;

export const KIOSK_PIN_MIN_LENGTH = 4;
export const KIOSK_PIN_MAX_LENGTH = 6;

/** Length of a PIN an owner, admin or manager generates. */
export const GENERATED_KIOSK_PIN_LENGTH = 6;

const PIN_PATTERN = /^\d{4,6}$/;

/** Whether `value` is a well-formed kiosk PIN: 4 to 6 ASCII digits, nothing else. */
export function isValidKioskPin(value: unknown): value is string {
	return typeof value === "string" && PIN_PATTERN.test(value);
}
