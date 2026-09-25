import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	type ApprovalPresentationProvider,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
} from "@/db/schema";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import {
	type ApprovalActionableCard,
	type ApprovalCardDraft,
	type ApprovalCardTarget,
	type ApprovalReviewSummary,
	prepareAbsenceReviewSummary,
	prepareBoundAbsenceCard,
} from "./bound-card";
import { approvalReviewUrl } from "./review-navigation";
import {
	isTimeApprovalWorkflowType,
	prepareBoundTimeCard,
	prepareTimeReviewSummary,
} from "./time-card";
import { prepareBoundTravelExpenseCard } from "./travel-expense-card";

const logger = createLogger("ApprovalPresentation");

export interface ApprovalReviewNotice {
	status: "review_required";
	recipientUserId: string;
	title: string;
	text: string;
	reviewLabel: string;
	reviewUrl: string;
}

/**
 * Early truthfulness cutover. Unbound cards have no provable submitted
 * revision. Do not load live names, categories, projects, receipts or endpoints
 * to stand in for that history. With an explicit, admitted provider a canonical
 * absence gets an evidence-backed card bound to the recipient's exact
 * assignment and submitted revision (#290), as does a canonical manual time
 * submission, policy clock-out or time correction (#325), and a
 * legacy-authoritative expense claim one bound to the exact legacy request and
 * its frozen submission (#296); everything else stays review-only.
 * Infrastructure failures propagate; lack of entitlement discloses nothing.
 */
export async function prepareApprovalPresentation(input: {
	approvalId: string;
	recipientEmployeeId: string;
	organizationId: string;
	/** Only a provider passed here can ever receive an actionable card. */
	provider?: ApprovalPresentationProvider;
	/** The provider's limits for an actionable card (e.g. message length). */
	fits?: (draft: ApprovalCardDraft) => boolean;
	/**
	 * A provider that cannot decide may show the submitted facts without
	 * controls (#294), within its own limits; otherwise it gets a notice.
	 */
	summary?: { fits: (summary: ApprovalReviewSummary) => boolean };
}): Promise<
	| ApprovalReviewNotice
	| ApprovalActionableCard
	| ApprovalReviewSummary
	| { status: "undisclosable" }
> {
	const request = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.approverId, input.recipientEmployeeId),
			eq(approvalRequest.status, "pending"),
		),
		columns: { id: true, metadata: true, entityType: true },
	});
	if (!request) return { status: "undisclosable" };
	// A compatibility representative is not proof that its former assignee
	// still owns the current canonical stage. Never broaden this into management
	// authority merely because the recipient also happens to be a manager.
	const stages = await db.query.approvalWorkflowStage.findMany({
		where: and(
			eq(approvalWorkflowStage.organizationId, input.organizationId),
			eq(approvalWorkflowStage.legacyApprovalRequestId, request.id),
		),
		columns: { id: true, workflowId: true, sequence: true, status: true },
		limit: 2,
	});
	let canonicalTarget: ApprovalCardTarget | null = null;
	let canonicalTimeKind = false;
	if (stages.length > 0) {
		const stage = stages[0];
		if (stages.length !== 1 || stage.status !== "pending")
			return { status: "undisclosable" };
		const workflow = await db.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.id, stage.workflowId),
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.status, "pending"),
				eq(approvalWorkflow.currentStageOrder, stage.sequence),
			),
			columns: { id: true, workflowType: true },
		});
		if (!workflow) return { status: "undisclosable" };
		const assignment = await db.query.approvalStageAssignment.findFirst({
			where: and(
				eq(approvalStageAssignment.organizationId, input.organizationId),
				eq(approvalStageAssignment.workflowId, workflow.id),
				eq(approvalStageAssignment.stageId, stage.id),
				eq(
					approvalStageAssignment.approverEmployeeId,
					input.recipientEmployeeId,
				),
				eq(approvalStageAssignment.status, "pending"),
			),
			columns: { id: true },
		});
		if (!assignment) return { status: "undisclosable" };
		canonicalTimeKind = isTimeApprovalWorkflowType(workflow.workflowType);
		canonicalTarget = {
			organizationId: input.organizationId,
			recipientEmployeeId: input.recipientEmployeeId,
			workflowId: workflow.id,
			stageId: stage.id,
			assignmentId: assignment.id,
		};
	} else if (request.metadata?.workflow || request.metadata?.stage) {
		return { status: "undisclosable" };
	}
	const recipient = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.recipientEmployeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.isActive, true),
		),
		columns: { userId: true },
	});
	if (!recipient) return { status: "undisclosable" };
	const membership = await db.query.member.findFirst({
		where: and(
			eq(member.userId, recipient.userId),
			eq(member.organizationId, input.organizationId),
		),
		columns: { id: true },
	});
	if (!membership) return { status: "undisclosable" };
	const display = await resolveRecipientDisplayContext({
		userId: recipient.userId,
		organizationId: input.organizationId,
	});
	if (!display) return { status: "undisclosable" };
	const t = await getBotTranslate(display.locale);
	if (input.provider && canonicalTarget) {
		const cardInput = {
			target: canonicalTarget,
			provider: input.provider,
			approvalRequestId: request.id,
			recipientUserId: recipient.userId,
			display,
			t,
			...(input.fits ? { fits: input.fits } : {}),
		};
		const card = canonicalTimeKind
			? await prepareBoundTimeCard(db, cardInput)
			: await prepareBoundAbsenceCard(db, cardInput);
		if (card) return card;
		if (input.summary) {
			const summaryInput = {
				target: canonicalTarget,
				approvalRequestId: request.id,
				recipientUserId: recipient.userId,
				display,
				t,
				fits: input.summary.fits,
			};
			const summary = canonicalTimeKind
				? await prepareTimeReviewSummary(db, summaryInput)
				: await prepareAbsenceReviewSummary(db, summaryInput);
			if (summary) return summary;
		}
	} else if (input.provider && request.entityType === "travel_expense_claim") {
		// Legacy-authoritative expense claims bind the exact legacy request (#296).
		const card = await prepareBoundTravelExpenseCard(db, {
			organizationId: input.organizationId,
			approvalRequestId: request.id,
			recipientEmployeeId: input.recipientEmployeeId,
			recipientUserId: recipient.userId,
			provider: input.provider,
			display,
			t,
			...(input.fits ? { fits: input.fits } : {}),
		});
		if (card) return card;
	}
	logger.warn(
		{
			approvalId: input.approvalId,
			organizationId: input.organizationId,
			condition: "unbound_review_required",
		},
		"Approval card requires authenticated review",
	);
	return {
		status: "review_required",
		recipientUserId: recipient.userId,
		title: t("bot.approval.reviewRequiredTitle", "Review required"),
		text: t(
			"bot.approval.reviewRequired",
			"This card cannot establish the facts originally submitted for review. Open the approval inbox in Z8 to review the request. No decision was made from this card.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		// Exact item; possession of the link is not authority. Arrival rechecks
		// membership and current entitlement before loading any facts.
		reviewUrl: await approvalReviewUrl({
			organizationId: input.organizationId,
			reference: { kind: "compatibility", approvalRequestId: request.id },
		}),
	};
}

export type {
	ApprovalActionableCard,
	ApprovalCardDraft,
	ApprovalCardFact,
	ApprovalReviewSummary,
} from "./bound-card";
export {
	type AbsenceReviewEvidence,
	buildAbsenceReviewSections,
	prepareAbsenceReviewEvidence,
} from "./absence-review";
