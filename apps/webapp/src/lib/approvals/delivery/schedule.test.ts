import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { APPROVAL_DELIVERY_RETRY_INTERVALS, nextApprovalDeliveryAttempt } from "./schedule";

const attemptedAt = Temporal.Instant.from("2026-09-25T10:00:00Z");

describe("approval delivery retry schedule", () => {
	it("is 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours", () => {
		expect(APPROVAL_DELIVERY_RETRY_INTERVALS.map((interval) => interval.total("minutes"))).toEqual([
			1, 5, 30, 120, 720,
		]);
	});

	it.each([
		[0, "2026-09-25T10:01:00Z"],
		[1, "2026-09-25T10:05:00Z"],
		[2, "2026-09-25T10:30:00Z"],
		[3, "2026-09-25T12:00:00Z"],
		[4, "2026-09-25T22:00:00Z"],
	])("retry %i waits from the preceding attempt", (retriesSoFar, expected) => {
		expect(nextApprovalDeliveryAttempt({ retriesSoFar, attemptedAt })).toEqual({
			kind: "retry",
			retryCount: retriesSoFar + 1,
			availableAt: Temporal.Instant.from(expected),
		});
	});

	it("exhausts after the fifth retry has failed", () => {
		expect(nextApprovalDeliveryAttempt({ retriesSoFar: 5, attemptedAt })).toEqual({
			kind: "exhausted",
		});
	});

	it("refuses a negative or fractional retry count", () => {
		expect(() => nextApprovalDeliveryAttempt({ retriesSoFar: -1, attemptedAt })).toThrow();
		expect(() => nextApprovalDeliveryAttempt({ retriesSoFar: 1.5, attemptedAt })).toThrow();
	});
});
