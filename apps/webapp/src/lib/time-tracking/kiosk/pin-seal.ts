/**
 * Sealing a kiosk PIN so that only Z8 can read it (#1289, ADR 0011). Client-safe:
 * the kiosk page seals with WebCrypto; Z8 opens in `pin-seal.server.ts`. The
 * kiosk keeps the sealed PIN with its queued command and nothing that can check
 * a PIN.
 *
 * Recipe (ECIES over P-256), every byte string base64url without padding:
 * 1. Import the session's `offline.sealingKey.jwk` as an ECDH P-256 public key.
 * 2. Generate an ephemeral ECDH P-256 key pair; `deriveBits` 256 bits with the
 *    server key (the shared x-coordinate).
 * 3. HKDF-SHA256 over the shared bits, salt = the ephemeral public key raw
 *    (uncompressed, 65 bytes), info = `KIOSK_PIN_SEALING_INFO`, to a 256-bit
 *    AES-GCM key.
 * 4. AES-GCM with a random 12-byte nonce over the PIN's UTF-8 digits, additional
 *    data = `kioskPinSealAad(binding)`: the kiosk, employee and operation, so a
 *    sealed PIN opens for no other command.
 * 5. Send `{ v: 1, kid, epk, iv, ct }` (`ct` includes the 16-byte tag).
 */
import type { SealedKioskPin } from "./frozen-command";

export const KIOSK_PIN_SEALING_ALGORITHM = "ECDH-P256+HKDF-SHA256+A256GCM";
export const KIOSK_PIN_SEALING_INFO = "z8/kiosk/pin-sealing/v1";

/** Z8's public sealing key, as the kiosk session publishes it. */
export type KioskSealingKey = {
	/** Identifies the key pair; a sealed PIN names it. */
	kid: string;
	alg: typeof KIOSK_PIN_SEALING_ALGORITHM;
	jwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
};

/** What a sealed PIN is bound to. */
export type KioskPinSealBinding = { kioskId: string; employeeId: string; operationId: string };

/** The additional authenticated data of a sealed PIN. */
export function kioskPinSealAad(binding: KioskPinSealBinding): string {
	return [KIOSK_PIN_SEALING_INFO, binding.kioskId, binding.employeeId, binding.operationId].join(
		"\n",
	);
}

export function toBase64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** Seals a PIN for one queued command with WebCrypto (`subtle` defaults to the global one). */
export async function sealKioskPin(
	pin: string,
	input: KioskPinSealBinding & { sealingKey: KioskSealingKey },
	subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<SealedKioskPin> {
	const curve = { name: "ECDH", namedCurve: "P-256" } as const;
	const [serverKey, ephemeral] = await Promise.all([
		subtle.importKey("jwk", { ...input.sealingKey.jwk, ext: true }, curve, false, []),
		subtle.generateKey(curve, true, ["deriveBits"]),
	]);
	const shared = await subtle.deriveBits(
		{ name: "ECDH", public: serverKey },
		ephemeral.privateKey,
		256,
	);
	const epk = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));
	const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
	const key = await subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: epk, info: utf8(KIOSK_PIN_SEALING_INFO) },
		hkdf,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt"],
	);
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: utf8(kioskPinSealAad(input)) },
			key,
			utf8(pin),
		),
	);
	return {
		v: 1,
		kid: input.sealingKey.kid,
		epk: toBase64url(epk),
		iv: toBase64url(iv),
		ct: toBase64url(ct),
	};
}
