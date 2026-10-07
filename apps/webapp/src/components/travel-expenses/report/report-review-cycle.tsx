"use client";

import { IconArrowBackUp, IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { getTravelExpenseReportSubmission } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { withdrawTravelExpenseReportAction } from "@/app/[locale]/(app)/travel-expenses/report-review-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { TravelExpenseReportItemType } from "@/db/schema/travel-expense";
import { queryKeys } from "@/lib/query/keys";
import type { SubmittedCycleOutcome, SubmittedReportView } from "@/lib/travel-expenses/report-read";
import { Link } from "@/navigation";
import { TravelExpenseLoadError } from "../travel-expense-load-error";
import { formatRecordedInstant } from "./format";
import { itemTitle, removedItemTitle } from "./item-title";
import { ReopenedNotice } from "./report-reopen";

type Translate = ReturnType<typeof useTranslate>["t"];

function outcomeText(t: Translate, outcome: SubmittedCycleOutcome): string {
	const texts: Record<SubmittedCycleOutcome, string> = {
		pending: t("travelExpenses.report.cycles.pending", "awaiting review"),
		approved: t("travelExpenses.report.cycles.approved", "approved"),
		rejected: t("travelExpenses.report.cycles.rejected", "rejected"),
		returned: t("travelExpenses.report.cycles.returned", "returned for changes"),
		withdrawn: t("travelExpenses.report.cycles.withdrawn", "withdrawn"),
		reopened: t("travelExpenses.report.cycles.reopened", "approved, then reopened for correction"),
	};
	return texts[outcome];
}

type ItemComment = NonNullable<SubmittedReportView["returned"]>["itemComments"][number];

/**
 * What a returned-item note is about. The note is numbered by the frozen
 * cycle, but the owner's editor numbers its live items (#688): there it names
 * the live item's current title, or "{type} (removed)" once it is removed.
 */
function commentLabel(
	t: Translate,
	comment: ItemComment,
	liveItems: readonly LiveItem[] | undefined,
): string {
	const index = liveItems?.findIndex((item) => item.id === comment.itemId) ?? -1;
	const live = liveItems?.[index];
	if (liveItems && !live) {
		return t("travelExpenses.report.returnedRemovedItem", "{item}, {description}:", {
			item: removedItemTitle(t, comment.type),
			description: comment.description,
		});
	}
	const item = live
		? itemTitle(t, live.type, index + 1)
		: itemTitle(t, comment.type, comment.number);
	// A per diem freezes a fixed description; its title already names it.
	return comment.type === "per_diem"
		? t("travelExpenses.report.summary.itemPrefix", "{item}:", { item })
		: t("travelExpenses.report.returnedItemNamed", "{item} ({description}):", {
				item,
				description: comment.description,
			});
}

/** An expense item of the report as the owner currently edits it, in position order. */
export type LiveItem = { id: string; type: TravelExpenseReportItemType };

/** The reviewer's note and item comments of a returned submission (#603). */
export function ReturnedNotice({
	returned,
	liveItems,
}: {
	returned: NonNullable<SubmittedReportView["returned"]>;
	/** The owner editor's live items; omitted where the frozen cycle numbering applies. */
	liveItems?: readonly LiveItem[];
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<Alert className="border-amber-500/50 bg-amber-50/60 dark:border-amber-400/40 dark:bg-amber-950/20">
			<IconArrowBackUp aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t("travelExpenses.report.returnedBy", "Returned for changes by {name} on {date}", {
					name: returned.reviewerName ?? "—",
					date: formatRecordedInstant(locale, returned.returnedAt),
				})}
			</AlertTitle>
			<AlertDescription className="space-y-2">
				<p className="whitespace-pre-line">{returned.note}</p>
				{returned.itemComments.length > 0 && (
					<ul className="list-disc space-y-1 pl-5">
						{returned.itemComments.map((comment) => (
							<li key={comment.itemId}>
								<span className="font-medium">{commentLabel(t, comment, liveItems)}</span>{" "}
								<span className="whitespace-pre-line">{comment.body}</span>
							</li>
						))}
					</ul>
				)}
			</AlertDescription>
		</Alert>
	);
}

