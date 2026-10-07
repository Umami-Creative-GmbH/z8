import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key,
	fallback,
});

/**
 * Review rows of a foreign-currency expense's frozen conversion (#607): the
 * reimbursed amount, a visibly distinct basis, and the card charge evidence
 * or the authorized rate with its date, rounding, authorizer, reason and
 * evidence reference (v11+).
 * Empty for an expense in the reimbursement currency.
 */
export function conversionReviewRows(
	item: TravelExpenseReportSubmittedItem,
	receiptFileNames: Record<string, string>,
): Row[] {
	const { conversion } = item;
	if (!conversion) return [];
	const rows: Row[] = [
		{
			label: text("approvals:approvals.evidence.reimbursedAs", "Reimbursed as"),
			value: {
				kind: "money",
				amount: conversion.reimbursement.amount,
				currency: conversion.reimbursement.currency,
			},
		},
	];
	if (conversion.basis === "card_charge") {
		rows.push(
			{
				label: text("approvals:approvals.evidence.conversionBasis", "Conversion basis"),
				value: text(
					"approvals:approvals.evidence.conversionBasisCardCharge",
					"Actual card charge (evidenced)",
				),
			},
			{
				label: text("approvals:approvals.evidence.conversionEvidence", "Charge evidence"),
				value: conversion.evidenceReceiptId
					? (receiptFileNames[conversion.evidenceReceiptId] ?? conversion.evidenceReceiptId)
					: text("approvals:approvals.evidence.unavailable", "Unavailable"),
			},
		);
		return rows;
	}
	const { rate } = conversion;
	const rateRow: Row = {
		label: text("approvals:approvals.evidence.conversionRate", "Rate"),
		value: `1 ${rate.base} = ${rate.value} ${rate.quote}`,
	};
	const roundingRow: Row = {
		label: text("approvals:approvals.evidence.conversionRounding", "Rounding"),
		// Only half-up rounding is applied today (CONVERSION_ROUNDING_MODE).
		value:
			conversion.rounding.mode === "half_up"
				? text(
						"approvals:approvals.evidence.conversionRoundingHalfUp",
						"Half up, once, to the currency's minor units",
					)
				: text(
						"approvals:approvals.evidence.conversionRoundingHalfEven",
						"Half even, once, to the currency's minor units",
					),
	};
	if (conversion.basis === "reference_rate") {
		// #608: the frozen publication; dates are calendar dates without a zone.
		rows.push(
			{
				label: text("approvals:approvals.evidence.conversionBasis", "Conversion basis"),
				value: text(
					"approvals:approvals.evidence.conversionBasisReferenceRate",
					"Approved reference rate",
				),
			},
			{
				label: text("approvals:approvals.evidence.conversionReferenceSource", "Rate source"),
				value: text(
					"approvals:approvals.evidence.conversionReferenceSourceEcb",
					"ECB euro reference rate (approved by the organization)",
				),
			},
			rateRow,
			{
				label: text("approvals:approvals.evidence.conversionPublicationDate", "Publication date"),
				value: { kind: "plain_date", date: conversion.rateDate },
			},
			...(conversion.rateDate < conversion.expenseDate
				? [
						{
							label: text(
								"approvals:approvals.evidence.conversionPublicationUsed",
								"Publication used",
							),
							value: text(
								"approvals:approvals.evidence.conversionPublicationFallback",
								"Latest earlier publication; none on the expense date",
							),
						},
					]
				: []),
			{
				label: text(
					"approvals:approvals.evidence.conversionPublicationVersion",
					"Publication version",
				),
				value: String(conversion.source.publicationVersion),
			},
			roundingRow,
		);
		return rows;
	}
	rows.push(
		{
			label: text("approvals:approvals.evidence.conversionBasis", "Conversion basis"),
			value: text(
				"approvals:approvals.evidence.conversionBasisManualRate",
				"Authorized manual rate",
			),
		},
		rateRow,
		// A calendar date as documented; it never shifts with the viewer's zone.
		{
			label: text("approvals:approvals.evidence.conversionRateDate", "Rate date"),
			value: { kind: "plain_date", date: conversion.rateDate },
		},
		roundingRow,
		{
			label: text("approvals:approvals.evidence.conversionAuthorizedBy", "Authorized by"),
			value: conversion.authorizedBy.name,
		},
		{
			label: text("approvals:approvals.evidence.conversionReason", "Documentation"),
			value: conversion.reason,
		},
		// Frozen from facts version 11; earlier revisions recorded none.
		...(conversion.evidence
			? [
					{
						label: text("approvals:approvals.evidence.conversionRateEvidence", "Rate evidence"),
						value: conversion.evidence,
					},
				]
			: []),
	);
	return rows;
}
