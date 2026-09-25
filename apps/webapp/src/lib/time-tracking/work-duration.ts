/**
 * Fresh completed-work duration (#252 §2): exact UTC elapsed time rounded to the
 * nearest whole minute, half up. Positive intervals that round to zero are valid
 * work; equal or reversed endpoints are rejected. Each segment is rounded on its
 * own. Protected historical minutes are never recalculated with this rule.
 */
import type { Instant } from "@/lib/datetime/temporal-core";

const NANOSECONDS_PER_MINUTE = BigInt(60_000_000_000);
const HALF_MINUTE_NANOSECONDS = BigInt(30_000_000_000);

export class WorkIntervalError extends Error {
	constructor() {
		super("Work must end after it starts");
		this.name = "WorkIntervalError";
	}
}

export function deriveWorkDurationMinutes(start: Instant, end: Instant): number {
	const elapsed = end.epochNanoseconds - start.epochNanoseconds;
	if (elapsed <= BigInt(0)) throw new WorkIntervalError();
	return Number((elapsed + HALF_MINUTE_NANOSECONDS) / NANOSECONDS_PER_MINUTE);
}
