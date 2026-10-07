import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import type {
	ApprovalInboxDetailSection,
	ApprovalInboxLocalizedText,
	ApprovalInboxValue,
} from "../inbox/types";

const text = (
	key: string,
	fallback: string,
	params?: ApprovalInboxLocalizedText["params"],
): ApprovalInboxLocalizedText => ({
	key,
	fallback,
	...(params ? { params } : {}),
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
	const signedDelta: ApprovalInboxValue = {
		kind: "money",
		amount: delta.amount,
		currency: delta.currency,
		signed: true,
	};
	return [
		{
			type: "callout",
			title: text(
				"approvals:approvals.evidence.adjustmentCalloutTitle",
				"Adjustment of an approved report",
			),
			body: {
				...text(
					"approvals:approvals.evidence.adjustmentCalloutBody",
					"This corrects an already exported or reimbursed report. Approving it changes the employee's approved amount by {delta}; the original report and its payments stay unchanged.",
				),
				params: { delta: signedDelta },
			},
			tone: delta.amount.startsWith("-") ? "warning" : "info",
		},
		{
			type: "key_value",
			title: text("approvals:approvals.evidence.adjustmentTitle", "Adjustment"),
			rows: [
				{
					label: text("approvals:approvals.evidence.adjustmentOriginalReport", "Corrects report"),
					value: text(
						"approvals:approvals.evidence.adjustmentOpenOriginal",
						"Open the approved report",
					),
					href: `/travel-expenses/reports/${adjustment.originalReportId}`,
				},
				{
					label: text("approvals:approvals.evidence.adjustmentReason", "Reason"),
					value: adjustment.reason,
				},
				{
					label: text(
						"approvals:approvals.evidence.adjustmentBaseline",
						"Approved amount before this adjustment",
					),
					value: { kind: "money", amount: baseline.entitlement, currency: baseline.currency },
				},
				...(baseline.adjustments.length > 0
					? [
							{
								label: text(
									"approvals:approvals.evidence.adjustmentBaselineComposition",
									"Of which earlier adjustments",
								),
								value: text("approvals:approvals.evidence.adjustmentBaselineEntries", "{entries}", {
									entries: baseline.adjustments.map(
										(entry): ApprovalInboxValue => ({
											kind: "money",
											amount: entry.delta,
											currency: baseline.currency,
										}),
									),
								}),
							},
						]
					: []),
				{
					label: text("approvals:approvals.evidence.adjustmentCorrected", "Corrected amount"),
					value: {
						kind: "money",
						amount: facts.totals.reimbursable,
						currency: facts.totals.currency,
					},
				},
				{
					label: text("approvals:approvals.evidence.adjustmentDelta", "Signed difference"),
					value: signedDelta,
				},
			],
		},
	];
}
