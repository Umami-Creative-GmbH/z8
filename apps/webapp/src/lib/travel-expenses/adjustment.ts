import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";

/**
 * Signed adjustments of an exported or reimbursed travel expense report
 * (#615). An adjustment is a corrected copy of the report that receives fresh
 * whole-report approval. It never replaces the original's entitlement: it
 * represents the signed difference from the entitlement in force when it was
 * submitted (its baseline), and once approved that delta is added to the
 * original report's settlement account exactly once:
 *
 *   effective entitlement = original approved entitlement + Σ approved deltas
 *   delta                 = corrected employee-paid total − baseline entitlement
 *
 * A baseline names the original revision and every approved adjustment it
 * includes, so an adjustment decided against a baseline that changed since
 * (another adjustment approved meanwhile) is recognized as stale.
 */

export const ADJUSTMENT_REASON_MAX_LENGTH = 1000;

export function parseAdjustmentReason(
	input: string,
): { ok: true; reason: string } | { ok: false; code: "required" | "too_long" } {
	const reason = input.trim();
	if (!reason) return { ok: false, code: "required" };
	if (reason.length > ADJUSTMENT_REASON_MAX_LENGTH) return { ok: false, code: "too_long" };
	return { ok: true, reason };
}

/** One approved adjustment included in a baseline. */
export interface AdjustmentBaselineEntry {
	/** The adjustment report. */
	reportId: string;
	/** Its approved frozen revision. */
	revisionId: string;
	/** Its signed delta at the stored scale. */
	delta: string;
}

/** The approved entitlement an adjustment corrects, and how it is composed. */
export interface AdjustmentBaseline {
	originalReportId: string;
	/** The original report's approved frozen revision. */
	revisionId: string;
	submissionCycle: number;
	currency: string;
	/** Employee-paid total of the original approved revision. */
	approvedAmount: string;
	/** Approved adjustments already applied, ordered by report id. */
	adjustments: AdjustmentBaselineEntry[];
	/** `approvedAmount` + every delta: the effective entitlement. */
	entitlement: string;
}

function storedUnits(value: string): bigint {
	const units = parseUnits(value, STORED_AMOUNT_SCALE);
	if (units === null) throw new RangeError(`Not a stored amount: ${value}`);
	return units;
}

export function composeAdjustmentBaseline(
	original: Omit<AdjustmentBaseline, "adjustments" | "entitlement">,
	adjustments: readonly AdjustmentBaselineEntry[],
): AdjustmentBaseline {
	const ordered = adjustments
		.map((entry) => ({ ...entry }))
		.toSorted((left, right) => (left.reportId < right.reportId ? -1 : 1));
	if (new Set(ordered.map((entry) => entry.reportId)).size !== ordered.length) {
		throw new RangeError("An adjustment is applied once");
	}
	const entitlement = sumUnits([
		storedUnits(original.approvedAmount),
		...ordered.map((entry) => storedUnits(entry.delta)),
	]);
	return {
		...original,
		adjustments: ordered,
		entitlement: formatUnits(entitlement, STORED_AMOUNT_SCALE),
	};
}

export function adjustmentDelta(
	corrected: { amount: string; currency: string },
	baseline: Pick<AdjustmentBaseline, "currency" | "entitlement">,
): { amount: string; currency: string } {
	if (corrected.currency !== baseline.currency) {
		throw new RangeError("An adjustment is in the original report's currency");
	}
	const delta = storedUnits(corrected.amount) - storedUnits(baseline.entitlement);
	return { amount: formatUnits(delta, STORED_AMOUNT_SCALE), currency: baseline.currency };
}

/** Whether two baselines name the same approved entitlement composition. */
export function sameAdjustmentBaseline(
	left: AdjustmentBaseline,
	right: AdjustmentBaseline,
): boolean {
	return (
		left.originalReportId === right.originalReportId &&
		left.revisionId === right.revisionId &&
		left.currency === right.currency &&
		left.entitlement === right.entitlement &&
		left.adjustments.length === right.adjustments.length &&
		left.adjustments.every(
			(entry, index) =>
				entry.reportId === right.adjustments[index]?.reportId &&
				entry.revisionId === right.adjustments[index]?.revisionId &&
				entry.delta === right.adjustments[index]?.delta,
		)
	);
}

export type AdjustmentIneligibility =
	| "not_approved"
	/** An adjustment is itself corrected through its original report. */
	| "is_adjustment"
	/** Not yet exported or reimbursed: reopen the report instead (#614). */
	| "not_exported_or_reimbursed";

export function adjustmentEligibility(input: {
	approved: boolean;
	isAdjustment: boolean;
	exported: boolean;
	reimbursed: boolean;
}): { ok: true } | { ok: false; reason: AdjustmentIneligibility } {
	if (input.isAdjustment) return { ok: false, reason: "is_adjustment" };
	if (!input.approved) return { ok: false, reason: "not_approved" };
	if (!input.exported && !input.reimbursed) {
		return { ok: false, reason: "not_exported_or_reimbursed" };
	}
	return { ok: true };
}
