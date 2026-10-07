import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";

export interface PolicyVersion {
	source: AllowancePolicySource;
	effectiveFrom: string;
	createdAt: string;
	withdrawnAt: string | null;
}

/**
 * The active version that adopted the statutory catalog `defaultKey` (#689),
 * the latest-starting one if several did. A withdrawn version adopts nothing.
 */
export function catalogAdoption<T extends PolicyVersion>(
	versions: readonly T[],
	defaultKey: string,
): T | null {
	let latest: T | null = null;
	for (const version of versions) {
		if (version.withdrawnAt) continue;
		if (version.source.kind !== "statutory_default" || version.source.defaultKey !== defaultKey) {
			continue;
		}
		if (
			!latest ||
			comparePlainDates(
				parsePlainDate(version.effectiveFrom),
				parsePlainDate(latest.effectiveFrom),
			) > 0
		) {
			latest = version;
		}
	}
	return latest;
}
