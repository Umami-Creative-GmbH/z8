import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	type ApprovalPresentationProvider,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
} from "@/db/schema";
import { type BotTranslateFn, getBotTranslate } from "@/lib/bot-platform/i18n";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
	formatPlainDate,
} from "@/lib/datetime/temporal-format";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { readApprovalPresentationMode } from "../evidence/invocation";
import type { PeriodSubmissionSubmittedRevisionRecord } from "../evidence/store";
import { issueReviewBinding, loadPeriodSubmissionSubmittedRevision } from "../evidence/store";
import type {
	ApprovalActionableCard,
	ApprovalCardDraft,
	ApprovalCardFact,
	ApprovalReviewSummary,
} from "./bound-card";
import { approvalReviewUrl } from "./review-navigation";

/** The exact pending assignment of a canonical-only kind a card is prepared for (#1059). */
export interface CanonicalAssignmentReference {
	workflowId: string;
	stageId: string;
	assignmentId: string;
}

export interface CanonicalOnlyReviewNotice {
	status: "review_required";
	recipientUserId: string;
	title: string;
	text: string;
	reviewLabel: string;
	reviewUrl: string;
}

function hoursAndMinutes(totalMinutes: number): string {
	return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function periodFacts(
	revision: PeriodSubmissionSubmittedRevisionRecord,
	display: DisplayContext,
	t: BotTranslateFn,
): ApprovalCardFact[] {
	const { period, work } = revision.facts;
	const start = formatPlainDate(parsePlainDate(period.startDate), display.locale, "dateMedium");
	const end = formatPlainDate(parsePlainDate(period.endDate), display.locale, "dateMedium");
	return [
		{
			label: t("bot.approval.card.employee", "Employee"),
			value: revision.labels.subjectName ?? t("bot.approval.card.unavailable", "Unavailable"),
		},
		{
			label: t("bot.approval.card.period", "Period"),
			value: period.startDate === period.endDate ? start : `${start} – ${end}`,
		},
		{
			label: t("bot.approval.card.periodTotal", "Total"),
			value: t("bot.approval.card.periodTotalHours", "{total} h", {
				total: hoursAndMinutes(work.totalMinutes),
			}),
		},
		{
			label: t("bot.approval.card.submittedAt", "Submitted"),
			value: `${formatInstant(revision.submittedAt, display, "dateTimeMedium")} (${display.timezone})`,
		},
	];
}

/**
 * The card of a period submission (#1059), keyed by its canonical assignment because the kind
 * has no legacy request (Approvals ADR-0002). Facts come only from the submitted revision.
 * With an admitted provider the card is actionable and bound to the recipient's exact pending
 * assignment and revision, as for every canonical kind; a provider that cannot decide gets the
 * facts without controls; otherwise a review-only notice. Period submissions are not a deputy
 * kind, so a deputy card is never shown.
 */
export async function prepareCanonicalOnlyPresentation(input: {
	organizationId: string;
	recipientEmployeeId: string;
	canonicalAssignment: CanonicalAssignmentReference;
	provider?: ApprovalPresentationProvider;
	fits?: (draft: ApprovalCardDraft) => boolean;
	summary?: { fits: (summary: ApprovalReviewSummary) => boolean };
	actingForEmployeeId?: string | null;
}): Promise<
	| CanonicalOnlyReviewNotice
	| ApprovalActionableCard
	| ApprovalReviewSummary
	| { status: "undisclosable" }
> {
	if (input.actingForEmployeeId) return { status: "undisclosable" };
	const reference = input.canonicalAssignment;
	const [target] = await db
		.select({
			workflowType: approvalWorkflow.workflowType,
			workflowStatus: approvalWorkflow.status,
			currentStageOrder: approvalWorkflow.currentStageOrder,
			stageOrder: approvalWorkflowStage.sequence,
			stageStatus: approvalWorkflowStage.status,
			assignmentStatus: approvalStageAssignment.status,
			approverEmployeeId: approvalStageAssignment.approverEmployeeId,
		})
		.from(approvalStageAssignment)
		.innerJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
				eq(approvalWorkflow.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.innerJoin(
			approvalWorkflowStage,
			and(
				eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
				eq(approvalWorkflowStage.organizationId, approvalStageAssignment.organizationId),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, input.organizationId),
				eq(approvalStageAssignment.id, reference.assignmentId),
				eq(approvalStageAssignment.workflowId, reference.workflowId),
				eq(approvalStageAssignment.stageId, reference.stageId),
			),
		)
		.limit(1);
	if (
		target?.workflowType !== "period_submission" ||
		target.workflowStatus !== "pending" ||
		target.stageStatus !== "pending" ||
		target.assignmentStatus !== "pending" ||
		target.currentStageOrder !== target.stageOrder ||
		target.approverEmployeeId !== input.recipientEmployeeId
	) {
		return { status: "undisclosable" };
	}
	const [recipient] = await db
		.select({ userId: employee.userId })
		.from(employee)
		.innerJoin(
			member,
			and(eq(member.userId, employee.userId), eq(member.organizationId, employee.organizationId)),
		)
		.where(
			and(
				eq(employee.id, input.recipientEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!recipient) return { status: "undisclosable" };
	const display = await resolveRecipientDisplayContext({
		userId: recipient.userId,
		organizationId: input.organizationId,
	});
	if (!display) return { status: "undisclosable" };
	const t = await getBotTranslate(display.locale);
	const reviewUrl = await approvalReviewUrl({
		organizationId: input.organizationId,
		reference: { kind: "canonical", assignmentId: reference.assignmentId },
	});
	const revision = await loadPeriodSubmissionSubmittedRevision(db, {
		organizationId: input.organizationId,
		workflowId: reference.workflowId,
	});
	const title = t("bot.approval.card.periodSubmissionTitle", "Period submission");
	if (revision && input.provider) {
		const facts = periodFacts(revision, display, t);
		const mode = await readApprovalPresentationMode(db, {
			organizationId: input.organizationId,
			workflowType: "period_submission",
			provider: input.provider,
		});
		if (mode === "actionable") {
			const draft: ApprovalCardDraft = {
				status: "actionable",
				recipientUserId: recipient.userId,
				title,
				facts,
				text: t(
					"bot.approval.card.boundHint",
					"Approve or reject decides exactly the request shown above. If it changed or was reassigned, nothing is decided and you are asked to review it in Z8.",
				),
				reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
				reviewUrl,
				approveLabel: t("bot.approval.card.approve", "Approve"),
				rejectLabel: t("bot.approval.card.reject", "Reject"),
			};
			if (!input.fits || input.fits(draft)) {
				const bindingId = await issueReviewBinding(db, {
					organizationId: input.organizationId,
					recipientEmployeeId: input.recipientEmployeeId,
					workflowId: reference.workflowId,
					stageId: reference.stageId,
					assignmentId: reference.assignmentId,
					submittedRevisionId: revision.id,
				});
				return { ...draft, bindingId };
			}
		}
		if (input.summary) {
			const summary: ApprovalReviewSummary = {
				status: "review_summary",
				recipientUserId: recipient.userId,
				title,
				facts,
				text: t(
					"bot.approval.card.reviewOnlyHint",
					"Approve or reject this request in Z8. It cannot be decided from this message.",
				),
				reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
				reviewUrl,
			};
			if (input.summary.fits(summary)) return summary;
		}
	}
	return {
		status: "review_required",
		recipientUserId: recipient.userId,
		title: t("bot.approval.reviewRequiredTitle", "Review required"),
		text: t(
			"bot.approval.reviewRequired",
			"This card cannot establish the facts originally submitted for review. Open the approval inbox in Z8 to review the request. No decision was made from this card.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl,
	};
}
