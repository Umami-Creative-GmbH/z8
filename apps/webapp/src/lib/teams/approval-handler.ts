import type { Activity, TurnContext } from "botbuilder";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamsApprovalCard } from "@/db/schema";
import { env } from "@/env";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import {
	type ApprovalDeliveryMessageRecord,
	approvalDeliveryMessageReviewReference,
	findApprovalDeliveryMessageByRemoteIdentity,
	isApprovalNotificationDeliveredByOwner,
	isApprovalDeliveryMessagePending,
	markApprovalDeliveryMessageWithoutControls,
} from "@/lib/approvals/delivery/store";
import {
	type ApprovalActionableCard,
	type ApprovalCardDraft,
	prepareApprovalPresentation,
} from "@/lib/approvals/presentation";
import type { BoundBotApprovalResult } from "@/lib/bot-platform/approval-decision";
import {
	type ApprovalNotice,
	approvalAttemptNotice,
	boundDecisionNotice,
	teamsApprovalNotice,
} from "@/lib/bot-platform/approval-notice";
import { type BotTranslateFn, getBotTranslate } from "@/lib/bot-platform/i18n";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import {
	TEAMS_APPROVAL_VERBS,
	type TeamsBoundApprovalInvoke,
	teamsActivityTenant,
	teamsBoundActionData,
	teamsInvocationEnvelope,
	teamsReceiverScope,
} from "./bound-approval";
import type { ResolvedTeamsUser, ResolvedTenant } from "./types";
import { TeamsError } from "./types";

const logger = createLogger("TeamsApprovalHandler");

const ADAPTIVE_CARD = "application/vnd.microsoft.card.adaptive";

/**
 * Teams accepts bot messages up to about 28 KB. Essential facts must fit one
 * card; a truncated proposal never keeps its controls.
 */
const TEAMS_ACTIVITY_LIMIT_BYTES = 28_000;

/** A placeholder handle for measuring a card before a binding is issued. */
const MEASURING_BINDING_ID = "00000000-0000-4000-8000-000000000000";

export async function handleApprovalAction(
	context: TurnContext,
	approvalId: string,
	action: "approve" | "reject",
	user: ResolvedTeamsUser,
	tenant: ResolvedTenant,
): Promise<void> {
	try {
		const { attemptBotApproval } = await import("@/lib/bot-platform/approval-decision");
		const result = await attemptBotApproval({
			approvalId,
			actorEmployeeId: user.employeeId,
			organizationId: tenant.organizationId,
			action,
			platform: "teams",
		});
		// Send only the outcome of this authenticated invocation. Do not select
		// another recipient's activity via an approval-only tracking lookup.
		if (result.status !== "review_required" && result.status !== "historical") {
			await context.sendActivity("This approval is unavailable. Open Z8 to review your inbox.");
			return;
		}
		const notice = await approvalAttemptNotice(
			result,
			{ userId: user.userId, organizationId: tenant.organizationId },
			{ kind: "compatibility", approvalRequestId: approvalId },
		);
		if (!notice) return;
		await context.sendActivity(teamsNoticeActivity(notice));
	} catch (error) {
		logger.error({ error, approvalId }, "Failed to review Teams approval card");
		throw new TeamsError("Failed to review approval", "BOT_ERROR");
	}
}

/**
 * Adaptive Card text is Markdown. Request facts (names, labels) are data, so
 * the inline emphasis, code and link syntax in them is escaped rather than
 * rendered. Dates, times and zones contain none of these characters.
 */
