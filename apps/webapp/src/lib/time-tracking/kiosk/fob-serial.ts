/**
 * The serial number of a kiosk fob (#1358, Time Tracking ADR 0014): what a
 * keyboard-style NFC reader types for a 13.56 MHz chip, and how Z8 stores it.
 * Shared by the server and the kiosk client, so this file has no server-only
 * imports; the fob store is `fob-store.ts`.
 *
 * Z8 accepts only hexadecimal serial numbers of 4, 7 or 10 bytes (the chip UID
 * sizes of ISO 14443), in any case, with the reader's Enter or other surrounding
 * whitespace and `:`, `-` or space between the digits ignored. It never swaps
 * byte order and never converts: a reader set to decimal output types 10 digits
 * for a 4-byte chip (or 17 for a 7-byte one), which fit no accepted length and
 * are refused, so a misconfigured reader reads as "not recognised", never as
 * another employee's fob. The canonical form is upper-case hex without
 * separators. A kiosk badge credential (`K8B…`, `badge-credential.ts`) contains
 * letters outside hex, so the two never overlap.
 */

/** Longer input is never a serial number; it is refused before any other work. */
export const KIOSK_FOB_SERIAL_MAX_INPUT_LENGTH = 64;

/** The accepted chip UID sizes, in hex digits (4, 7 and 10 bytes). */
const SERIAL_PATTERN = /^(?:[0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/;

/**
 * The canonical form of a read or submitted fob serial number, or null when
 * the input cannot be one.
 */
export function normalizeKioskFobSerial(input: unknown): string | null {
	if (typeof input !== "string" || input.length > KIOSK_FOB_SERIAL_MAX_INPUT_LENGTH) return null;
	const serial = input
		.trim()
		.replace(/[:\- ]/g, "")
		.toUpperCase();
	return SERIAL_PATTERN.test(serial) ? serial : null;
}

/**
 * The only part of a serial number Z8 shows or notifies (decision O4): its last
 * four hex digits. The full serial number is never logged, shown or sent back to
 * a kiosk.
 */
export function kioskFobLastFour(serial: string): string {
	return serial.slice(-4);
}
