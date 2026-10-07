import type { ApprovalDisplayMetadata } from "../domain/types";
import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxLocalizedText, ApprovalInboxValue } from "../inbox/types";

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
 * The inbox list row of an expense report from its frozen submission. The
 * English strings serve search, briefings and self-service lists; the
 * localized forms carry typed dates and amounts the inbox formats in the
 * viewer's locale (#687).
 */
export function travelExpenseReportDisplay(
	facts: Pick<TravelExpenseReportSubmittedFacts, "trip" | "items" | "totals"> | null,
): ApprovalDisplayMetadata {
	if (!facts) {
		return {
			title: "Expense report",
			subtitle: "Submitted facts unavailable",
			summary: "",
			icon: "receipt",
		};
	}
	const { trip, totals, items } = facts;
	const dates: ApprovalInboxValue | null = trip
		? { kind: "plain_date_range", start: trip.startDate, end: trip.endDate }
		: items[0]
			? { kind: "plain_date", date: items[0].expenseDate }
			: null;
	const englishDates = trip
		? trip.startDate === trip.endDate
			? trip.startDate
			: `${trip.startDate} – ${trip.endDate}`
		: (items[0]?.expenseDate ?? "");
	const name = trip ? trip.purpose : (items[0]?.description ?? "");
	const hasCompanyPaid = totals.companyPaid !== "0.00";
	const reimbursable: ApprovalInboxValue = {
		kind: "money",
		amount: totals.reimbursable,
		currency: totals.currency,
	};
	const companyPaid: ApprovalInboxValue = {
		kind: "money",
		amount: totals.companyPaid,
		currency: totals.currency,
	};
	return {
		title: trip ? "Trip expense report" : "Expense report",
		subtitle: `${name} · ${englishDates}`,
		summary: `${items.length} ${items.length === 1 ? "expense" : "expenses"} · reimbursable ${totals.currency} ${totals.reimbursable}${hasCompanyPaid ? ` · company-paid ${totals.currency} ${totals.companyPaid}` : ""}`,
		icon: "receipt",
		localized: {
			title: trip
				? text("approvals:approvals.reportSummary.tripTitle", "Trip expense report")
				: text("approvals:approvals.reportSummary.title", "Expense report"),
			subtitle: dates
				? text("approvals:approvals.reportSummary.subtitle", "{name} · {dates}", { name, dates })
				: text("approvals:approvals.reportSummary.subtitleName", "{name}", { name }),
			summary: hasCompanyPaid
				? text(
						"approvals:approvals.reportSummary.detailWithCompanyPaid",
						"{count, plural, one {# expense} other {# expenses}} · reimbursable {reimbursable} · company-paid {companyPaid}",
						{ count: items.length, reimbursable, companyPaid },
					)
				: text(
						"approvals:approvals.reportSummary.detail",
						"{count, plural, one {# expense} other {# expenses}} · reimbursable {reimbursable}",
						{ count: items.length, reimbursable },
					),
		},
	};
}
