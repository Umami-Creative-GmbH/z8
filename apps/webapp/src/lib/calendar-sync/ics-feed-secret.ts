/**
 * ICS feed secrets (#991)
 *
 * A feed URL is a bearer credential: calendar clients cannot send auth headers,
 * so anyone holding the URL can read the feed. The secret is shown once, when a
 * feed is created or regenerated, and only its digest is stored.
 *
 * Secrets carry 256 bits of entropy, so an unsalted SHA-256 digest is enough and
 * keeps the lookup a single unique-index hit. Migration 0176 hashed the
 * pre-existing plain-text secrets with the same digest, so URLs that calendar
 * apps already subscribe to keep resolving.
 */

import { createHash, randomBytes } from "node:crypto";
import { getDefaultAppBaseUrl } from "@/lib/app-url";

export const ICS_FEED_SECRET_HASH_VERSION = "v1";

const SECRET_PATTERN = /^[0-9a-f]{64}$/;

/** A new 64-char hex secret. */
export function generateIcsFeedSecret(): string {
	return randomBytes(32).toString("hex");
}

/** Whether a URL path segment could be a feed secret at all. */
export function isWellFormedIcsFeedSecret(secret: string): boolean {
	return SECRET_PATTERN.test(secret);
}

/** Hex SHA-256 of the secret; matches `encode(sha256(...), 'hex')` in migration 0176. */
export function digestIcsFeedSecret(secret: string): string {
	return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function buildIcsFeedUrl(secret: string): string {
	return `${getDefaultAppBaseUrl()}/api/calendar/ics/${secret}`;
}

/** A fresh secret, its URL to show once, and the columns to store. */
export function issueIcsFeedSecret(): {
	url: string;
	secretDigest: string;
	secretHashVersion: string;
} {
	const secret = generateIcsFeedSecret();
	return {
		url: buildIcsFeedUrl(secret),
		secretDigest: digestIcsFeedSecret(secret),
		secretHashVersion: ICS_FEED_SECRET_HASH_VERSION,
	};
}
