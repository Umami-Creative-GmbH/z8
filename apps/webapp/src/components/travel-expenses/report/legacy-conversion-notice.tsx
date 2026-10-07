"use client";

import { IconArrowRight, IconHistory } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getLegacyTravelExpenseConversion } from "@/app/[locale]/(app)/travel-expenses/legacy-draft-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryKeys } from "@/lib/query/keys";
import type { LegacyConversionFlag } from "@/lib/travel-expenses/legacy-draft-conversion";
import type { LegacyConversionView } from "@/lib/travel-expenses/legacy-draft-conversion-read";
import { Link } from "@/navigation";
import { formatMoney, formatPlainDateRange } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Why a field of the continued draft is empty, in the employee's terms. */
function legacyConversionFlagText(
	t: Translate,
	flag: LegacyConversionFlag,
	legacy: LegacyConversionView["legacy"],
	locale: string,
): string {
	switch (flag) {
		case "expense_date_unknown":
			return t(
				"travelExpenses.legacyDraft.flags.expenseDate",
				"The draft covered {range}. Choose the day of this expense.",
				{ range: formatPlainDateRange(locale, legacy.tripStartDate, legacy.tripEndDate) ?? "" },
			);
		case "trip_dates_not_recorded":
			return t(
				"travelExpenses.legacyDraft.flags.tripDates",
				"The draft was created before travel dates were recorded. Enter the dates.",
			);
		case "destination_unmatched":
			return t(
				"travelExpenses.legacyDraft.flags.destination",
				'The destination "{destination}" could not be matched to a country. Choose it.',
				{
					destination: [legacy.destinationCity, legacy.destinationCountry]
						.filter(Boolean)
						.join(", "),
				},
			);
		case "amount_not_carried":
			return t(
				"travelExpenses.legacyDraft.flags.amount",
				"The entered amount {amount} is not a valid receipt amount. Enter the amount and currency from the receipt.",
				{ amount: `${legacy.originalAmount} ${legacy.originalCurrency}` },
			);
		case "manual_total_not_used":
			return t(
				"travelExpenses.legacyDraft.flags.manualTotal",
				"The draft had a typed total of {amount}. It is not used: this expense is now calculated from what you enter below.",
				{ amount: formatMoney(locale, legacy.calculatedAmount, legacy.calculatedCurrency) },
			);
		case "notes_not_carried":
			return t(
				"travelExpenses.legacyDraft.flags.notes",
				"Your notes are shown below; copy what still applies.",
			);
		case "project_eligibility_required":
			return t(
				"travelExpenses.legacyDraft.flags.project",
				"The draft's project was kept. Unless your assignment on the expense date is on record, an expense administrator must authorize it before you can submit.",
			);
		case "project_not_carried":
			return t(
				"travelExpenses.legacyDraft.flags.projectMissing",
				"The draft's project no longer exists. Choose a project if one applies.",
			);
		case "conversion_required":
			return t(
				"travelExpenses.legacyDraft.flags.conversion",
				"The receipt is in a foreign currency. The draft recorded no conversion, so add how it was converted (card charge or rate) before you submit.",
			);
	}
}

/**
 * On a report continued from a legacy draft (#616): where it came from, what
 * was carried over and why some fields are still empty.
 */
export function LegacyConversionNotice({ reportId }: { reportId: string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data } = useQuery({
		queryKey: queryKeys.travelExpenses.legacyConversion(reportId),
		queryFn: async () => {
			const result = await getLegacyTravelExpenseConversion({ reportId });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (!data) return null;
	const { legacy } = data;
	const notes = legacy.notes?.trim();
	return (
		<Alert>
			<IconHistory aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t("travelExpenses.legacyDraft.notice.title", "Continued from an earlier claim draft")}
			</AlertTitle>
			<AlertDescription className="space-y-2">
				<p>
					{t(
						"travelExpenses.legacyDraft.notice.description",
						"What you entered was carried over where this form can hold it exactly, including {count} receipts. Complete the remaining fields before submitting.",
						{ count: legacy.attachments.length },
					)}
				</p>
				{data.flags.length > 0 && (
					<ul className="list-disc space-y-1 pl-5 text-sm">
						{data.flags.map((flag) => (
							<li key={flag}>{legacyConversionFlagText(t, flag, legacy, locale)}</li>
						))}
					</ul>
				)}
				{notes && data.flags.includes("notes_not_carried") && (
					<blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
						{notes}
					</blockquote>
				)}
				<Link
					href={`/travel-expenses/${data.claimId}`}
					className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
				>
					{t("travelExpenses.legacyDraft.notice.original", "View the original draft")}
					<IconArrowRight aria-hidden="true" className="size-4" />
				</Link>
			</AlertDescription>
		</Alert>
	);
}
