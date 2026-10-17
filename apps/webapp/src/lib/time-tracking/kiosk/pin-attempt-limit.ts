import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";

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
 * Takes one attempt at `now` against the earlier ones: the verdict and the
 * attempts to keep (those inside the window, this one included when allowed).
 * An earlier attempt dated after `now` (the clock was set back) still counts,
 * as made now, so changing the clock never clears the window.
 */
export function takeKioskPinAttempt(
	earlier: readonly Instant[],
	now: Instant,
): { verdict: KioskPinAttemptVerdict; attempts: Instant[] } {
	const windowStart = now.subtract({ seconds: KIOSK_PIN_ATTEMPT_LIMIT.windowSeconds });
	const recent = earlier
		.map((at) => (compareInstants(at, now) > 0 ? now : at))
		.filter((at) => compareInstants(at, windowStart) > 0)
		.sort(compareInstants);
	if (recent.length < KIOSK_PIN_ATTEMPT_LIMIT.attempts) {
		return { verdict: { allowed: true }, attempts: [...recent, now] };
	}
	const oldest = recent[recent.length - KIOSK_PIN_ATTEMPT_LIMIT.attempts] ?? now;
	const freedAt = oldest.add({ seconds: KIOSK_PIN_ATTEMPT_LIMIT.windowSeconds });
	return {
		verdict: {
			allowed: false,
			retryAfterSeconds: Math.max(
				1,
				Math.ceil((freedAt.epochMilliseconds - now.epochMilliseconds) / 1000),
			),
		},
		attempts: recent,
	};
}
