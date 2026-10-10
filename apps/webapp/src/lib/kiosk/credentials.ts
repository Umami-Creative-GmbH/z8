import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * Kiosk secrets (#859). A pairing code is single-use and short-lived; a device
 * token is long-lived and sent with every kiosk request. Both carry enough
 * entropy (50 and 256 bits) for a plain SHA-256 to be a safe stored form, and
 * the server never stores either in the clear.
 */

/** How long a pairing code can be exchanged for a device token. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** Crockford base32: no I, L, O or U, so a code survives being read aloud or retyped. */
const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIRING_CODE_LENGTH = 10;
const DEVICE_TOKEN_PREFIX = "z8k_";

/** A new pairing code in its canonical form (10 characters, no separator). */
export function generatePairingCode(): string {
	let code = "";
	for (let index = 0; index < PAIRING_CODE_LENGTH; index++) {
		code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
	}
	return code;
}

/** A canonical pairing code as shown to people: `ABCDE-FGHJK`. */
export function formatPairingCode(code: string): string {
	return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * The canonical form of a typed pairing code, or null when the input cannot be
 * one. Case, spaces and dashes are ignored, and the look-alikes O, I and L are
 * read as 0, 1 and 1.
 */
export function normalizePairingCode(input: unknown): string | null {
	if (typeof input !== "string") return null;
	const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
	if (code.length !== PAIRING_CODE_LENGTH) return null;
	for (const character of code) {
		if (!PAIRING_CODE_ALPHABET.includes(character)) return null;
	}
	return code;
}

/** A new device token: 32 random bytes, base64url, with a recognisable prefix. */
export function generateDeviceToken(): string {
	return `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** The stored form of a pairing code or device token. */
export function hashKioskSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}
