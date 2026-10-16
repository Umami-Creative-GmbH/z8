/**
 * The kiosk PIN lockout as a rule judged at any instant (#857, #1288, ADR 0011).
 *
 * Replayed from the employee's stored PIN events in the order they happened:
 * five consecutive failures, across all kiosks, lock the employee for 15
 * minutes from the fifth and start the count again. A correct PIN, an unlock,
 * a reset or an own PIN change starts the count again; an unlock, reset or own
 * change also ends a lock. Attempts inside a lock are neither checked nor
 * counted. Failures have no time limit between them, so a lock can only start
 * at a fifth failure: failures that arrive late (offline kiosk clocking) can
 * create a lock in the past, never one starting now.
 *
 * Pure: no database, no clock, no server-only imports.
 */

import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import { KIOSK_PIN_LOCK_MINUTES, KIOSK_PIN_MAX_FAILED_ATTEMPTS } from "./pin";

/**
 * One stored PIN event: an attempt that was checked (`failure`, `success`) or
 * an unlock, reset or own PIN change (`cleared`), at the instant it happened.
 */
export type KioskPinLockoutEvent = {
	kind: "failure" | "success" | "cleared";
	at: Instant;
};

export type KioskPinLockout = {
	/** Set only while the employee is locked out at the instant judged. */
	lockedUntil: Instant | null;
	/** Consecutive failures counting towards the next lock. */
	failures: number;
};

/**
 * How the lockout stood at `at`, from `events` in the order they happened
 * (instant, then recording order for equal instants). Events after `at` are
 * ignored. A lock covers [fifth failure, fifth failure + 15 minutes).
 */
export function kioskPinLockoutAt(
	events: readonly KioskPinLockoutEvent[],
	at: Instant,
): KioskPinLockout {
	let failures = 0;
	let lockedUntil: Instant | null = null;
	for (const event of events) {
		if (compareInstants(event.at, at) > 0) continue;
		if (lockedUntil && compareInstants(event.at, lockedUntil) >= 0) lockedUntil = null;
		if (event.kind === "cleared") {
			failures = 0;
			lockedUntil = null;
			continue;
		}
		if (lockedUntil) continue;
		if (event.kind === "success") {
			failures = 0;
			continue;
		}
		failures += 1;
		if (failures >= KIOSK_PIN_MAX_FAILED_ATTEMPTS) {
			lockedUntil = event.at.add({ minutes: KIOSK_PIN_LOCK_MINUTES });
			failures = 0;
		}
	}
	return {
		lockedUntil: lockedUntil && compareInstants(lockedUntil, at) > 0 ? lockedUntil : null,
		failures,
	};
}
