/**
 * Ordering the ISO instants of reconciliation views (#1308) as instants, not
 * as strings (`docs/refs/dates.md`). Client-safe.
 */

import { compareInstants, parseInstant } from "@/lib/datetime/temporal-core";

/** Earlier instants first. */
export function compareIsoInstants(a: string, b: string): number {
	return compareInstants(parseInstant(a), parseInstant(b));
}

/** History entries, newest first. */
export function newestFirst(a: { at: string }, b: { at: string }): number {
	return compareIsoInstants(b.at, a.at);
}
