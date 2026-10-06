"use client";

import { IconAlertTriangle, IconLoader2, IconSend } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type SubmitTravelExpenseReportOutcome,
	submitTravelExpenseReportAction,
} from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { receiptReportTotals } from "@/lib/travel-expenses/receipt-report";
import type { ReportView } from "@/lib/travel-expenses/report-store";
import { ExpenseSummaryList, TripSummaryList } from "./expense-summary-list";
import { ReportTotals } from "./report-summary";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Why the report cannot be reviewed for submission yet; null when it can. */
export type SubmitBlocker = "incomplete" | "unsaved" | null;

function outcomeMessage(
	t: Translate,
	outcome: Exclude<SubmitTravelExpenseReportOutcome, { status: "submitted" }>,
): { title: string; body: string } {
	switch (outcome.status) {
		case "changed_since_review":
			return {
				title: t("travelExpenses.report.submit.changedTitle", "The report changed"),
				body: t(
					"travelExpenses.report.submit.changed",
					"The report changed after you reviewed it. Close this dialog, check your entries and review it again.",
				),
			};
		case "incomplete":
			return {
				title: t("travelExpenses.report.submit.incompleteTitle", "The report is incomplete"),
				body: t(
					"travelExpenses.report.submit.incomplete",
					"Some saved details are still missing. Complete everything listed under “Still needed” and try again.",
				),
			};
		case "no_reviewer":
			return {
				title: t(
					"travelExpenses.report.submit.noReviewerTitle",
					"No one can review this report yet",
				),
				body:
					outcome.reason === "requester_inactive"
						? t(
								"travelExpenses.report.submit.requesterInactive",
								"Your employee profile is not active in this organization, so the report cannot be routed for review.",
							)
						: t(
								"travelExpenses.report.submit.noReviewer",
								"You have no manager or team manager other than yourself, and no expense approver is set up. Ask an administrator to assign one. Your report stays saved as a draft.",
							),
			};
		case "self_approval_route":
			return {
				title: t(
					"travelExpenses.report.submit.noReviewerTitle",
					"No one can review this report yet",
				),
				body: t(
					"travelExpenses.report.submit.selfApproval",
					"Your organization's approval rules would let you approve your own report. Ask an administrator to adjust them. Your report stays saved as a draft.",
				),
			};
		case "routing_failed":
			return {
				title: t("travelExpenses.report.submit.routingTitle", "The report could not be routed"),
				body: t(
					"travelExpenses.report.submit.routing",
					"Your organization's approval rules could not find a reviewer. Ask an administrator to check them. Your report stays saved as a draft.",
				),
			};
		case "threshold_currency_unsupported":
			return {
				title: t("travelExpenses.report.submit.routingTitle", "The report could not be routed"),
				body: t(
					"travelExpenses.report.submit.thresholdCurrency",
					"Your organization's approval rules compare amounts in EUR, but this report is in {currency}. Ask an administrator to check them. Your report stays saved as a draft.",
					{ currency: outcome.currency },
				),
			};
		case "authority_unsupported":
			return {
				title: t("travelExpenses.report.submit.unavailableTitle", "Submission is paused"),
				body: t(
					"travelExpenses.report.submit.unavailable",
					"Your organization is changing how expense approvals work, so reports cannot be submitted right now. Your report stays saved as a draft.",
				),
			};
	}
}

/**
 * Submission review step of a draft report (#602): the employee checks the
 * saved expenses, receipts and totals, then sends that exact version for
 * approval. Unsaved or incomplete entries are never presented as submittable.
 */
