import type { BotInvocationEnvelope } from "@/lib/bot-platform/approval-decision";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Universal Action verbs of a bound approval card. The action data carries
 * only the opaque reviewed-binding handle; it is never proof of authority or
 * of the facts reviewed.
 */
export const TEAMS_APPROVAL_VERBS = {
	approve: "z8.approval.approve",
	reject: "z8.approval.reject",
} as const;

export function teamsBoundActionData(bindingId: string): { b: string } {
	if (!UUID_PATTERN.test(bindingId)) throw new Error("Bound approval binding is invalid");
	return { b: bindingId };
}

/**
 * The supported callback profile (#261 §4): an `invoke` named
 * `adaptiveCard/action` for an `Action.Execute` with one of our verbs and a
 * manual trigger. An automatic refresh is never an approval click, and
 * anything else carrying our verbs is refused (review-only).
 */
export type TeamsBoundApprovalInvoke =
	| { kind: "none" }
	| { kind: "refresh" }
	| { kind: "invalid" }
	| { kind: "action"; action: "approve" | "reject"; bindingId: string };

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function parseTeamsBoundApprovalInvoke(activity: {
	type?: unknown;
	name?: unknown;
	value?: unknown;
}): TeamsBoundApprovalInvoke {
	if (activity.type !== "invoke") return { kind: "none" };
	const value = record(activity.value);
	const action = record(value?.action);
	const verb = action?.verb;
	const decision =
		verb === TEAMS_APPROVAL_VERBS.approve
			? "approve"
			: verb === TEAMS_APPROVAL_VERBS.reject
				? "reject"
				: null;
	if (!decision) return { kind: "none" };
	if (activity.name !== "adaptiveCard/action" || action?.type !== "Action.Execute") {
		return { kind: "invalid" };
	}
	if (value?.trigger === "automatic") return { kind: "refresh" };
	if (value?.trigger !== "manual") return { kind: "invalid" };
	const data = record(action.data);
	if (!data || Object.keys(data).length !== 1 || typeof data.b !== "string") {
		return { kind: "invalid" };
	}
	if (!UUID_PATTERN.test(data.b)) return { kind: "invalid" };
	return { kind: "action", action: decision, bindingId: data.b };
}

/**
 * The sending bot and tenant of a delivered Teams message. The destination
 * (conversation) and message (activity) IDs are recorded beside it.
 */
export function teamsReceiverScope(appId: string | undefined, tenantId: string): string | null {
	if (!appId || !GUID_PATTERN.test(appId) || !GUID_PATTERN.test(tenantId)) return null;
	return `teams-bot:${appId}:tenant:${tenantId}`;
}

/**
 * The Microsoft tenant of an activity. Conflicting tenant fields are never
 * resolved silently; either field alone is accepted as sent.
 */
export function teamsActivityTenant(activity: {
	conversation?: unknown;
	channelData?: unknown;
}): string | null {
	const fromConversation = record(activity.conversation)?.tenantId;
	const fromChannel = record(record(activity.channelData)?.tenant)?.id;
	const tenants = [fromConversation, fromChannel].filter((value) => value !== undefined);
	if (tenants.length === 0 || !tenants.every(nonEmpty)) return null;
	const [tenant] = tenants as string[];
	if (!tenant || tenants.some((value) => value !== tenant)) return null;
	return GUID_PATTERN.test(tenant) ? tenant : null;
}

export interface TeamsInvokeActivity {
	id?: unknown;
	channelId?: unknown;
	recipient?: unknown;
	from?: unknown;
	conversation?: unknown;
	channelData?: unknown;
}

/**
 * Invocation identity per #261: the incoming recorded activity ID, scoped by
 * the authenticated bot, Microsoft tenant, the Teams channel and the personal
 * conversation. The card message (`replyToId`) and the copied card action ID
 * identify the card, never the invocation. Without every part, the action
 * falls back to authenticated review.
 */
export function teamsInvocationEnvelope(
	activity: TeamsInvokeActivity,
	appId: string | undefined,
): BotInvocationEnvelope | null {
	if (activity.channelId !== "msteams") return null;
	if (record(activity.recipient)?.id !== `28:${appId}`) return null;
	const tenantId = teamsActivityTenant(activity);
	if (!tenantId) return null;
	const scope = teamsReceiverScope(appId, tenantId);
	const conversation = record(activity.conversation);
	const actorId = record(activity.from)?.aadObjectId;
	if (
		!scope ||
		conversation?.conversationType !== "personal" ||
		!nonEmpty(conversation.id) ||
		!nonEmpty(activity.id) ||
		!nonEmpty(actorId)
	) {
		return null;
	}
	return {
		scheme: "teams_adaptive_card_action",
		receiverScope: `${scope}:conversation:${conversation.id}`,
		invocationId: activity.id,
		deliveryId: null,
		providerActorId: actorId,
	};
}
