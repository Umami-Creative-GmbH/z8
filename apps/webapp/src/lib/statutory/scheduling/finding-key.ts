import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

/**
 * Identifies a statutory finding in the state a planner must react to. Totals may change between
 * two evaluations, but a different severity, tier (e.g. 96 % → over the cap), acknowledgement
 * status or publication block makes it a new warning.
 */
export function statutoryFindingChangeKey(finding: StatutoryComplianceFinding): string {
	return JSON.stringify([
		"statutory",
		finding.findingId,
		finding.severity,
		finding.summary.tier ?? null,
		finding.acknowledgementStatus,
		finding.blocksPublication,
	]);
}
