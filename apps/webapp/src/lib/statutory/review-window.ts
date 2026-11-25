/**
 * The planning horizon of the statutory review inbox (#1994): the last week to eight weeks ahead.
 * Every review list the inbox reads covers at least these days, so a finding inside the horizon is
 * never left to a list that does not judge it.
 */
import type { PlainDate } from "@/lib/datetime/temporal-core";

/** Days before today the inbox covers: recently worked shifts. */
export const STATUTORY_MONITOR_LOOKBACK_DAYS = 7;
/** Days after today the inbox covers: the planning horizon. */
export const STATUTORY_MONITOR_LOOKAHEAD_DAYS = 56;

/** The inbox's days around `today`, `[start, endExclusive)` as `YYYY-MM-DD`. */
export function statutoryReviewWindow(today: PlainDate): {
	readonly start: string;
	readonly endExclusive: string;
} {
	return {
		start: today.subtract({ days: STATUTORY_MONITOR_LOOKBACK_DAYS }).toString(),
		endExclusive: today.add({ days: STATUTORY_MONITOR_LOOKAHEAD_DAYS + 1 }).toString(),
	};
}
