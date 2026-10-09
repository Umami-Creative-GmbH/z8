/**
 * How long a connector waits before retrying a request the tool answered with
 * 429: the tool's `Retry-After` seconds when it sent a usable value, else
 * `baseMs` doubled per earlier attempt. Both are capped at `maxMs`.
 */
export function rateLimitBackoffMs(
	retryAfter: string | null,
	attempt: number,
	policy: { baseMs: number; maxMs: number },
): number {
	const seconds = retryAfter === null || retryAfter.trim() === "" ? Number.NaN : Number(retryAfter);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, policy.maxMs);
	return Math.min(policy.baseMs * 2 ** attempt, policy.maxMs);
}
