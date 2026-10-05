"use client";

import { IconChevronRight, IconPaperclip } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getMyDraftTravelExpenseReports } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { queryKeys } from "@/lib/query/keys";
import { Link } from "@/navigation";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { formatMoney, formatPlainDate } from "./format";

/** The employee's unfinished expense reports, so a saved draft can be resumed. */
export function TravelExpenseReportDrafts() {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.draftReports(),
		queryFn: async () => {
			const result = await getMyDraftTravelExpenseReports();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	if (isError && !data) {
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.report.errors.loadDrafts",
					"Unable to load your draft expenses. Please retry.",
				)}
				retry={() => {
					void refetch();
				}}
				isRetrying={isFetching}
			/>
		);
	}
	if (!data || data.length === 0) return null;

	return (
		<section aria-labelledby="travel-expense-drafts" className="space-y-2">
			<h2 id="travel-expense-drafts" className="text-lg font-semibold">
				{t("travelExpenses.report.drafts.title", "Drafts in progress")}
			</h2>
			<Card>
				<CardContent className="p-0">
					<ul className="divide-y">
						{data.map((draft) => (
							<li key={draft.id}>
								<Link
									href={`/travel-expenses/reports/${draft.id}`}
									className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium">
											{draft.description ??
												t("travelExpenses.report.drafts.untitled", "Untitled receipt")}
										</p>
										<p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
											<span>
												{draft.expenseDate
													? formatPlainDate(locale, draft.expenseDate)
													: t("travelExpenses.report.drafts.noDate", "No date yet")}
											</span>
											{draft.receiptCount > 0 && (
												<span className="flex items-center gap-1">
													<IconPaperclip aria-hidden="true" className="size-3.5" />
													{t(
														"travelExpenses.report.drafts.receipts",
														"{count, plural, one {# receipt} other {# receipts}}",
														{
															count: draft.receiptCount,
														},
													)}
												</span>
											)}
										</p>
									</div>
									{draft.amount && draft.currency && (
										<span className="tabular-nums">
											{formatMoney(locale, draft.amount, draft.currency)}
										</span>
									)}
									<Badge variant="secondary">{t("travelExpenses.status.draft", "Draft")}</Badge>
									<IconChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
								</Link>
							</li>
						))}
					</ul>
				</CardContent>
			</Card>
		</section>
	);
}
