import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

/**
 * Transient delivery, refresh and retirement failures retry after these
 * intervals, each measured from the preceding attempt (#257 §9, #264 §3).
 */
export const APPROVAL_DELIVERY_RETRY_INTERVALS: readonly Temporal.Duration[] = Object.freeze([
	Temporal.Duration.from({ minutes: 1 }),
	Temporal.Duration.from({ minutes: 5 }),
	Temporal.Duration.from({ minutes: 30 }),
	Temporal.Duration.from({ hours: 2 }),
	Temporal.Duration.from({ hours: 12 }),
]);

export type ApprovalDeliveryNextAttempt =
	| { kind: "retry"; retryCount: number; availableAt: Instant }
	| { kind: "exhausted" };

/**
 * After a transient failure: when the next attempt may run, or exhaustion
 * once every scheduled retry has failed. Exhaustion is a visible condition
 * that only explicit recovery re-arms.
 */
export function nextApprovalDeliveryAttempt(input: {
	retriesSoFar: number;
	attemptedAt: Instant;
}): ApprovalDeliveryNextAttempt {
	if (!Number.isSafeInteger(input.retriesSoFar) || input.retriesSoFar < 0) {
		throw new Error("Approval delivery retry count is invalid");
	}
	const interval = APPROVAL_DELIVERY_RETRY_INTERVALS[input.retriesSoFar];
	if (!interval) return { kind: "exhausted" };
	return {
		kind: "retry",
		retryCount: input.retriesSoFar + 1,
		availableAt: input.attemptedAt.add(interval),
	};
}