export function SubmitReportPanel({
	reportId,
	blocker,
	loadSavedReport,
	onSubmitted,
}: {
	reportId: string;
	blocker: SubmitBlocker;
	/**
	 * Reloads the saved report; null when what the employee sees is not saved
	 * yet, so the review never shows (or submits) anything else.
	 */
	loadSavedReport: () => Promise<ReportView | null>;
	onSubmitted: () => Promise<unknown>;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [report, setReport] = useState<ReportView | null>(null);
	const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
	const totals = report ? receiptReportTotals(report.items, report.reimbursementCurrency) : null;

	async function openReview() {
		setProblem(null);
		setLoading(true);
		try {
			const saved = await loadSavedReport();
			if (!saved) {
				toast.error(
					t(
						"travelExpenses.report.submit.notSaved",
						"Some changes are not saved yet. Wait for them to save, then review the report again.",
					),
				);
				return;
			}
			setReport(saved);
			setOpen(true);
		} catch {
			toast.error(
				t("travelExpenses.report.errors.load", "Unable to load this expense. Please retry."),
			);
		} finally {
			setLoading(false);
		}
	}

	async function submit() {
		if (!report) return;
		setSubmitting(true);
		setProblem(null);
		try {
			const result = await submitTravelExpenseReportAction({
				reportId: report.id,
				reviewed: {
					detailsVersion: report.kind === "trip" ? (report.trip?.version ?? null) : null,
					items: report.items.map((item) => ({
						id: item.id,
						version: item.version,
						receiptIds: item.receipts.map((receipt) => receipt.id),
					})),
				},
			});
			if (!result.success) {
				setProblem({
					title: t("travelExpenses.report.submit.failedTitle", "The report was not submitted"),
					body: result.error,
				});
				return;
			}
			if (result.data.status !== "submitted") {
				setProblem(outcomeMessage(t, result.data));
				return;
			}
			toast.success(t("travelExpenses.report.submit.success", "Report submitted for approval"));
			setOpen(false);
			await onSubmitted();
		} catch {
			setProblem({
				title: t("travelExpenses.report.submit.failedTitle", "The report was not submitted"),
				body: t(
					"travelExpenses.report.submit.failed",
					"Something went wrong. Your report is still saved as a draft; please retry.",
				),
			});
		} finally {
			setSubmitting(false);
		}
	}

	const blockedHint =
		blocker === "incomplete"
			? t(
					"travelExpenses.report.submit.blockedIncomplete",
					"Complete everything listed under “Still needed” before submitting.",
				)
			: blocker === "unsaved"
				? t(
						"travelExpenses.report.submit.blockedUnsaved",
						"Wait until all changes are saved, or correct the highlighted fields, before submitting.",
					)
				: t(
						"travelExpenses.report.submit.ready",
						"Your entries are saved. Review the report and send it for approval.",
					);
	const hintId = `${reportId}-submit-hint`;

	return (
		<section className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
			<p id={hintId} className="text-sm text-muted-foreground">
				{blockedHint}
			</p>
			<Button
				type="button"
				disabled={blocker !== null || loading}
				aria-describedby={hintId}
				onClick={() => void openReview()}
			>
				{loading ? (
					<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
				) : (
					<IconSend aria-hidden="true" className="mr-2 size-4" />
				)}
				{t("travelExpenses.report.submit.review", "Review and submit")}
			</Button>
			<Dialog open={open && report !== null} onOpenChange={(next) => !submitting && setOpen(next)}>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{t("travelExpenses.report.submit.title", "Submit expense report")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"travelExpenses.report.submit.description",
								"Check the saved report. Your reviewer decides on exactly this version; it cannot be edited while it is being reviewed.",
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						{report?.trip && <TripSummaryList trip={report.trip} />}
						<ExpenseSummaryList
							items={(report?.items ?? []).map((item) => ({
								id: item.id,
								description: item.description,
								expenseDate: item.expenseDate,
								category: item.category,
								amount: item.amount,
								currency: item.currency,
								paidBy: item.paidBy,
								receipts: item.receipts.map((receipt) => ({
									id: receipt.id,
									fileName: receipt.fileName,
								})),
							}))}
						/>
						{totals && <ReportTotals id={`${reportId}-review`} totals={totals} />}
						{problem && (
							<Alert variant="destructive" role="alert">
								<IconAlertTriangle aria-hidden="true" className="size-4" />
								<AlertTitle>{problem.title}</AlertTitle>
								<AlertDescription>{problem.body}</AlertDescription>
							</Alert>
						)}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={submitting}
							onClick={() => setOpen(false)}
						>
							{t("travelExpenses.report.submit.cancel", "Keep editing")}
						</Button>
						<Button type="button" disabled={submitting} onClick={() => void submit()}>
							{submitting && (
								<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
							)}
							{t("travelExpenses.report.submit.confirm", "Submit for approval")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
