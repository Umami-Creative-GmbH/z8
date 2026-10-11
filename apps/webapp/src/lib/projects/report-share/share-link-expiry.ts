/**
 * Report share link expiry (#806). Every link expires: 30 days after creation
 * unless the creator picks fewer or more, and never later than 90 days. A day
 * is 24 hours from the creation instant, so no time zone is involved.
 * Client-safe.
 */

import type { Temporal } from "temporal-polyfill";

export const SHARE_LINK_DEFAULT_EXPIRY_DAYS = 30;
export const SHARE_LINK_MAX_EXPIRY_DAYS = 90;

export type ShareLinkExpiry =
	| { ok: true; expiresAt: Temporal.Instant }
	| { ok: false; reason: "no_expiry" | "too_long" | "invalid" };

/**
 * When a link created at `createdAt` expires. Omitting `expiresInDays` means
 * the default; `null` or infinity asks for a permanent link, which is refused.
 */
export function shareLinkExpiry(input: {
	createdAt: Temporal.Instant;
	expiresInDays?: number | null;
}): ShareLinkExpiry {
	const days =
		input.expiresInDays === undefined ? SHARE_LINK_DEFAULT_EXPIRY_DAYS : input.expiresInDays;
	if (days === null || days === Number.POSITIVE_INFINITY) return { ok: false, reason: "no_expiry" };
	if (!Number.isInteger(days) || days < 1) return { ok: false, reason: "invalid" };
	if (days > SHARE_LINK_MAX_EXPIRY_DAYS) return { ok: false, reason: "too_long" };
	return { ok: true, expiresAt: input.createdAt.add({ hours: days * 24 }) };
}
