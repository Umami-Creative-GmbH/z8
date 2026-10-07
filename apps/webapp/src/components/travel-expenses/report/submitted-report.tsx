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
import { SettlementPanel } from "../finance/settlement-panel";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { ExpenseSummaryList, TripSummaryList } from "./expense-summary-list";
import { formatRecordedInstant } from "./format";
import { AdjustmentNotice, ReportAdjustmentsPanel } from "./report-adjustments";
import { ReopenedNotice, ReopenReportPanel } from "./report-reopen";
import { ReturnedNotice, SubmissionCycleLinks, WithdrawReportButton } from "./report-review-cycle";
import { ReportStatusBadge } from "./report-status";
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
		returned: t("travelExpenses.report.history.returned", "Returned for changes by {name}", {
			name,
		}),
		withdrawn: t("travelExpenses.report.history.withdrawn", "Withdrawn by {name}", { name }),
		reopened: t("travelExpenses.report.history.reopened", "Reopened for correction by {name}", {
			name,
		}),
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
export function SubmittedTravelExpenseReport({
	reportId,
	cycle,
}: {
	reportId: string;
	/** An earlier submission cycle to show (#603); the latest when omitted. */
	cycle?: number;
}) {
	const { t } = useTranslate();
	const { data, isLoading, isFetching, isError, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.reportSubmission(reportId, cycle),
		queryFn: async (): Promise<SubmittedReportView> => {
			const result = await getTravelExpenseReportSubmission(reportId, cycle);
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

	const latest = data.submissionCycle === data.latestCycle;
	return (
		<div className="space-y-4">
			<SubmissionHeading reportId={reportId} data={data} latest={latest} />
			<SubmissionNotices reportId={reportId} data={data} latest={latest} />
			<DecisionNotice decision={data.decision} />

			{data.facts.trip && <SubmittedTrip trip={data.facts.trip} />}
			<SubmittedExpenses reportId={reportId} data={data} />
			<ReportTotals
				id={`${reportId}-submitted`}
				totals={{ ...data.facts.totals, excludedItemCount: 0 }}
			/>
			{latest && data.status === "approved" && (
				<ApprovedReportPanels reportId={reportId} access={data.access} />
			)}
			<SubmissionHistory reportId={reportId} data={data} />
			{data.cycles.length > 1 && (
				<SubmissionCycleLinks
					reportId={reportId}
					cycles={data.cycles}
					current={data.submissionCycle}
				/>
			)}
		</div>
	);
}

/** Status, submission date and, for the owner of a pending submission, the withdraw button. */
function SubmissionHeading({
	reportId,
	data,
	latest,
}: {
	reportId: string;
	data: SubmittedReportView;
	latest: boolean;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<div className="flex flex-wrap items-center gap-2">
			{latest && <ReportStatusBadge status={data.status} />}
			<p className="text-sm text-muted-foreground">
				{data.latestCycle > 1
					? t("travelExpenses.report.submissionNumberAt", "Submission {number}, submitted {date}", {
							number: data.submissionCycle,
							date: formatInstant(locale, data.submittedAt),
						})
					: t("travelExpenses.report.submittedAt", "Submitted {date}", {
							date: formatInstant(locale, data.submittedAt),
						})}
			</p>
			{data.access === "owner" && latest && data.status === "submitted" && (
				<div className="ml-auto">
					<WithdrawReportButton reportId={reportId} submissionCycle={data.submissionCycle} />
				</div>
			)}
		</div>
	);
}

/** Where this submission stands: earlier cycle, returned, reopened, withdrawn or in review. */
function SubmissionNotices({
	reportId,
	data,
	latest,
}: {
	reportId: string;
	data: SubmittedReportView;
	latest: boolean;
}) {
	const { t } = useTranslate();
	return (
		<>
			{data.access === "owner" && <AdjustmentNotice reportId={reportId} />}
			{!latest && (
				<p className="text-sm">
					{t(
						"travelExpenses.report.earlierSubmission",
						"This is an earlier submission of the report, kept exactly as it was submitted.",
					)}
				</p>
			)}
			{data.returned && <ReturnedNotice returned={data.returned} />}
			{data.reopened && <ReopenedNotice reopened={data.reopened} />}
			{data.cycleOutcome === "withdrawn" && (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.withdrawnSubmission",
						"This submission was withdrawn before a decision.",
					)}
				</p>
			)}
			{latest && data.status === "submitted" && <AwaitingReviewNotice data={data} />}
		</>
	);
}

