import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { StatutoryFinding, StatutoryFindingSummary } from "../finding";
import { isEarningsDerivedFinding, restrictedSummary } from "../redaction";

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

/** `used` past `limit` in the same unit: above a ceiling, or below a floor. */
export function isPastVisibleLimit(summary: StatutoryFindingSummary): boolean {
	const { used, limit } = summary;
	if (!used || !limit || used.unit !== limit.unit) return false;
	return summary.limitDirection === "floor" ? used.value < limit.value : used.value > limit.value;
}

/** How deep a breach goes, as `statutoryBreachDepth` reports it. */
export interface StatutoryBreachDepth {
	/** `used` and `limit` of a finding past its visible limit; null otherwise. */
	readonly used: number | null;
	readonly limit: number | null;
	/** The work a sector exception or release conflict covers, when it says. */
	readonly coveredMinutes: number | null;
}

/**
 * How deep a statutory finding goes, in figures that change only on a material change: `used` and
 * `limit` once past the limit (an under-limit warning counts by its tier alone), and the covered
 * minutes. Only what a restricted reader sees: an earnings-derived finding counts by its tier
 * alone, so a hash of it never confirms a guessed wage. A running clock-in counts without the
 * minutes it grows by (`stableDepth`), so the depth holds while the clock runs; the clock-out that
 * fixes them may change it. Null when nothing counts.
 */
export function statutoryBreachDepth(
	finding: Pick<
		StatutoryFinding,
		"domain" | "earningsDerived" | "summary" | "coveredMinutes" | "stableDepth"
	>,
): StatutoryBreachDepth | null {
	if (isEarningsDerivedFinding(finding)) return null;
	const summary = restrictedSummary(finding);
	const breached = isPastVisibleLimit(summary);
	const stable = finding.stableDepth;
	const used = !breached
		? null
		: stable?.used !== undefined
			? stable.used
			: (summary.used?.value ?? null);
	const limit = breached ? (summary.limit?.value ?? null) : null;
	const coveredMinutes =
		finding.coveredMinutes === undefined
			? null
			: stable?.coveredMinutes !== undefined
				? stable.coveredMinutes
				: finding.coveredMinutes;
	if (used === null && limit === null && coveredMinutes === null) return null;
	return { used, limit, coveredMinutes };
}

/**
 * What a planner's publish acknowledgement of a statutory finding covers: its change key and its
 * breach depth. A deeper breach at the same severity and tier (a lecture week 22 h → 30 h) makes the
 * acknowledgement stale; a running clock-in does not. Server-side: hash it, never send it.
 */
export function statutoryPublishKey(
	projected: StatutoryComplianceFinding,
	finding: Parameters<typeof statutoryBreachDepth>[0],
): string {
	return JSON.stringify([statutoryFindingChangeKey(projected), statutoryBreachDepth(finding)]);
}
