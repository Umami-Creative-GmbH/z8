import { type AdjustmentBaseline, adjustmentDelta } from "@/lib/travel-expenses/adjustment";
import { ApprovalEvidenceError } from "./errors";

/**
 * Frozen facts of an adjustment report (#615, facts schema v8). An adjustment
 * report freezes, beside its corrected items and totals, the report it
 * corrects, the employee's reason, the approved baseline it was calculated
 * against and the signed delta. Reviewers approve exactly this delta; the
 * settlement of the original report adds it once the adjustment is approved.
 */

/** Version 8 (#615) adds the root `adjustment` of an adjustment report. */
export const ADJUSTMENT_FACTS_SCHEMA_VERSION = 8;

export interface TravelExpenseReportSubmittedAdjustment {
	originalReportId: string;
	reason: string;
	/** The approved entitlement in force at submission, with its composition. */
	baseline: AdjustmentBaseline;
	/** Corrected employee-paid total − `baseline.entitlement`; signed. */
	delta: { amount: string; currency: string };
}

/** The live link of an adjustment report (`travel_expense_report_adjustment`). */
export interface TravelExpenseReportAdjustmentLink {
	originalReportId: string;
	reason: string;
}

/**
 * The `adjustment` key of a snapshot. Submitting requires the baseline
 * resolved under the original report's lock; comparing keeps the frozen
 * baseline (whether it is still current is checked when approving) and
 * recomputes the delta from the live totals, so any change of the corrected
 * amounts or of the link is a material change.
 */
export function adjustmentSnapshot(input: {
	link: TravelExpenseReportAdjustmentLink | null | undefined;
	baseline: AdjustmentBaseline | undefined;
	frozen: TravelExpenseReportSubmittedAdjustment | undefined;
	corrected: { amount: string; currency: string };
	mode: "submit" | "compare";
	schemaVersion: number;
}): { adjustment?: TravelExpenseReportSubmittedAdjustment } {
	const { link } = input;
	if (input.schemaVersion < ADJUSTMENT_FACTS_SCHEMA_VERSION || !link) return {};
	const baseline = input.mode === "submit" ? input.baseline : input.frozen?.baseline;
	if (!baseline || baseline.originalReportId !== link.originalReportId) {
		if (input.mode === "submit") {
			throw new ApprovalEvidenceError("evidence_incomplete", { field: "adjustment_baseline" });
		}
		return {
			adjustment: {
				...link,
				baseline: null,
				delta: null,
			} as unknown as TravelExpenseReportSubmittedAdjustment,
		};
	}
	let delta: { amount: string; currency: string } | null;
	try {
		delta = adjustmentDelta(input.corrected, baseline);
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		if (input.mode === "submit") {
			throw new ApprovalEvidenceError("evidence_incomplete", { field: "adjustment_currency" });
		}
		delta = null;
	}
	return {
		adjustment: {
			originalReportId: link.originalReportId,
			reason: link.reason,
			baseline: structuredClone(baseline),
			delta,
		} as TravelExpenseReportSubmittedAdjustment,
	};
}
