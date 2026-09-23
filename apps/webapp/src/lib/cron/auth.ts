import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

/**
 * Check an Authorization header against `Bearer <CRON_SECRET>` in constant time.
 *
 * Both sides are hashed first so the comparison runs over equal-length buffers
 * and leaks neither the secret's contents nor its length.
 */
export function isValidCronAuthorization(
	authHeader: string | null | undefined,
	cronSecret: string | undefined,
): boolean {
	if (!cronSecret || !authHeader) {
		return false;
	}

	return timingSafeEqual(digest(authHeader), digest(`Bearer ${cronSecret}`));
}
