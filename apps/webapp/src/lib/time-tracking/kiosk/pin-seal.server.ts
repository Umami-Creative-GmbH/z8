import "server-only";

import { createDecipheriv, createECDH, createHash, hkdfSync } from "node:crypto";
import type { SealedKioskPin } from "./frozen-command";
import {
	KIOSK_PIN_SEALING_ALGORITHM,
	KIOSK_PIN_SEALING_INFO,
	type KioskPinSealBinding,
	type KioskSealingKey,
	kioskPinSealAad,
	toBase64url,
} from "./pin-seal";

/**
 * Z8's side of sealed kiosk PINs (#1289, ADR 0011): the sealing key pair and
 * opening a sealed PIN, in memory only, for the one check on arrival. The key
 * pair is derived from the server secret (as `credential-secret.ts` derives its
 * key), so nothing is stored and no new secret is needed; changing the secret
 * changes the key, and PINs sealed under the old one no longer open.
 */

const KEY_DERIVATION_INFO = `${KIOSK_PIN_SEALING_INFO}/key`;
/** The order of P-256: a private scalar lies in [1, n − 1]. */
const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

type SealingKeyPair = { ecdh: ReturnType<typeof createECDH>; publicKey: KioskSealingKey };

const keyPairs = new Map<string, SealingKeyPair>();

function deriveKeyPair(secret: string): SealingKeyPair {
	const cached = keyPairs.get(secret);
	if (cached) return cached;
	if (secret.length < 32) throw new Error("The kiosk PIN sealing secret is too short");
	for (let counter = 0; ; counter += 1) {
		const scalar = Buffer.from(
			hkdfSync(
				"sha256",
				Buffer.from(secret, "utf8"),
				Buffer.alloc(0),
				Buffer.from(`${KEY_DERIVATION_INFO}/${counter}`, "utf8"),
				32,
			),
		);
		const value = BigInt(`0x${scalar.toString("hex")}`);
		if (value === BigInt(0) || value >= P256_ORDER) continue;
		const ecdh = createECDH("prime256v1");
		ecdh.setPrivateKey(scalar);
		const raw = ecdh.getPublicKey();
		const publicKey: KioskSealingKey = {
			kid: toBase64url(createHash("sha256").update(raw).digest().subarray(0, 16)),
			alg: KIOSK_PIN_SEALING_ALGORITHM,
			jwk: {
				kty: "EC",
				crv: "P-256",
				x: toBase64url(raw.subarray(1, 33)),
				y: toBase64url(raw.subarray(33, 65)),
			},
		};
		const pair = { ecdh, publicKey };
		keyPairs.set(secret, pair);
		return pair;
	}
}

/** The public sealing key the kiosk session publishes. */
export function kioskSealingKey(secret: string): KioskSealingKey {
	return deriveKeyPair(secret).publicKey;
}

function fromBase64url(value: string): Buffer {
	return Buffer.from(value, "base64url");
}

/**
 * The PIN a kiosk sealed for this kiosk, employee and operation, or null when it
 * cannot be opened (another key, binding or tampered bytes). The PIN is never
 * logged or stored.
 */
export function openSealedKioskPin(
	sealed: SealedKioskPin,
	binding: KioskPinSealBinding,
	secret: string,
): string | null {
	const { ecdh, publicKey } = deriveKeyPair(secret);
	if (sealed.v !== 1 || sealed.kid !== publicKey.kid) return null;
	try {
		const epk = fromBase64url(sealed.epk);
		const iv = fromBase64url(sealed.iv);
		const sealedBytes = fromBase64url(sealed.ct);
		if (epk.length !== 65 || iv.length !== 12 || sealedBytes.length <= 16) return null;
		const shared = ecdh.computeSecret(epk);
		const key = Buffer.from(
			hkdfSync("sha256", shared, epk, Buffer.from(KIOSK_PIN_SEALING_INFO, "utf8"), 32),
		);
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAAD(Buffer.from(kioskPinSealAad(binding), "utf8"));
		decipher.setAuthTag(sealedBytes.subarray(sealedBytes.length - 16));
		return Buffer.concat([
			decipher.update(sealedBytes.subarray(0, sealedBytes.length - 16)),
			decipher.final(),
		]).toString("utf8");
	} catch {
		return null;
	}
}

/** A sealed PIN that cannot be opened for its command; nothing about it is stored. */
export class KioskPinUnsealableError extends Error {
	constructor() {
		super("The sealed kiosk PIN cannot be opened");
		this.name = "KioskPinUnsealableError";
	}
}
