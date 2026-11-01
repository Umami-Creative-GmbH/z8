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
 * Overall go-live readiness, from mandatory checks only. A lookup failure makes
 * it unavailable, never ready. Advisory failures and every check's warnings
 * are passed on as warnings and never block.
 */
export function resolveGoLiveReadiness(results: readonly GoLiveCheckResult[]): GoLiveReadiness {
	const mandatory = results.filter((result) => result.severity === "mandatory");
	if (mandatory.some((result) => result.outcome === "unavailable")) {
		return { status: "unavailable" };
	}

	const warnings: GoLiveFailureGroup[] = [];
	const affected = new Set<string>();
	// An organization-level failure (no wage-type mappings) blocks even when it lists nobody.
	let mandatoryFailure = false;
	for (const result of results) {
		if (result.outcome === "unavailable") continue;
		warnings.push(...result.warnings);
		if (result.severity === "advisory") {
			warnings.push(...result.failures);
			continue;
		}
		for (const failure of result.failures) {
			mandatoryFailure = true;
			for (const { member } of failure.members) affected.add(goLiveMemberKey(member));
		}
	}

	return mandatoryFailure
		? { status: "not-ready", affectedMemberCount: affected.size, warnings }
		: { status: "ready", warnings };
}
