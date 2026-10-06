"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getTravelExpenseReportSubmission } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";
import type { SubmittedReportView } from "@/lib/travel-expenses/report-read";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { ExpenseSummaryList, TripSummaryList } from "./expense-summary-list";
import { formatRecordedInstant, ReportStatusBadge } from "./report-status";
import { ReportTotals } from "./report-summary";

const formatInstant = formatRecordedInstant;

type HistoryLabel = SubmittedReportView["history"][number]["label"];

function historyText(
	t: ReturnType<typeof useTranslate>["t"],
	label: HistoryLabel,
	name: string,
): string {
	const texts: Record<HistoryLabel, string> = {
		submitted: t("travelExpenses.report.history.submitted", "Submitted by {name}", { name }),
		approved: t("travelExpenses.report.history.approved", "Approved by {name}", { name }),
		rejected: t("travelExpenses.report.history.rejected", "Rejected by {name}", { name }),
		approval_recorded: t(
			"travelExpenses.report.history.approvalRecorded",
			"Approval recorded by {name}; awaiting further approval",
			{ name },
		),
	};
	return texts[label];
}

/**
 * The frozen submission of a report, for its owner and authorized reviewers
 * (#602). It shows exactly what was submitted; later edits, policies or
 * currency changes never alter it. Reviewers decide in the Approvals inbox.
 */
export function SubmittedTravelExpenseReport({ reportId }: { reportId: string }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { data, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.reportSubmission(reportId),
		queryFn: async (): Promise<SubmittedReportView> => {
			const result = await getTravelExpenseReportSubmission(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	if (isError && !data) {
		return (
			<TravelExpenseLoadError
				message={t(
					"travelExpenses.report.errors.loadSubmission",
					"Unable to load the submitted report. Please retry.",
				)}
				retry={() => {
					void refetch();
				}}
				isRetrying={isFetching}
			/>
		);
	}
	if (isLoading || !data) {
		return (
			<div>
				<p className="sr-only">{t("travelExpenses.report.loading", "Loading expense…")}</p>
				<Skeleton aria-hidden="true" className="h-96 w-full" />
			</div>
		);
	}

	const { facts, decision } = data;
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<ReportStatusBadge status={data.status} />
				<p className="text-sm text-muted-foreground">
					{t("travelExpenses.report.submittedAt", "Submitted {date}", {
						date: formatInstant(locale, data.submittedAt),
					})}
				</p>
			</div>
			{data.status === "submitted" && (
				<p className="text-sm">
					{data.reviewerName
						? t("travelExpenses.report.awaitingReviewer", "Waiting for review by {name}.", {
								name: data.reviewerName,
							})
						: t("travelExpenses.report.awaitingReview", "Waiting for review.")}{" "}
					{data.access === "reviewer"
						? t(
								"travelExpenses.report.decideInInbox",
								"Approve or reject the whole report in the Approvals inbox.",
							)
						: t(
								"travelExpenses.report.frozenNotice",
								"The submitted report can no longer be edited.",
							)}
				</p>
			)}
			{decision?.outcome === "rejected" && (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertTitle>
						{t("travelExpenses.report.rejectedBy", "Rejected by {name}", {
							name: decision.deciderName ?? "—",
						})}
					</AlertTitle>
					{decision.reason && <AlertDescription>{decision.reason}</AlertDescription>}
				</Alert>
			)}
			{decision?.outcome === "approved" && (
				<p className="text-sm">
					{t("travelExpenses.report.approvedBy", "Approved by {name} on {date}.", {
						name: decision.deciderName ?? "—",
						date: formatInstant(locale, decision.decidedAt),
					})}
				</p>
			)}

			{facts.trip && (
				<Card>
					<CardContent className="space-y-2 pt-6">
						<h2 className="text-lg font-semibold">
							{t("travelExpenses.report.trip.title", "Trip details")}
						</h2>
						<TripSummaryList trip={facts.trip} />
					</CardContent>
				</Card>
			)}
			<section aria-labelledby={`${reportId}-submitted-expenses`} className="space-y-3">
				<h2 id={`${reportId}-submitted-expenses`} className="text-lg font-semibold">
					{t("travelExpenses.report.items.title", "Expenses")}
				</h2>
				<ExpenseSummaryList
					items={facts.items.map((item) => ({
						id: item.itemId,
						description: item.description,
						expenseDate: item.expenseDate,
						category: item.category,
						amount: item.original.amount,
						currency: item.original.currency,
						paidBy: item.paidBy,
						receipts: item.receipts.map((receipt) => ({
							id: receipt.receiptId,
							fileName: receipt.fileName,
							href: `/api/travel-expenses/reports/${reportId}/receipts/${receipt.receiptId}`,
						})),
						mileage: item.mileage ?? null,
					}))}
				/>
			</section>
			<ReportTotals
				id={`${reportId}-submitted`}
				totals={{ ...facts.totals, excludedItemCount: 0 }}
			/>
			<section aria-labelledby={`${reportId}-history`} className="space-y-2">
				<h2 id={`${reportId}-history`} className="text-lg font-semibold">
					{t("travelExpenses.report.history.title", "History")}
				</h2>
				<ol className="space-y-1 text-sm">
					{data.history.map((event) => (
						<li key={event.id}>
							<span className="text-muted-foreground">{formatInstant(locale, event.at)}</span>{" "}
							{historyText(t, event.label, event.actorName ?? "—")}
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}
