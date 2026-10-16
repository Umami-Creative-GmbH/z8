/**
 * The per-kiosk PIN attempt limit (#860): 30 PIN-carrying attempts per kiosk in
 * any 60 seconds. Z8 applies it online (`rateLimiters.kioskPinAttempts`); an
 * offline kiosk applies it to itself (#1292), because its PINs are checked only
 * on arrival. Client-safe.
 */
export const KIOSK_PIN_ATTEMPT_LIMIT = { attempts: 30, windowSeconds: 60 } as const;

export type KioskPinAttemptVerdict =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

/**
 * Takes one attempt at `now` (epoch milliseconds) against the earlier ones: the
 * verdict and the attempts to keep (those inside the window, this one included
 * when allowed).
 */
export function takeKioskPinAttempt(
	earlier: readonly number[],
	now: number,
): { verdict: KioskPinAttemptVerdict; attempts: number[] } {
	const windowMs = KIOSK_PIN_ATTEMPT_LIMIT.windowSeconds * 1000;
	const recent = earlier.filter((at) => at > now - windowMs && at <= now).sort((a, b) => a - b);
	if (recent.length < KIOSK_PIN_ATTEMPT_LIMIT.attempts) {
		return { verdict: { allowed: true }, attempts: [...recent, now] };
	}
	const oldest = recent[recent.length - KIOSK_PIN_ATTEMPT_LIMIT.attempts] ?? now;
	return {
		verdict: {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
		},
		attempts: recent,
	};
}
