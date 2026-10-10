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
import { systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { readApprovalAuthoritySnapshot } from "../authority";
import { loadCover } from "../deputy/covering-store";
import { isDeputyDecisionEntityType } from "../deputy/deputy-decision";
import { legacyDecidedEarlierStage, loadEmployeeName } from "../deputy/deputy-decision-store";
import {
	type ApprovalActionableCard,
	type ApprovalCardDraft,
	type ApprovalCardFact,
	type ApprovalCardTarget,
	type ApprovalReviewSummary,
	prepareAbsenceReviewSummary,
	prepareBoundAbsenceCard,
	prepareBoundLegacyAbsenceCard,
} from "./bound-card";
import { readTimeRequestAuthority } from "../evidence/legacy-time";
import { approvalReviewUrl } from "./review-navigation";
import { isTimeApprovalWorkflowType } from "../time-approval-kinds";
import {
	prepareBoundLegacyTimeCard,
	prepareBoundTimeCard,
	prepareTimeReviewSummary,
} from "./time-card";
import { prepareBoundTravelExpenseCard } from "./travel-expense-card";
import { prepareBoundTravelExpenseReportCard } from "./travel-expense-report-card";

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
 * legacy-authoritative expense claim (#296), absence (#384, Telegram only) or
 * time approval (#432, Telegram only) one bound to the exact legacy request and
 * its submitted revision; everything else stays review-only.
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
	/**
	 * A deputy card (#1017): the absent approver X the recipient covers for. The
	 * approval must still be X's, the recipient must cover for X now, and the
	 * card names X and is bound to the recipient and X's assignment.
	 */
	actingForEmployeeId?: string | null;
}): Promise<
	| ApprovalReviewNotice
	| ApprovalActionableCard
	| ApprovalReviewSummary
	| { status: "undisclosable" }
> {
	const actingFor = input.actingForEmployeeId ?? null;
	const approverEmployeeId = actingFor ?? input.recipientEmployeeId;
	const request = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.approverId, approverEmployeeId),
			eq(approvalRequest.status, "pending"),
		),
		columns: { id: true, metadata: true, entityType: true, requestedBy: true },
	});
	if (!request) return { status: "undisclosable" };
	const coveringFor = actingFor
		? await deputyCardCover({
				organizationId: input.organizationId,
				approvalRequestId: request.id,
				entityType: request.entityType,
				requesterEmployeeId: request.requestedBy,
				approverEmployeeId: actingFor,
				deputyEmployeeId: input.recipientEmployeeId,
			})
		: null;
	if (actingFor && !coveringFor) return { status: "undisclosable" };
	// Under legacy absence authority the pending legacy request is the
	// authority; a shadow/ready observation mirroring it is never consulted
	// (#384).
	const legacyAbsence =
		request.entityType === "absence_entry" &&
		(
			await readApprovalAuthoritySnapshot(db, {
				organizationId: input.organizationId,
				workflowType: "absence",
			})
		).authority === "legacy";
	// Likewise for a time request whose cycle has a legacy revision of a kind
	// with legacy authority (#432).
	const legacyTime =
		Boolean(input.provider) &&
		request.entityType === "time_entry" &&
		(await readTimeRequestAuthority(db, {
			organizationId: input.organizationId,
			approvalRequestId: request.id,
		})) === "legacy";
	// A compatibility representative is not proof that its former assignee
	// still owns the current canonical stage. Never broaden this into management
	// authority merely because the recipient also happens to be a manager.
	const stages = legacyAbsence || legacyTime
		? []
		: await db.query.approvalWorkflowStage.findMany({
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
				eq(approvalStageAssignment.approverEmployeeId, approverEmployeeId),
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
			...(actingFor ? { actingForEmployeeId: actingFor } : {}),
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
	// A deputy card names the absent approver first; provider limits count it.
	const coveringFact = coveringFor
		? {
				label: t("bot.approval.card.coveringFor", "Covering for"),
				value: coveringFor.approverName,
			}
		: null;
	const withCover = <T extends { facts: ApprovalCardFact[] }>(card: T): T =>
		coveringFact ? { ...card, facts: [coveringFact, ...card.facts] } : card;
	const providerFits = input.fits;
	const fits = providerFits
		? { fits: (draft: ApprovalCardDraft) => providerFits(withCover(draft)) }
		: {};
	const deputy = actingFor ? { actingForEmployeeId: actingFor } : {};
	if (input.provider && canonicalTarget) {
		const cardInput = {
			target: canonicalTarget,
			provider: input.provider,
			approvalRequestId: request.id,
			recipientUserId: recipient.userId,
			display,
			t,
			...fits,
		};
		const card = canonicalTimeKind
			? await prepareBoundTimeCard(db, cardInput)
			: await prepareBoundAbsenceCard(db, cardInput);
		if (card) return withCover(card);
		if (input.summary) {
			const summaryFits = input.summary.fits;
			const summaryInput = {
				target: canonicalTarget,
				approvalRequestId: request.id,
				recipientUserId: recipient.userId,
				display,
				t,
				fits: (summary: ApprovalReviewSummary) => summaryFits(withCover(summary)),
			};
			const summary = canonicalTimeKind
				? await prepareTimeReviewSummary(db, summaryInput)
				: await prepareAbsenceReviewSummary(db, summaryInput);
			if (summary) return withCover(summary);
		}
	} else if (input.provider && legacyAbsence) {
		// Legacy-authoritative absences bind the exact legacy request (#384).
		const card = await prepareBoundLegacyAbsenceCard(db, {
			organizationId: input.organizationId,
			approvalRequestId: request.id,
			recipientEmployeeId: input.recipientEmployeeId,
			recipientUserId: recipient.userId,
			provider: input.provider,
			display,
			t,
			...fits,
			...deputy,
		});
		if (card) return withCover(card);
	} else if (input.provider && legacyTime) {
		// Legacy-authoritative time approvals bind the exact legacy request (#432).
		const card = await prepareBoundLegacyTimeCard(db, {
			organizationId: input.organizationId,
			approvalRequestId: request.id,
			recipientEmployeeId: input.recipientEmployeeId,
			recipientUserId: recipient.userId,
			provider: input.provider,
			display,
			t,
			...fits,
			...deputy,
		});
		if (card) return withCover(card);
	} else if (input.provider && request.entityType === "travel_expense_claim") {
		// Legacy-authoritative expense claims bind the exact legacy request (#296).
		// Claims are never a deputy kind, so no deputy card reaches here.
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
	} else if (input.provider && request.entityType === "travel_expense_report") {
		// Expense reports bind the exact legacy request of their current cycle (#623).
		const card = await prepareBoundTravelExpenseReportCard(db, {
			organizationId: input.organizationId,
			approvalRequestId: request.id,
			recipientEmployeeId: input.recipientEmployeeId,
			recipientUserId: recipient.userId,
			provider: input.provider,
			display,
			t,
			...fits,
			...deputy,
		});
		if (card) return withCover(card);
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

/**
 * Whether a deputy card (#1017) may be shown: the approval is of a deputy kind,
 * not the deputy's own request (#697), the deputy covers for the approver now,
 * and did not decide an earlier stage of the same request (four-eyes). Returns
 * the approver's display name, or null when no deputy card may be shown.
 */
async function deputyCardCover(input: {
	organizationId: string;
	approvalRequestId: string;
	entityType: string;
	requesterEmployeeId: string | null;
	approverEmployeeId: string;
	deputyEmployeeId: string;
}): Promise<{ approverName: string } | null> {
	if (!isDeputyDecisionEntityType(input.entityType)) return null;
	if (
		input.requesterEmployeeId === input.deputyEmployeeId ||
		input.approverEmployeeId === input.deputyEmployeeId
	) {
		return null;
	}
	const cover = await loadCover(db, {
		organizationId: input.organizationId,
		approverId: input.approverEmployeeId,
		deputyId: input.deputyEmployeeId,
		at: systemClock.nowInstant(),
	});
	if (!cover) return null;
	if (
		await legacyDecidedEarlierStage(db, {
			organizationId: input.organizationId,
			approvalRequestId: input.approvalRequestId,
			actorEmployeeId: input.deputyEmployeeId,
		})
	) {
		return null;
	}
	const approverName = await loadEmployeeName(db, {
		organizationId: input.organizationId,
		employeeId: input.approverEmployeeId,
	});
	return approverName ? { approverName } : null;
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
