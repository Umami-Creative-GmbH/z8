"use client";

import { IconAlertTriangle, IconLoader2, IconSend } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
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
import { appliedConversion } from "@/lib/travel-expenses/currency-conversion";
import { effectiveItemProject } from "@/lib/travel-expenses/project-attribution";
import { receiptReportTotals } from "@/lib/travel-expenses/receipt-report";
import { referenceRateReviewKey } from "@/lib/travel-expenses/reference-rate-conversion";
import type { ReportView } from "@/lib/travel-expenses/report-store";
import { reviewedItemAmount } from "@/lib/travel-expenses/report-submission";
import type { TripReportMissingRequirements } from "@/lib/travel-expenses/trip-report";
import { Link } from "@/navigation";
import type { ExpenseProjectSummary } from "./expense-project-line";
import { type ExpenseSummary, ExpenseSummaryList, TripSummaryList } from "./expense-summary-list";
import { futureDateLabel, perDiemNotReturnedLabel, tripNotEndedLabel } from "./future-date-labels";
import { itemTitle } from "./item-title";
import { pendingReceiptException } from "./pending-receipt-exception";
import { AdjustmentDeltaPreview } from "./report-adjustments";
import { ReportTotals } from "./report-summary";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Why the report cannot be reviewed for submission yet; null when it can. */
export type SubmitBlocker = "incomplete" | "unsaved" | null;

/** Where an administrator chooses the expense approver (#679). */
const EXPENSE_APPROVER_SETTING_HREF = "/settings/travel-expenses";

interface Problem {
	title: string;
	body: string;
	/** What exactly is still needed, when the server names it. */
	details?: string[];
	/** A link the submitter can act on themselves. */
	action?: { href: string; label: string };
}

/**
 * The future-dated dates and returns the server refused (#685), named even
 * when the editor's clock had not caught up with them yet.
 */
function futureDateRefusals(
	t: Translate,
	locale: string,
	report: ReportView,
	missing: TripReportMissingRequirements,
): string[] {
	const details = missing.trip.includes("trip_not_ended")
		? [tripNotEndedLabel(t, locale, report.trip?.endDate ?? null)]
		: [];
	const indexById = new Map(report.items.map((item, index) => [item.id, index]));
	for (const { id, missing: itemMissing } of missing.items) {
		const index = indexById.get(id);
		if (index === undefined) continue;
		const item = report.items[index];
		const label = itemMissing.includes("per_diem_not_returned")
			? perDiemNotReturnedLabel(t, locale, item.perDiem?.itinerary ?? null)
			: itemMissing.includes("future_date")
				? futureDateLabel(t, locale, item.expenseDate)
				: null;
		if (!label) continue;
		details.push(
			report.items.length > 1
				? t("travelExpenses.report.submit.itemRequirement", "{item}: {requirement}", {
						item: itemTitle(t, item.type, index + 1),
						requirement: label,
					})
				: label,
		);
	}
	return details;
}