function escapeTeamsMarkdown(value: string): string {
	return value.replace(/[\\`*_[\]~]/g, "\\$&");
}

export function teamsCardActivity(
	content: Record<string, unknown>,
	text: string,
): Partial<Activity> {
	return {
		type: "message",
		text,
		attachments: [{ contentType: ADAPTIVE_CARD, content }],
	};
}

/**
 * Bound card layout: Universal Actions (`Action.Execute`) whose data carries
 * only the binding handle, plus the exact-item review link.
 */
export function teamsActionableCard(card: ApprovalActionableCard): Record<string, unknown> {
	return {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.4",
		body: [
			{
				type: "TextBlock",
				text: escapeTeamsMarkdown(card.title),
				weight: "bolder",
				size: "medium",
				wrap: true,
			},
			{
				type: "FactSet",
				facts: card.facts.map((fact) => ({
					title: escapeTeamsMarkdown(fact.label),
					value: escapeTeamsMarkdown(fact.value),
				})),
			},
			{ type: "TextBlock", text: escapeTeamsMarkdown(card.text), wrap: true, isSubtle: true },
		],
		actions: [
			{
				type: "Action.Execute",
				title: card.approveLabel,
				verb: TEAMS_APPROVAL_VERBS.approve,
				data: teamsBoundActionData(card.bindingId),
				style: "positive",
			},
			{
				type: "Action.Execute",
				title: card.rejectLabel,
				verb: TEAMS_APPROVAL_VERBS.reject,
				data: teamsBoundActionData(card.bindingId),
				style: "destructive",
			},
			{ type: "Action.OpenUrl", title: card.reviewLabel, url: card.reviewUrl },
		],
	};
}

/** A review-only or status notice: the review link, never controls. */
export function teamsNoticeActivity(notice: ApprovalNotice): Partial<Activity> {
	return teamsCardActivity(
		teamsApprovalNotice({
			...notice,
			title: escapeTeamsMarkdown(notice.title),
			text: escapeTeamsMarkdown(notice.text),
		}),
		notice.title,
	);
}

export function teamsActionableActivity(card: ApprovalActionableCard): Partial<Activity> {
	return teamsCardActivity(teamsActionableCard(card), card.title);
}

export function fitsTeamsCard(draft: ApprovalCardDraft): boolean {
	const activity = teamsActionableActivity({ ...draft, bindingId: MEASURING_BINDING_ID });
	return new TextEncoder().encode(JSON.stringify(activity)).length <= TEAMS_ACTIVITY_LIMIT_BYTES;
}

/** Body of the HTTP response to an `adaptiveCard/action` invoke. */
export interface TeamsInvokeResponse {
	status: number;
	body: Record<string, unknown>;
}

function invokeMessage(text: string): TeamsInvokeResponse {
	return {
		status: 200,
		body: { statusCode: 200, type: "application/vnd.microsoft.activity.message", value: text },
	};
}

function invokeError(code: string, message: string): TeamsInvokeResponse {
	return {
		status: 200,
		body: { statusCode: 500, type: "application/vnd.microsoft.error", value: { code, message } },
	};
}

type Recipient = { userId: string; organizationId: string };

async function recipientTranslate(recipient: Recipient): Promise<BotTranslateFn> {
	const display = await resolveRecipientDisplayContext(recipient);
	return getBotTranslate(display?.locale ?? DEFAULT_LANGUAGE);
}

async function reviewRequiredMessage(recipient: Recipient): Promise<TeamsInvokeResponse> {
	const t = await recipientTranslate(recipient);
	return invokeMessage(t("bot.approval.reviewRequiredTitle", "Review required"));
}

/**
 * A press on a bound Teams card (#293). The recorded activity identity and
 * the card's binding go through the shared attempt into the authoritative
 * decision. The invoke response carries the attempt's outcome; it is protocol
 * handling, never evidence of commitment. Card updates are best effort and
 * cannot change a committed decision.
 */
export async function handleBoundApprovalInvoke(
	context: TurnContext,
	invoke: Exclude<TeamsBoundApprovalInvoke, { kind: "none" }>,
	user: ResolvedTeamsUser,
	tenant: ResolvedTenant,
): Promise<TeamsInvokeResponse> {
	const recipient = { userId: user.userId, organizationId: tenant.organizationId };
	if (invoke.kind === "refresh") {
		// An automatic refresh is not a click: nothing is decided or written.
		return reviewRequiredMessage(recipient);
	}
	let result: BoundBotApprovalResult = { status: "review_required" };
	if (invoke.kind === "action" && user.organizationId === tenant.organizationId) {
		try {
			const { attemptBoundBotApproval } = await import("@/lib/bot-platform/approval-decision");
			result = await attemptBoundBotApproval({
				organizationId: tenant.organizationId,
				actorEmployeeId: user.employeeId,
				actorUserId: user.userId,
				bindingId: invoke.bindingId,
				action: invoke.action,
				platform: "teams",
				invocation: teamsInvocationEnvelope(context.activity, env.MICROSOFT_APP_ID),
			});
		} catch (error) {
			// Outcome unknown: claim nothing. A retry of this recorded activity
			// replays the committed result if the decision did commit.
			logger.error({ error, bindingId: invoke.bindingId }, "Failed to decide bound Teams approval");
			const t = await recipientTranslate(recipient);
			return invokeError(
				"OutcomeUnknown",
				t(
					"bot.approval.outcomeUnknown",
					"The result of this press could not be confirmed. Check the request in Z8 before pressing again.",
				),
			);
		}
	}
	try {
		const notice = await updatePressedCard(context, result, user, tenant);
		if (notice) return invokeMessage(notice.title);
	} catch (error) {
		logger.error({ error, status: result.status }, "Failed to update bound Teams approval card");
	}
	// An untracked card: the response still reports the committed outcome.
	if (result.status === "decided" && result.evidence.assignmentId) {
		const decided = await boundDecisionNotice(result, recipient, {
			kind: "canonical",
			assignmentId: result.evidence.assignmentId,
		});
		if (decided) return invokeMessage(decided.title);
	}
	return reviewRequiredMessage(recipient);
}

/**
 * Updates the pressed card where this path is its writer and returns the
 * outcome notice. Only the recipient's own tracked card is considered.
 */
async function updatePressedCard(
	context: TurnContext,
	result: BoundBotApprovalResult,
	user: ResolvedTeamsUser,
	tenant: ResolvedTenant,
): Promise<ApprovalNotice | null> {
	const activity = context.activity;
	const conversationId = activity.conversation?.id;
	const cardActivityId = activity.replyToId;
	const tenantId = teamsActivityTenant(activity);
	if (!conversationId || !cardActivityId || tenantId !== tenant.tenantId) return null;
	const recipient = { userId: user.userId, organizationId: tenant.organizationId };
	const receiverScope = teamsReceiverScope(env.MICROSOFT_APP_ID, tenantId);
	const delivered = receiverScope
		? await findApprovalDeliveryMessageByRemoteIdentity({
				organizationId: tenant.organizationId,
				provider: "teams",
				receiverScope,
				destinationId: conversationId,
				remoteMessageId: cardActivityId,
			})
		: null;
	if (delivered && delivered.recipientUserId === user.userId) {
		return updateDeliveredBoundCard(context, result, delivered, recipient);
	}
	const tracked = await db.query.teamsApprovalCard.findFirst({
		where: and(
			eq(teamsApprovalCard.organizationId, tenant.organizationId),
			eq(teamsApprovalCard.recipientUserId, user.userId),
			eq(teamsApprovalCard.teamsConversationId, conversationId),
			eq(teamsApprovalCard.teamsActivityId, cardActivityId),
		),
	});
	if (!tracked) return null;
	const notice = await boundDecisionNotice(result, recipient, {
		kind: "compatibility",
		approvalRequestId: tracked.approvalRequestId,
	});
	if (!notice) return null;
	// Cards sent outside the delivery owner have no other writer.
	await context.updateActivity({
		...teamsNoticeActivity(notice),
		id: cardActivityId,
	});
	return notice;
}

/**
 * The pressed card was sent by the approval delivery owner. A card whose
 * assignment or request is no longer pending (for example the one just
 * decided) is left to the owner, which refreshes every message of the
 * lifecycle from the committed intent, so it has one writer. A still-pending
 * card whose action decided nothing becomes a review notice without controls.
 */
async function updateDeliveredBoundCard(
	context: TurnContext,
	result: BoundBotApprovalResult,
	message: ApprovalDeliveryMessageRecord,
	recipient: Recipient,
): Promise<ApprovalNotice | null> {
	try {
		const notice = await boundDecisionNotice(
			result,
			recipient,
			approvalDeliveryMessageReviewReference(message),
		);
		if (!notice) return null;
		if (result.status !== "decided" && (await isApprovalDeliveryMessagePending(message))) {
			await context.updateActivity({
				...teamsNoticeActivity(notice),
				id: message.remoteMessageId,
			});
			await markApprovalDeliveryMessageWithoutControls({
				organizationId: recipient.organizationId,
				messageId: message.id,
			});
		}
		return notice;
	} finally {
		kickApprovalDelivery({
			organizationId: recipient.organizationId,
			workflowId: message.workflowId,
		});
	}
}

/**
 * Whether the approval delivery owner sends this request's Teams card. Every
 * sender outside the owner (notification channel, legacy escalation) checks
 * it, so a card is never sent twice.
 */
function deliveredByApprovalOwner(approvalId: string, organizationId: string): Promise<boolean> {
	return isApprovalNotificationDeliveredByOwner({
		organizationId,
		provider: "teams",
		entityType: "approval_request",
		entityId: approvalId,
	});
}

export async function sendApprovalCardToManager(
	approvalId: string,
	approverId: string,
	organizationId: string,
): Promise<void> {
	try {
		if (await deliveredByApprovalOwner(approvalId, organizationId)) return;
		const notice = await prepareApprovalPresentation({
			approvalId,
			recipientEmployeeId: approverId,
			organizationId,
			provider: "teams",
			fits: fitsTeamsCard,
		});
		if (notice.status === "undisclosable") return;
		const { sendProactiveMessage } = await import("./bot-adapter");
		const { getConversationReferenceForUser } = await import("./conversation-manager");
		const conversation = await getConversationReferenceForUser(
			notice.recipientUserId,
			organizationId,
		);
		if (!conversation?.conversation?.id) return;
		const activityId = await sendProactiveMessage(
			conversation,
			notice.status === "actionable"
				? teamsActionableActivity(notice)
				: teamsNoticeActivity(notice),
		);
		if (activityId)
			await db.insert(teamsApprovalCard).values({
				approvalRequestId: approvalId,
				organizationId,
				recipientUserId: notice.recipientUserId,
				teamsConversationId: conversation.conversation.id,
				teamsActivityId: activityId,
				teamsMessageId: activityId,
				status: "sent",
			});
	} catch (error) {
		logger.error({ error, approvalId }, "Failed to send Teams approval notice");
	}
}
