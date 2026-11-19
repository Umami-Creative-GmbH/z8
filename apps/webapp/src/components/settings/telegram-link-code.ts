import { Temporal } from "temporal-polyfill";

/** Whole minutes until the link code expires, rounded up; 0 once it has expired. */
export function linkCodeMinutesRemaining(expiresAt: string, now: Temporal.Instant): number {
	const remaining = Temporal.Instant.from(expiresAt).since(now).total({ unit: "minutes" });
	return remaining > 0 ? Math.ceil(remaining) : 0;
}