function outcomeMessage(
	t: Translate,
	outcome: Exclude<SubmitTravelExpenseReportOutcome, { status: "submitted" | "self_approved" }>,
	context: { locale: string; report: ReportView },
): Problem {
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
				details: futureDateRefusals(t, context.locale, context.report, outcome.missing),
			};
		case "project_ineligible":
			return {
				title: t("travelExpenses.report.submit.projectTitle", "A project cannot be used"),
				body: t(
					"travelExpenses.report.submit.project",
					"{count, plural, one {One expense is} other {# expenses are}} attributed to a project you were not assigned to on the expense date. Choose another project, or ask an expense administrator for an attribution exception. Your report stays saved as a draft.",
					{ count: outcome.itemIds.length },
				),
			};
		case "no_reviewer": {
			const title = t(
				"travelExpenses.report.submit.noReviewerTitle",
				"No one can review this report yet",
			);
			if (outcome.reason === "requester_inactive") {
				return {
					title,
					body: t(
						"travelExpenses.report.submit.requesterInactive",
						"Your employee profile is not active in this organization, so the report cannot be routed for review.",
					),
				};
			}
			return outcome.canAssignApprover
				? {
						title,
						body: t(
							"travelExpenses.report.submit.noReviewerAssign",
							"You have no manager or team manager other than yourself, and no expense approver is set up. Choose an expense approver under Expense report review in the travel expense settings. Your report stays saved as a draft.",
						),
						action: {
							href: EXPENSE_APPROVER_SETTING_HREF,
							label: t(
								"travelExpenses.report.submit.openApproverSetting",
								"Open expense approver setting",
							),
						},
					}
				: {
						title,
						body: t(
							"travelExpenses.report.submit.noReviewerAsk",
							"You have no manager or team manager other than yourself, and no expense approver is set up. Ask an administrator to choose an expense approver under Settings, Travel expenses, Expense report review. Your report stays saved as a draft.",
						),
					};
		}
		case "self_approval_blocked":
			return {
				title: t(
					"travelExpenses.report.submit.noReviewerTitle",
					"No one can review this report yet",
				),
				body: t(
					"travelExpenses.report.submit.selfApprovalBlocked",
					"As the organization owner, your reports are approved automatically while nobody else can review them. This report has a missing-receipt explanation or a manually set allowance, which someone else must accept. Choose an expense approver, or change the report. Your report stays saved as a draft.",
				),
				action: {
					href: EXPENSE_APPROVER_SETTING_HREF,
					label: t(
						"travelExpenses.report.submit.openApproverSetting",
						"Open expense approver setting",
					),
				},
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
		case "adjustment_unavailable":
			if (outcome.reason === "source_superseded") {
				return {
					title: t(
						"travelExpenses.report.submit.adjustmentTitle",
						"This adjustment cannot be submitted",
					),
					body: t(
						"travelExpenses.report.submit.adjustmentSuperseded",
						"Another adjustment of the same report was approved after you started this one, and this copy does not include that correction. Start a new adjustment from the original report so both corrections are kept.",
					),
				};
			}
			return {
				title: t("travelExpenses.report.submit.adjustmentTitle", "This adjustment cannot be submitted"),
				body: t(
					"travelExpenses.report.submit.adjustment",
					"The report this adjustment corrects is no longer approved in this currency, so no signed difference can be calculated. Your adjustment stays saved as a draft.",
				),
			};
	}
}

/** The project an expense will be submitted under, with its current name (#605, #617). */
function reviewedProject(
	report: ReportView | null,
	item: ReportView["items"][number],
): ExpenseProjectSummary | undefined {
	if (!report) return undefined;
	const effective = effectiveItemProject(report, item);
	const named = effective ? report.projectNames?.[effective.projectId] : undefined;
	if (!effective || !named) return undefined;
	return { ...named, inheritedFromTrip: effective.inheritedFromTrip };
}

/** One saved expense as the submission review lists it. */
function reviewedSummary(report: ReportView, item: ReportView["items"][number]): ExpenseSummary {
	return {
		id: item.id,
		type: item.type,
		description: item.description ?? item.mileage?.route ?? null,
		expenseDate: item.expenseDate,
		category: item.category,
		amount: item.amount ?? item.mileage?.amount ?? item.perDiem?.amount ?? null,
		currency: item.currency ?? item.mileage?.currency ?? item.perDiem?.currency ?? null,
		paidBy: item.paidBy,
		conversion: appliedConversion(item, report.reimbursementCurrency, item.conversion),
		receipts: item.receipts.map((receipt) => ({
			id: receipt.id,
			fileName: receipt.fileName,
		})),
		mileage: item.mileage?.calculation?.status === "calculated" ? item.mileage.calculation : null,
		perDiem: item.perDiem?.calculation?.status === "calculated" ? item.perDiem.calculation : null,
		receiptException: pendingReceiptException(item),
		project: reviewedProject(report, item),
		// An applying administrator override (#610) is what the expense counts.
		allowanceOverride: [item.mileage?.override, item.perDiem?.override].find(
			(override) => override?.applies,
		),
	};
}

