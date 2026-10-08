"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { getTravelExpenseReportSubmission } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { queryKeys } from "@/lib/query/keys";
import type { SubmittedReportView } from "@/lib/travel-expenses/report-read";
import { SettlementPanel } from "../finance/settlement-panel";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { ExpenseSummaryList, TripSummaryList } from "./expense-summary-list";
import { formatRecordedInstant } from "./format";
import { AdjustmentNotice, ReportAdjustmentsPanel } from "./report-adjustments";
import { ReportHeader } from "./report-header";
import { ReopenedNotice, ReopenReportPanel } from "./report-reopen";
import { ReturnedNotice, SubmissionCycleLinks, WithdrawReportButton } from "./report-review-cycle";
import { ReportTotals } from "./report-summary";

const formatInstant = formatRecordedInstant;

type Translate = ReturnType<typeof useTranslate>["t"];
type HistoryEvent = SubmittedReportView["history"][number];

/** What happened in one history event, as its timeline title. */
function historyTitle(t: Translate, label: HistoryEvent["label"]): string {
	const titles: Record<HistoryEvent["label"], string> = {
		submitted: t("travelExpenses.report.history.step.submitted", "Submitted"),
		approval_recorded: t(
			"travelExpenses.report.history.step.approvalRecorded",
			"Approval recorded",
		),
		approved: t("travelExpenses.report.history.step.approved", "Approved"),
		self_approved: t("travelExpenses.report.history.step.selfApproved", "Approved automatically"),
		rejected: t("travelExpenses.report.history.step.rejected", "Rejected"),
		returned: t("travelExpenses.report.history.step.returned", "Returned for changes"),
		withdrawn: t("travelExpenses.report.history.step.withdrawn", "Withdrawn"),
		reopened: t("travelExpenses.report.history.step.reopened", "Reopened for correction"),
	};
	return titles[label];
}

/** Who acted (and, across several submissions, in which one) under a timeline title. */
function historyDetail(t: Translate, event: HistoryEvent, showCycle: boolean): string {
	const actor =
		event.label === "self_approved"
			? t(
					"travelExpenses.report.history.detail.selfApproved",
					"Nobody else could review this report.",
				)
			: event.label === "approval_recorded"
				? t(
						"travelExpenses.report.history.detail.approvalRecorded",
						"By {name}; awaiting further approval.",
						{ name: event.actorName ?? "—" },
					)
				: t("travelExpenses.report.history.detail.by", "By {name}", {
						name: event.actorName ?? "—",
					});
	return showCycle
		? t("travelExpenses.report.history.detail.inCycle", "Submission {number} · {detail}", {
				number: event.cycle,
				detail: actor,
			})
		: actor;
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
	const [firstItem] = data.facts.items;
	return (
		<div className="space-y-4">
			<ReportHeader
				source={{
					kind: data.facts.reportKind,
					itemType: data.facts.reportKind === "trip" ? null : (firstItem?.type ?? null),
					title: data.facts.trip ? data.facts.trip.purpose : (firstItem?.description ?? null),
				}}
				status={data.status}
			/>
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

/** Submission date and, for the owner of a pending submission, the withdraw button. */
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
	if (decision?.outcome === "approved" && decision.basis === "owner_no_other_reviewer") {
		return (
			<p className="text-sm">
				{t(
					"travelExpenses.report.selfApprovedOn",
					"Approved automatically on {date}: this is the organization owner's report, and nobody else could review it.",
					{ date: formatInstant(locale, decision.decidedAt) },
				)}
			</p>
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
			<CardHeader>
				<h2 className="font-semibold leading-none">
					{t("travelExpenses.report.trip.title", "Trip details")}
				</h2>
			</CardHeader>
			<CardContent>
				<TripSummaryList trip={trip} />
			</CardContent>
		</Card>
	);
}

/** The submitted expenses with their receipts of this submission cycle. */
function SubmittedExpenses({ reportId, data }: { reportId: string; data: SubmittedReportView }) {
	const { t } = useTranslate();
	return (
		<section aria-labelledby={`${reportId}-submitted-expenses`}>
			<Card>
				<CardHeader>
					<h2 id={`${reportId}-submitted-expenses`} className="font-semibold leading-none">
						{t("travelExpenses.report.items.title", "Expenses")}
					</h2>
				</CardHeader>
				<CardContent>
					<ExpenseSummaryList
						items={data.facts.items.map((item) => ({
							id: item.itemId,
							type: item.type,
							// A per diem freezes a fixed description; its title already names it.
							description: item.type === "per_diem" ? null : item.description,
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
				</CardContent>
			</Card>
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
			{/* Not limited by access: the panel shows itself to finance and the owner only,
			    including a reviewer who also has finance permission. */}
			<SettlementPanel source={{ type: "report", id: reportId }} />
			{access !== "owner" && <ReopenReportPanel reportId={reportId} />}
			{access === "owner" && <ReportAdjustmentsPanel reportId={reportId} />}
		</>
	);
}

/**
 * The report's history across its submission cycles as a timeline. While the
 * latest submission waits for review, that review is the current step;
 * otherwise the latest event is.
 */
function SubmissionHistory({ reportId, data }: { reportId: string; data: SubmittedReportView }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const awaitingReview = data.status === "submitted";
	const lastIndex = data.history.length - 1;
	return (
		<Card>
			<CardHeader>
				<h2 id={`${reportId}-history`} className="font-semibold leading-none">
					{t("travelExpenses.report.history.title", "History")}
				</h2>
				<CardDescription>
					{t(
						"travelExpenses.report.history.description",
						"Every step of this report, oldest first. Times are shown in UTC.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Timeline aria-labelledby={`${reportId}-history`}>
					{data.history.map((event, index) => (
						<TimelineItem
							key={event.id}
							state={index === lastIndex && !awaitingReview ? "current" : "done"}
							title={historyTitle(t, event.label)}
							time={formatInstant(locale, event.at)}
							dateTime={event.at}
						>
							{historyDetail(t, event, data.latestCycle > 1)}
						</TimelineItem>
					))}
					{awaitingReview && (
						<TimelineItem
							state="current"
							title={t("travelExpenses.report.history.inReview", "In review")}
						>
							{data.reviewerName
								? t("travelExpenses.report.awaitingReviewer", "Waiting for review by {name}.", {
										name: data.reviewerName,
									})
								: t("travelExpenses.report.awaitingReview", "Waiting for review.")}
						</TimelineItem>
					)}
				</Timeline>
			</CardContent>
		</Card>
	);
}
