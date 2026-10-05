"use client";

import {
	IconChevronRight,
	IconPaperclip,
	IconPlaneDeparture,
	IconReceipt,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	getMyDraftTravelExpenseReports,
	getMySubmittedTravelExpenseReports,
} from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { queryKeys } from "@/lib/query/keys";
import type { DraftReportSummary } from "@/lib/travel-expenses/report-store";
import { Link } from "@/navigation";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "./format";

function StatusBadge({ status }: { status: DraftReportSummary["status"] }) {
	const { t } = useTranslate();
	switch (status) {
		case "draft":
			return <Badge variant="secondary">{t("travelExpenses.status.draft", "Draft")}</Badge>;
		case "submitted":
			return (
				<Badge variant="outline">
					{t("travelExpenses.report.status.submitted", "Awaiting review")}
				</Badge>
			);
		case "approved":
			return <Badge>{t("travelExpenses.report.status.approved", "Approved")}</Badge>;
		case "rejected":
			return (
				<Badge variant="destructive">{t("travelExpenses.report.status.rejected", "Rejected")}</Badge>
			);
	}
}

/**
 * The employee's unfinished trips and receipts, so a saved draft can be
 * resumed, or their submitted reports with each review status (#602).
 */
export function TravelExpenseReportDrafts({
	scope = "drafts",
}: {
	scope?: "drafts" | "submitted";
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const submitted = scope === "submitted";
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: submitted
			? queryKeys.travelExpenses.submittedReports()
			: queryKeys.travelExpenses.draftReports(),
		queryFn: async () => {
			const result = submitted
				? await getMySubmittedTravelExpenseReports()
				: await getMyDraftTravelExpenseReports();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	if (isError && !data) {
		return (
			<TravelExpenseLoadError
				message={
					submitted
						? t(
								"travelExpenses.report.errors.loadSubmitted",
								"Unable to load your submitted expense reports. Please retry.",
							)
						: t(
								"travelExpenses.report.errors.loadDrafts",
								"Unable to load your draft expenses. Please retry.",
							)
				}
				retry={() => {
					void refetch();
				}}
				isRetrying={isFetching}
			/>
		);
	}
	if (!data || data.length === 0) return null;

	return (
		<section aria-labelledby={`travel-expense-${scope}`} className="space-y-2">
			<h2 id={`travel-expense-${scope}`} className="text-lg font-semibold">
				{submitted
					? t("travelExpenses.report.submitted.title", "Submitted reports")
					: t("travelExpenses.report.drafts.title", "Drafts in progress")}
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
									{draft.trip ? (
										<>
											<IconPlaneDeparture
												aria-hidden="true"
												className="size-4 shrink-0 text-muted-foreground"
											/>
											<div className="min-w-0 flex-1">
												<p className="truncate font-medium">
													{draft.trip.purpose ??
														t("travelExpenses.report.drafts.untitledTrip", "Untitled trip")}
												</p>
												<p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
													<span>
														{formatPlainDateRange(
															locale,
															draft.trip.startDate,
															draft.trip.endDate,
														) ??
															t(
																"travelExpenses.report.drafts.noTravelDates",
																"No travel dates yet",
															)}
													</span>
													<span>
														{t(
															"travelExpenses.report.drafts.expenses",
															"{count, plural, one {# expense} other {# expenses}}",
															{ count: draft.trip.itemCount },
														)}
													</span>
												</p>
											</div>
											<span className="tabular-nums">
												{formatMoney(locale, draft.trip.reimbursable, draft.trip.currency)}
											</span>
										</>
									) : (
										<>
											<IconReceipt
												aria-hidden="true"
												className="size-4 shrink-0 text-muted-foreground"
											/>
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
										</>
									)}
									<StatusBadge status={draft.status} />
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