/** What the submit button's hint tells the employee. */
function submitHint(t: Translate, blocker: SubmitBlocker): string {
	switch (blocker) {
		case "incomplete":
			return t(
				"travelExpenses.report.submit.blockedIncomplete",
				"Complete everything listed under “Still needed” before submitting.",
			);
		case "unsaved":
			return t(
				"travelExpenses.report.submit.blockedUnsaved",
				"Wait until all changes are saved, or correct the highlighted fields, before submitting.",
			);
		default:
			return t(
				"travelExpenses.report.submit.ready",
				"Your entries are saved. Review the report and send it for approval.",
			);
	}
}

/** Why the last submission attempt was refused. */
function SubmitProblemAlert({ problem }: { problem: Problem }) {
	return (
		<Alert variant="destructive" role="alert">
			<IconAlertTriangle aria-hidden="true" className="size-4" />
			<AlertTitle>{problem.title}</AlertTitle>
			<AlertDescription>
				<p>{problem.body}</p>
				{problem.details && problem.details.length > 0 && (
					<ul className="list-disc space-y-1 pl-5">
						{problem.details.map((detail) => (
							<li key={detail}>{detail}</li>
						))}
					</ul>
				)}
				{problem.action && (
					<Link className="font-medium underline underline-offset-4" href={problem.action.href}>
						{problem.action.label}
					</Link>
				)}
			</AlertDescription>
		</Alert>
	);
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
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [report, setReport] = useState<ReportView | null>(null);
	const [problem, setProblem] = useState<Problem | null>(null);
	const totals = report ? receiptReportTotals(report.items, report.reimbursementCurrency) : null;

	async function openReview() {
		setProblem(null);
		setLoading(true);
		// No `finally` here or in submit: the React Compiler cannot compile try
		// statements with one.
		try {
			const saved = await loadSavedReport();
			if (saved) {
				setReport(saved);
				setOpen(true);
			} else {
				toast.error(
					t(
						"travelExpenses.report.submit.notSaved",
						"Some changes are not saved yet. Wait for them to save, then review the report again.",
					),
				);
			}
		} catch {
			toast.error(
				t("travelExpenses.report.errors.load", "Unable to load this expense. Please retry."),
			);
		}
		setLoading(false);
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
						receiptExceptionVersion: item.receiptException.version,
						referenceRate: referenceRateReviewKey(item.conversion),
						amount: reviewedItemAmount(item, report.reimbursementCurrency),
					})),
				},
			});
			if (!result.success) {
				setProblem({
					title: t("travelExpenses.report.submit.failedTitle", "The report was not submitted"),
					body: result.error,
				});
			} else if (result.data.status === "submitted" || result.data.status === "self_approved") {
				toast.success(
					result.data.status === "self_approved"
						? t(
								"travelExpenses.report.submit.selfApproved",
								"Report approved automatically: nobody else can review it",
							)
						: t("travelExpenses.report.submit.success", "Report submitted for approval"),
				);
				setOpen(false);
				await onSubmitted();
			} else {
				setProblem(outcomeMessage(t, result.data, { locale, report }));
			}
		} catch {
			setProblem({
				title: t("travelExpenses.report.submit.failedTitle", "The report was not submitted"),
				body: t(
					"travelExpenses.report.submit.failed",
					"Something went wrong. Your report is still saved as a draft; please retry.",
				),
			});
		}
		setSubmitting(false);
	}

	const hintId = `${reportId}-submit-hint`;

	return (
		<section className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
			<p id={hintId} className="text-sm text-muted-foreground">
				{submitHint(t, blocker)}
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
							items={report ? report.items.map((item) => reviewedSummary(report, item)) : []}
						/>
						{totals && <ReportTotals id={`${reportId}-review`} totals={totals} />}
						{totals && (
							<AdjustmentDeltaPreview
								reportId={reportId}
								corrected={{ amount: totals.reimbursable, currency: totals.currency }}
							/>
						)}
						{problem && <SubmitProblemAlert problem={problem} />}
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
