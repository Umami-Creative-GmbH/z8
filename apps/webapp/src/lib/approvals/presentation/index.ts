import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
} from "@/db/schema";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";

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
 * Early truthfulness cutover. Existing unbound cards have no provable submitted
 * revision. Do not load live names, categories, projects, receipts or endpoints
 * to stand in for that history. Admission of evidenced summaries belongs to the
 * later presentation/evidence slice, not a platform-specific fallback.
 * Infrastructure failures propagate; lack of entitlement discloses nothing.
 */
export async function prepareApprovalPresentation(input: {
	approvalId: string;
	recipientEmployeeId: string;
	organizationId: string;
}): Promise<ApprovalReviewNotice | { status: "undisclosable" }> {
	const request = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.approverId, input.recipientEmployeeId),
			eq(approvalRequest.status, "pending"),
		),
		columns: { id: true, metadata: true },
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
			columns: { id: true },
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
		// Existing authenticated inbox only; this is not an exact-item deep link.
		reviewUrl: `${getDefaultAppBaseUrl()}/approvals/inbox`,
	};
}

export {
	type AbsenceReviewEvidence,
	buildAbsenceReviewSections,
	prepareAbsenceReviewEvidence,
} from "./absence-review";
