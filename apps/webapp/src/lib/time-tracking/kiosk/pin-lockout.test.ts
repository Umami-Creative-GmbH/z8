/**
 * #1288: the kiosk PIN lockout replayed in the order attempts happened. Five
 * consecutive failures lock the employee for 15 minutes from the fifth; a
 * correct PIN, an unlock, a reset or an own change starts the count again;
 * attempts inside a lock are neither checked nor counted.
 */

import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type KioskPinLockoutEvent, kioskPinLockoutAt } from "./pin-lockout";

const at = (minute: number, second = 0) =>
	parseInstant(
		`2026-03-02T08:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`,
	);
const failure = (minute: number, second = 0): KioskPinLockoutEvent => ({
	kind: "failure",
	at: at(minute, second),
});
const success = (minute: number): KioskPinLockoutEvent => ({ kind: "success", at: at(minute) });
const cleared = (minute: number): KioskPinLockoutEvent => ({ kind: "cleared", at: at(minute) });

const lockedUntilAt = (events: KioskPinLockoutEvent[], minute: number, second = 0) =>
	kioskPinLockoutAt(events, at(minute, second)).lockedUntil?.toString() ?? null;

describe("kioskPinLockoutAt", () => {
	const fiveFailures = [failure(0), failure(1), failure(2), failure(3), failure(4)];

	it("is not locked without five consecutive failures", () => {
		expect(kioskPinLockoutAt([], at(0))).toEqual({ lockedUntil: null, failures: 0 });
		expect(kioskPinLockoutAt(fiveFailures.slice(0, 4), at(5))).toEqual({
			lockedUntil: null,
			failures: 4,
		});
	});

	it("locks for 15 minutes from the fifth failure, that instant included", () => {
		expect(lockedUntilAt(fiveFailures, 4)).toBe("2026-03-02T08:19:00Z");
		expect(lockedUntilAt(fiveFailures, 18, 59)).toBe("2026-03-02T08:19:00Z");
		expect(lockedUntilAt(fiveFailures, 19)).toBeNull();
		expect(kioskPinLockoutAt(fiveFailures, at(19)).failures).toBe(0);
	});

	it("judges each instant only by what had happened by then", () => {
		expect(lockedUntilAt(fiveFailures, 3, 59)).toBeNull();
		expect(kioskPinLockoutAt(fiveFailures, at(3, 59)).failures).toBe(4);
	});

	it("starts the count again after a correct PIN, an unlock, a reset or an own change", () => {
		expect(
			kioskPinLockoutAt([failure(0), failure(1), success(2), failure(3)], at(4)).failures,
		).toBe(1);
		expect(
			lockedUntilAt([failure(0), failure(1), failure(2), cleared(3), failure(4), failure(5)], 6),
		).toBeNull();
	});

	it("ends a lock early when it is cleared, but not before the clearing", () => {
		const events = [...fiveFailures, cleared(10)];
		expect(lockedUntilAt(events, 9)).toBe("2026-03-02T08:19:00Z");
		expect(lockedUntilAt(events, 10)).toBeNull();
	});

	it("neither checks nor counts attempts inside a lock", () => {
		const events = [...fiveFailures, success(6), failure(7), failure(8), failure(9), failure(10)];
		expect(lockedUntilAt(events, 12)).toBe("2026-03-02T08:19:00Z");
		expect(kioskPinLockoutAt(events, at(20))).toEqual({ lockedUntil: null, failures: 0 });
	});

	it("never lets old failures lock now: a past lock has expired", () => {
		expect(lockedUntilAt(fiveFailures, 59)).toBeNull();
	});

	it("counts failures with no time limit between them", () => {
		const spread = [failure(0), failure(10), failure(20), failure(30), failure(40)];
		expect(lockedUntilAt(spread, 41)).toBe("2026-03-02T08:55:00Z");
	});
});
