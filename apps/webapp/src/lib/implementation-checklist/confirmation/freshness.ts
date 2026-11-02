/**
 * Whether a manual checklist confirmation still vouches for the configuration it
 * covers (#1516, Organization ADR 0007). Confirming stores a fingerprint of that
 * configuration; each view recomputes it and compares.
 *
 * - `current`: the configuration is unchanged since the confirmation.
 * - `stale`: it changed; the confirmation is kept but doesn't count until confirmed again.
 * - `before-change-tracking`: confirmed before fingerprints existed; keeps counting.
 * - `unchecked`: the current fingerprint could not be worked out; doesn't count (fails closed).
 */
export type ManualConfirmationFreshness =
	| "current"
	| "stale"
	| "before-change-tracking"
	| "unchecked";

/** A manual confirmation as the checklist shows it. */
export interface ManualConfirmation {
	/** When it was confirmed, as an ISO instant; null for rows that never recorded it. */
	confirmedAt: string | null;
	freshness: ManualConfirmationFreshness;
}

export function manualConfirmationFreshness({
	stored,
	current,
}: {
	/** The fingerprint stored with the confirmation; null before change tracking. */
	stored: string | null;
	/** The configuration's fingerprint now; null when it could not be worked out. */
	current: string | null;
}): ManualConfirmationFreshness {
	if (stored === null) return "before-change-tracking";
	if (current === null) return "unchecked";
	return stored === current ? "current" : "stale";
}

/** Whether a confirmation with this freshness completes its item. */
export function manualConfirmationCounts(freshness: ManualConfirmationFreshness): boolean {
	return freshness === "current" || freshness === "before-change-tracking";
}
