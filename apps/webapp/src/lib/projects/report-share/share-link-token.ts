/**
 * Report share link tokens (#806). The URL token is a bearer credential: it
 * alone opens the shared snapshot. It is shown once, when the link is created,
 * and only its digest is stored, so a database read cannot recover a URL.
 *
 * Tokens carry 256 bits of entropy, so an unsalted SHA-256 digest is enough
 * and keeps the lookup a single unique-index hit, as for ICS feeds
 * (`calendar-sync/ics-feed-secret.ts`). The matched digest is compared again
 * in constant time before the link is used.
 */

import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SHARE_TOKEN_PATTERN } from "./share-link-path";

export const SHARE_LINK_TOKEN_HASH_VERSION = "v1";

/** A new 43-character base64url token (32 random bytes). */
export function generateShareLinkToken(): string {
	return randomBytes(32).toString("base64url");
}

/** Whether a URL path segment could be a token at all. */
export function isWellFormedShareLinkToken(token: string): boolean {
	return SHARE_TOKEN_PATTERN.test(token);
}

/** Hex SHA-256 of the token. */
export function digestShareLinkToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Whether a stored digest is the token's, compared in constant time. */
export function shareLinkTokenMatches(token: string, storedDigest: string): boolean {
	const actual = Buffer.from(digestShareLinkToken(token), "hex");
	const expected = Buffer.from(storedDigest, "hex");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
