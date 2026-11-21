import type { DailyWorkRequirements } from "./types";

const trustBasedDatesByRequirements = new WeakMap<DailyWorkRequirements, ReadonlySet<string>>();

/** Attaches the set of `YYYY-MM-DD` dates in a requirements range whose contract is `trust_based`. */
export function attachTrustBasedBalanceDates(
	requirements: DailyWorkRequirements,
	dates: ReadonlySet<string>,
): DailyWorkRequirements {
	if (dates.size > 0) {
		trustBasedDatesByRequirements.set(requirements, dates);
	}
	return requirements;
}

/** Propagates any attached `trust_based` date set across pure requirement transforms. */
export function preserveTrustBasedBalanceDates(
	source: DailyWorkRequirements,
	target: DailyWorkRequirements,
): DailyWorkRequirements {
	const existing = trustBasedDatesByRequirements.get(source);
	if (existing && existing.size > 0) {
		trustBasedDatesByRequirements.set(target, existing);
	}
	return target;
}

/**
 * Returns every `YYYY-MM-DD` date marked as `trust_based` (exact 0 balance delta),
 * combining both attached full-range metadata (covering weekends / zero-hour days)
 * and per-entry `contributesZeroBalanceDelta` flags.
 */
export function collectTrustBasedBalanceDates(
	requirements: DailyWorkRequirements,
): ReadonlySet<string> {
	const attached = trustBasedDatesByRequirements.get(requirements);
	const merged = new Set<string>(attached ? [...attached] : []);
	for (const [dateKey, req] of Object.entries(requirements)) {
		if (req.contributesZeroBalanceDelta || req.balanceMode === "trust_based") {
			merged.add(dateKey);
		}
	}
	return merged;
}