/** Who the pending submission waits for and what the viewer can do meanwhile. */
function AwaitingReviewNotice({ data }: { data: SubmittedReportView }) {
	const { t } = useTranslate();
	return (
		<p className="text-sm">
			{data.reviewerName
				? t("travelExpenses.report.awaitingReviewer", "Waiting for review by {name}.", {
						name: data.reviewerName,
					})
				: t("travelExpenses.report.awaitingReview", "Waiting for review.")}{" "}
			{data.access === "reviewer"
				? t(
						"travelExpenses.report.decideInInbox",
						"Approve, return or reject the whole report in the Approvals inbox.",
					)
				: t("travelExpenses.report.frozenNotice", "The submitted report can no longer be edited.")}
		</p>
	);
}

/** The final decision on this submission, if any. */
function DecisionNotice({ decision }: { decision: SubmittedReportView["decision"] }) {
	const { t } = useTranslate();
	const locale = useLocale();
	if (decision?.outcome === "rejected") {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle aria-hidden="true" className="size-4" />
				<AlertTitle>
					{t("travelExpenses.report.rejectedBy", "Rejected by {name}", {
						name: decision.deciderName ?? "—",
					})}
				</AlertTitle>
				{decision.reason && <AlertDescription>{decision.reason}</AlertDescription>}
			</Alert>
		);
	}
	if (decision?.outcome === "approved") {
		return (
			<p className="text-sm">
				{t("travelExpenses.report.approvedBy", "Approved by {name} on {date}.", {
					name: decision.deciderName ?? "—",
					date: formatInstant(locale, decision.decidedAt),
				})}
			</p>
		);
	}
	return null;
}

/** The submitted trip details. */
function SubmittedTrip({ trip }: { trip: NonNullable<SubmittedReportView["facts"]["trip"]> }) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardContent className="space-y-2 pt-6">
				<h2 className="text-lg font-semibold">
					{t("travelExpenses.report.trip.title", "Trip details")}
				</h2>
				<TripSummaryList trip={trip} />
			</CardContent>
		</Card>
	);
}

/** The submitted expenses with their receipts of this submission cycle. */
function SubmittedExpenses({ reportId, data }: { reportId: string; data: SubmittedReportView }) {
	const { t } = useTranslate();
	return (
		<section aria-labelledby={`${reportId}-submitted-expenses`} className="space-y-3">
			<h2 id={`${reportId}-submitted-expenses`} className="text-lg font-semibold">
				{t("travelExpenses.report.items.title", "Expenses")}
			</h2>
			<ExpenseSummaryList
				items={data.facts.items.map((item) => ({
					id: item.itemId,
					description: item.perDiem
						? t("travelExpenses.report.perDiem.title", "Per diem")
						: item.description,
					expenseDate: item.expenseDate,
					category: item.category,
					amount: item.original.amount,
					currency: item.original.currency,
					paidBy: item.paidBy,
					conversion: item.conversion,
					project: item.project,
					receipts: item.receipts.map((receipt) => ({
						id: receipt.receiptId,
						fileName: receipt.fileName,
						href: `/api/travel-expenses/reports/${reportId}/receipts/${receipt.receiptId}?cycle=${data.submissionCycle}`,
					})),
					mileage: item.mileage ?? null,
					perDiem: item.perDiem ?? null,
					receiptException: item.receiptException ?? null,
					allowanceOverride: item.allowanceOverride ?? null,
				}))}
			/>
		</section>
	);
}

/** After approval: the settlement, reopening for reviewers, the owner's adjustments. */
function ApprovedReportPanels({
	reportId,
	access,
}: {
	reportId: string;
	access: SubmittedReportView["access"];
}) {
	return (
		<>
			{access !== "reviewer" && <SettlementPanel source={{ type: "report", id: reportId }} />}
			{access !== "owner" && <ReopenReportPanel reportId={reportId} />}
			{access === "owner" && <ReportAdjustmentsPanel reportId={reportId} />}
		</>
	);
}

/** The report's history across its submission cycles. */
function SubmissionHistory({ reportId, data }: { reportId: string; data: SubmittedReportView }) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<section aria-labelledby={`${reportId}-history`} className="space-y-2">
			<h2 id={`${reportId}-history`} className="text-lg font-semibold">
				{t("travelExpenses.report.history.title", "History")}
			</h2>
			<ol className="space-y-1 text-sm">
				{data.history.map((event) => (
					<li key={event.id}>
						<span className="text-muted-foreground">{formatInstant(locale, event.at)}</span>{" "}
						{data.latestCycle > 1 &&
							`${t("travelExpenses.report.history.cycle", "Submission {number}:", {
								number: event.cycle,
							})} `}
						{historyText(t, event.label, event.actorName ?? "—")}
					</li>
				))}
			</ol>
		</section>
	);
}
