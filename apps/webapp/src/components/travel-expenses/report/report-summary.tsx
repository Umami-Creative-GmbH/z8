"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ReceiptReportTotals } from "@/lib/travel-expenses/receipt-report";
import type { TripRequirement } from "@/lib/travel-expenses/trip-report";
import { formatMoney } from "./format";

/** Employee-paid (reimbursed) and company-paid totals of a report. */
export function ReportTotals({ id, totals }: { id: string; totals: ReceiptReportTotals }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<section aria-labelledby={`${id}-totals`} className="space-y-2 rounded-lg border p-4">
			<h3 id={`${id}-totals`} className="text-base font-semibold">
				{t("travelExpenses.report.totals.title", "Totals")}
			</h3>
			<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
				<dt>{t("travelExpenses.report.totals.reimbursable", "Reimbursed to you")}</dt>
				<dd className="text-right font-medium tabular-nums">
					{formatMoney(locale, totals.reimbursable, totals.currency)}
				</dd>
				<dt className="text-muted-foreground">
					{t("travelExpenses.report.totals.companyPaid", "Paid by the company")}
				</dt>
				<dd className="text-right tabular-nums text-muted-foreground">
					{formatMoney(locale, totals.companyPaid, totals.currency)}
				</dd>
			</dl>
			{totals.excludedItemCount > 0 && (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.totals.excluded",
						"{count, plural, one {# expense is} other {# expenses are}} not counted until amount, currency and payer are complete.",
						{ count: totals.excludedItemCount },
					)}
				</p>
			)}
		</section>
	);
}

function tripRequirementLabel(
	t: ReturnType<typeof useTranslate>["t"],
	requirement: TripRequirement,
) {
	switch (requirement) {
		case "purpose":
			return t(
				"travelExpenses.report.trip.requirements.purpose",
				"Describe the purpose of the trip.",
			);
		case "travel_dates":
			return t(
				"travelExpenses.report.trip.requirements.travelDates",
				"Enter the first and last travel day.",
			);
		case "destination":
			return t(
				"travelExpenses.report.trip.requirements.destination",
				"Add at least one destination.",
			);
		case "expense_item":
			return t("travelExpenses.report.trip.requirements.expenseItem", "Add an expense.");
	}
}

export interface IncompleteExpense {
	id: string;
	number: number;
	description: string | null;
}

/** What still keeps a trip from being complete, linking to each incomplete expense. */
export function TripRequirements({
	id,
	trip,
	incompleteExpenses,
}: {
	id: string;
	/** Missing shared trip facts; null while the trip details have malformed fields. */
	trip: TripRequirement[] | null;
	/** Expenses with missing or malformed facts; each links to its editor. */
	incompleteExpenses: IncompleteExpense[];
}) {
	const { t } = useTranslate();
	const complete = trip !== null && trip.length === 0 && incompleteExpenses.length === 0;
	return (
		<section aria-labelledby={`${id}-requirements`} className="space-y-2 rounded-lg border p-4">
			<h3 id={`${id}-requirements`} className="text-base font-semibold">
				{t("travelExpenses.report.trip.requirements.title", "Still needed for this trip")}
			</h3>
			{complete ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.trip.requirements.complete",
						"Everything for this trip is entered.",
					)}
				</p>
			) : (
				<ul className="list-disc space-y-1 pl-5 text-sm">
					{trip === null && (
						<li>
							{t(
								"travelExpenses.report.trip.requirements.fixFields",
								"Correct the highlighted trip details.",
							)}
						</li>
					)}
					{trip?.map((requirement) => (
						<li key={requirement}>{tripRequirementLabel(t, requirement)}</li>
					))}
					{incompleteExpenses.map((expense) => (
						<li key={expense.id}>
							<a
								href={`#expense-${expense.id}`}
								className="text-primary underline underline-offset-4 hover:text-primary/80"
							>
								{expense.description
									? t(
											"travelExpenses.report.trip.requirements.expenseNamed",
											"Expense {number}: {description}",
											{ number: expense.number, description: expense.description },
										)
									: t("travelExpenses.report.items.heading", "Expense {number}", {
											number: expense.number,
										})}
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export function DraftNotice() {
	const { t } = useTranslate();
	return (
		<Alert>
			<IconInfoCircle aria-hidden="true" className="size-4" />
			<AlertTitle>{t("travelExpenses.report.draftNotice.title", "Saved as a draft")}</AlertTitle>
			<AlertDescription>
				{t(
					"travelExpenses.report.draftNotice.description",
					"Your entries are saved automatically and you can continue later from Travel Expenses. Submitting expense reports for approval is not available yet.",
				)}
			</AlertDescription>
		</Alert>
	);
}
