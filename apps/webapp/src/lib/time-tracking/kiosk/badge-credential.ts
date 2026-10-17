/**
 * The format of a kiosk badge credential (#889, ADR 0012): what its QR code
 * holds and what a kiosk may submit. Shared by the server and the kiosk client,
 * so this file has no server-only imports; generating and hashing a credential
 * is the badge store's (`badge-store.ts`).
 *
 * A credential is `K8B` followed by 53 random characters from a 30-character
 * alphabet (digits and upper-case letters without I, L, O, U, Y and Z), about
 * 260 bits. The alphabet suits keyboard-style scanners: case is ignored (caps
 * lock), Y and Z are left out (QWERTY and QWERTZ layouts swap them) and there
 * is no punctuation, whose keys differ between layouts. Upper-case letters and
 * digits also use the QR code's compact alphanumeric mode.
 */

export const KIOSK_BADGE_CREDENTIAL_PREFIX = "K8B";
export const KIOSK_BADGE_CREDENTIAL_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWX";
export const KIOSK_BADGE_RANDOM_LENGTH = 53;
export const KIOSK_BADGE_CREDENTIAL_LENGTH =
	KIOSK_BADGE_CREDENTIAL_PREFIX.length + KIOSK_BADGE_RANDOM_LENGTH;

const CREDENTIAL_PATTERN = new RegExp(
	`^${KIOSK_BADGE_CREDENTIAL_PREFIX}[${KIOSK_BADGE_CREDENTIAL_ALPHABET}]{${KIOSK_BADGE_RANDOM_LENGTH}}$`,
);

/** Longer input is never a credential; it is refused before any other work. */
const MAX_INPUT_LENGTH = 256;

/**
 * The canonical form of a scanned or submitted badge credential, or null when
 * the input cannot be one. Surrounding whitespace (a scanner's Enter) and case
 * are ignored; nothing else is corrected.
 */
export function normalizeKioskBadgeCredential(input: unknown): string | null {
	if (typeof input !== "string" || input.length > MAX_INPUT_LENGTH) return null;
	const credential = input.trim().toUpperCase();
	return CREDENTIAL_PATTERN.test(credential) ? credential : null;
}
