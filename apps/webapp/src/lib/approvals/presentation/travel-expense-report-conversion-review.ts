import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

/**
 * Review rows of a foreign-currency expense's frozen conversion (#607): the
 * reimbursed amount, a visibly distinct basis, and the card charge evidence
 * or the authorized rate with its date, rounding, authorizer and reason.
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
			label: text("reimbursedAs", "Reimbursed as"),
			value: `${conversion.reimbursement.amount} ${conversion.reimbursement.currency}`,
		},
	];
	if (conversion.basis === "card_charge") {
		rows.push(
			{
				label: text("conversionBasis", "Conversion basis"),
				value: text("conversionBasisCardCharge", "Actual card charge (evidenced)"),
			},
			{
				label: text("conversionEvidence", "Charge evidence"),
				value: conversion.evidenceReceiptId
					? (receiptFileNames[conversion.evidenceReceiptId] ?? conversion.evidenceReceiptId)
					: text("unavailable", "Unavailable"),
			},
		);
		return rows;
	}
	const { rate } = conversion;
	rows.push(
		{
			label: text("conversionBasis", "Conversion basis"),
			value: text("conversionBasisManualRate", "Authorized manual rate"),
		},
		{
			label: text("conversionRate", "Rate"),
			value: `1 ${rate.base} = ${rate.value} ${rate.quote}`,
		},
		// A calendar date as documented; it never shifts with the viewer's zone.
		{ label: text("conversionRateDate", "Rate date"), value: conversion.rateDate },
		{
			label: text("conversionRounding", "Rounding"),
			// Only half-up rounding is applied today (CONVERSION_ROUNDING_MODE).
			value:
				conversion.rounding.mode === "half_up"
					? text("conversionRoundingHalfUp", "Half up, once, to the currency's minor units")
					: text("conversionRoundingHalfEven", "Half even, once, to the currency's minor units"),
		},
		{ label: text("conversionAuthorizedBy", "Authorized by"), value: conversion.authorizedBy.name },
		{ label: text("conversionReason", "Documentation"), value: conversion.reason },
	);
	return rows;
}
