import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

/**
 * The review section of an adjustment report (#615), shown before the
 * corrected expenses: which report it corrects, why, the approved amount it
 * was calculated against and the signed delta approving it applies. Read from
 * the frozen facts only. A negative delta is reviewed like any other change.
 */
export function adjustmentReviewSections(
	facts: TravelExpenseReportSubmittedFacts,
): ApprovalInboxDetailSection[] {
	const { adjustment } = facts;
	if (!adjustment) return [];
	const { baseline, delta } = adjustment;
	const signed = delta.amount.startsWith("-") ? delta.amount : `+${delta.amount}`;
	return [
		{
			type: "callout",
			title: "Adjustment of an approved report",
			body: `This corrects an already exported or reimbursed report. Approving it changes the employee's approved amount by ${signed} ${delta.currency}; the original report and its payments stay unchanged.`,
			tone: delta.amount.startsWith("-") ? "warning" : "info",
		},
		{
			type: "key_value",
			title: text("adjustmentTitle", "Adjustment"),
			rows: [
				{
					label: text("adjustmentOriginalReport", "Corrects report"),
					value: adjustment.originalReportId,
				},
				{ label: text("adjustmentReason", "Reason"), value: adjustment.reason },
				{
					label: text("adjustmentBaseline", "Approved amount before this adjustment"),
					value: `${baseline.entitlement} ${baseline.currency}`,
				},
				...(baseline.adjustments.length > 0
					? [
							{
								label: text("adjustmentBaselineComposition", "Of which earlier adjustments"),
								value: baseline.adjustments
									.map((entry) => `${entry.delta} ${baseline.currency}`)
									.join("; "),
							},
						]
					: []),
				{
					label: text("adjustmentCorrected", "Corrected amount"),
					value: `${facts.totals.reimbursable} ${facts.totals.currency}`,
				},
				{
					label: text("adjustmentDelta", "Signed difference"),
					value: `${signed} ${delta.currency}`,
				},
			],
		},
	];
}
