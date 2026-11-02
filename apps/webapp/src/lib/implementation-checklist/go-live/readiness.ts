import type { ImplementationChecklistItemId } from "../definition";
import {
	type GoLiveCheckResult,
	type GoLiveFailureGroup,
	type GoLiveReadiness,
	goLiveMemberKey,
	type ImplementationChecklistItemStatus,
} from "./types";

/**
 * The status of an item that carries a go-live check. Settings presence alone
 * never verifies: verified needs a passing check over at least one member.
 */
export function goLiveItemStatus(result: GoLiveCheckResult): ImplementationChecklistItemStatus {
	if (result.outcome === "unavailable") return "unavailable";
	if (!result.configured) return "not-set-up";
	if (result.outcome === "failed") return "needs-attention";
	return result.checkedMemberCount > 0 ? "verified" : "configured";
}

/**
 * Whether the item applies to the organization. Only a completed check can say it doesn't
 * (payroll export without an active target); an unavailable check couldn't tell, so it applies.
 */
export function goLiveResultApplies(result: GoLiveCheckResult): boolean {
	return result.outcome === "unavailable" || result.applies !== false;
}

/**
 * Overall go-live readiness, from mandatory checks only. A lookup failure makes
 * it unavailable, never ready. With nobody in the go-live group every check
 * passes vacuously, so it is not ready either. Advisory failures and every
 * check's warnings are passed on as warnings and never block.
 */
export function resolveGoLiveReadiness(
	results: readonly GoLiveCheckResult[],
	/** How many members the go-live group has; null when unknown. */
	memberCount: number | null,
): GoLiveReadiness {
	const mandatory = results.filter((result) => result.severity === "mandatory");
	if (mandatory.some((result) => result.outcome === "unavailable")) {
		return { status: "unavailable" };
	}

	const warnings: GoLiveFailureGroup[] = [];
	const affected = new Set<string>();
	// An organization-level failure (no wage-type mappings) blocks even when it lists nobody.
	const failingItemIds = new Set<ImplementationChecklistItemId>();
	for (const result of results) {
		if (result.outcome === "unavailable") continue;
		warnings.push(...result.warnings);
		if (result.severity === "advisory") {
			warnings.push(...result.failures);
			continue;
		}
		for (const failure of result.failures) {
			failingItemIds.add(result.itemId);
			for (const { member } of failure.members) affected.add(goLiveMemberKey(member));
		}
	}

	if (memberCount === 0) return { status: "not-ready", cause: "empty-group", warnings };
	if (affected.size > 0) {
		return { status: "not-ready", cause: "members", affectedMemberCount: affected.size, warnings };
	}
	if (failingItemIds.size > 0) {
		return {
			status: "not-ready",
			cause: "organization",
			failingItemIds: [...failingItemIds],
			warnings,
		};
	}
	return { status: "ready", warnings };
}
