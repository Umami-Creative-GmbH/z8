import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { type Instant, instantToCanonicalString, parseInstant } from "@/lib/datetime/temporal-core";
import type { KioskContactAnchor } from "./frozen-command";

/**
 * Signed contact anchors (#1289): Z8's time at a kiosk's contact, signed for
 * that kiosk and its device token with a key derived from the server secret.
 * `kiosk.last_seen_at` moves at every request, so it cannot bound a queued
 * command's instant; the anchor the command carries back can. An anchor signed
 * for a token the kiosk no longer has tells a rotation apart.
 */

const CONTACT_ANCHOR_INFO = "z8/kiosk/contact-anchor/v1";

export type KioskContactSubject = { organizationId: string; kioskId: string; tokenHash: string };

const keys = new Map<string, Buffer>();

function anchorKey(secret: string): Buffer {
	const cached = keys.get(secret);
	if (cached) return cached;
	if (secret.length < 32) throw new Error("The kiosk contact anchor secret is too short");
	const key = Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(secret, "utf8"),
			Buffer.alloc(0),
			Buffer.from(CONTACT_ANCHOR_INFO, "utf8"),
			32,
		),
	);
	keys.set(secret, key);
	return key;
}

function mac(subject: KioskContactSubject, serverTime: string, secret: string): Buffer {
	return createHmac("sha256", anchorKey(secret))
		.update(
			[
				CONTACT_ANCHOR_INFO,
				subject.organizationId,
				subject.kioskId,
				subject.tokenHash,
				serverTime,
			].join("\n"),
		)
		.digest();
}

/** The anchor of a contact at `at`, for the kiosk session to hand the device. */
export function signKioskContact(
	subject: KioskContactSubject,
	at: Instant,
	secret: string,
): KioskContactAnchor {
	const serverTime = instantToCanonicalString(at);
	return { serverTime, proof: mac(subject, serverTime, secret).toString("base64url") };
}

/** The contact's instant when Z8 signed this anchor for the kiosk and token, else null. */
export function verifyKioskContact(
	anchor: KioskContactAnchor,
	subject: KioskContactSubject,
	secret: string,
): Instant | null {
	const expected = mac(subject, anchor.serverTime, secret);
	const given = Buffer.from(anchor.proof, "base64url");
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		return parseInstant(anchor.serverTime);
	} catch {
		return null;
	}
}