/** Links to every frozen submission of a report; the shown one is marked. */
export function SubmissionCycleLinks({
	reportId,
	cycles,
	current,
}: {
	reportId: string;
	cycles: SubmittedReportView["cycles"];
	current: number | null;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	if (cycles.length === 0) return null;
	return (
		<section aria-labelledby={`${reportId}-cycles`} className="space-y-2">
			<h2 id={`${reportId}-cycles`} className="text-lg font-semibold">
				{t("travelExpenses.report.cycles.title", "Submissions")}
			</h2>
			<ol className="space-y-1 text-sm">
				{cycles.map((cycle) => {
					const label = t(
						"travelExpenses.report.cycles.entry",
						"Submission {number} on {date}: {outcome}",
						{
							number: cycle.cycle,
							date: formatRecordedInstant(locale, cycle.submittedAt),
							outcome: outcomeText(t, cycle.outcome),
						},
					);
					return (
						<li key={cycle.cycle}>
							{cycle.cycle === current ? (
								<span aria-current="page" className="font-medium">
									{label}
								</span>
							) : (
								<Link
									className="text-primary underline underline-offset-4 hover:text-primary/80"
									href={`/travel-expenses/reports/${reportId}?cycle=${cycle.cycle}`}
								>
									{label}
								</Link>
							)}
						</li>
					);
				})}
			</ol>
		</section>
	);
}

/**
 * The employee takes a pending submission back to an editable draft (#603).
 * Its review actions expire; the submission stays in the report's history.
 */
export function WithdrawReportButton({
	reportId,
	submissionCycle,
}: {
	reportId: string;
	submissionCycle: number;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);

	async function withdraw() {
		setPending(true);
		// No `finally`: the React Compiler cannot compile try statements with one.
		try {
			const result = await withdrawTravelExpenseReportAction({ reportId, submissionCycle });
			if (!result.success) {
				toast.error(
					t(
						"travelExpenses.report.withdraw.failed",
						"The report could not be withdrawn. Please retry.",
					),
				);
			} else {
				if (result.data.status === "not_pending") {
					toast.error(
						t(
							"travelExpenses.report.withdraw.notPending",
							"This submission was already decided or returned, so it can no longer be withdrawn.",
						),
					);
				} else {
					toast.success(
						t("travelExpenses.report.withdraw.done", "Report withdrawn. You can edit it again."),
					);
				}
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.report(reportId) }),
					queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.history() }),
				]);
			}
		} catch {
			toast.error(
				t(
					"travelExpenses.report.withdraw.failed",
					"The report could not be withdrawn. Please retry.",
				),
			);
		}
		setPending(false);
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="outline" disabled={pending}>
					{pending ? (
						<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
					) : (
						<IconArrowBackUp aria-hidden="true" className="mr-2 size-4" />
					)}
					{t("travelExpenses.report.withdraw.action", "Withdraw report")}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("travelExpenses.report.withdraw.title", "Withdraw this report?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"travelExpenses.report.withdraw.description",
							"The review stops and the report becomes an editable draft again. This submission stays in the report's history.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={() => void withdraw()}>
						{t("travelExpenses.report.withdraw.confirm", "Withdraw")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * What happened to the earlier submissions of a report the employee is editing
 * again (#603): the reviewer's note and comments after a return, and links to
 * every frozen submission. Renders nothing for a report never submitted.
 */
export function ReportReviewFeedback({
	reportId,
	submissionCount,
	liveItems,
}: {
	reportId: string;
	submissionCount: number;
	/** The report's items as edited now, so returned-item notes name them as the editor does. */
	liveItems: readonly LiveItem[];
}) {
	const { t } = useTranslate();
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.reportSubmission(reportId),
		queryFn: async (): Promise<SubmittedReportView> => {
			const result = await getTravelExpenseReportSubmission(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: submissionCount > 0,
	});
	if (submissionCount === 0) return null;
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
	if (!data) return null;
	return (
		<div className="space-y-4">
			{data.returned ? (
				<ReturnedNotice returned={data.returned} liveItems={liveItems} />
			) : data.cycleOutcome === "withdrawn" ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.withdrawnNotice",
						"You withdrew submission {number}. Submit the report again when it is ready.",
						{ number: data.submissionCycle },
					)}
				</p>
			) : null}
			{data.reopened && <ReopenedNotice reopened={data.reopened} />}
			{(data.returned || data.reopened) && (
				<p className="text-sm text-muted-foreground">
					{t(
						"travelExpenses.report.correctAndResubmit",
						"Correct the report and submit it again. Earlier submissions stay in its history.",
					)}
				</p>
			)}
			<SubmissionCycleLinks reportId={reportId} cycles={data.cycles} current={null} />
		</div>
	);
}
