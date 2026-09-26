import type { BotInvocationEnvelope } from "@/lib/bot-platform/approval-decision";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOT_TOKEN_PATTERN = /^(\d+):[A-Za-z0-9_-]+$/;
const CALLBACK_DATA_LIMIT_BYTES = 64;

/**
 * Bound card button payload. It carries only the opaque reviewed-binding
 * handle; the button data is never proof of authority or reviewed facts.
 */
export interface BoundApprovalCallbackData {
	a: "ba" | "br";
	b: string;
}

export function encodeBoundApprovalCallback(
	action: "approve" | "reject",
	bindingId: string,
): string {
	const data: BoundApprovalCallbackData = {
		a: action === "approve" ? "ba" : "br",
		b: bindingId,
	};
	const encoded = JSON.stringify(data);
	if (
		!UUID_PATTERN.test(bindingId) ||
		new TextEncoder().encode(encoded).length > CALLBACK_DATA_LIMIT_BYTES
	) {
		throw new Error("Bound approval callback data is invalid");
	}
	return encoded;
}

export function parseBoundApprovalCallback(
	value: unknown,
): { action: "approve" | "reject"; bindingId: string } | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 2) return null;
	if ((record.a !== "ba" && record.a !== "br") || typeof record.b !== "string") return null;
	if (!UUID_PATTERN.test(record.b)) return null;
	return { action: record.a === "ba" ? "approve" : "reject", bindingId: record.b };
}

/**
 * The receiving bot's scope, `telegram-bot:<numeric bot id>`, derived from the
 * token. Invocation identity and delivered-message identity use the same scope.
 */
export function telegramReceiverScope(botToken: string): string | null {
	const bot = BOT_TOKEN_PATTERN.exec(botToken);
	return bot ? `telegram-bot:${bot[1]}` : null;
}

/**
 * Invocation identity per #261: the bot-scoped `callback_query.id`, with the
 * transport `update_id` kept only as delivery evidence. Without a query ID,
 * sender or recognizable bot identity there is no invocation, and the action
 * falls back to authenticated review.
 */
export function telegramInvocationEnvelope(
	botToken: string,
	query: { id?: string; from?: { id?: number } },
	updateId: number | undefined,
): BotInvocationEnvelope | null {
	const receiverScope = telegramReceiverScope(botToken);
	const invocationId = query.id;
	const actorId = query.from?.id;
	if (!receiverScope || typeof invocationId !== "string" || invocationId.trim().length === 0) {
		return null;
	}
	if (typeof actorId !== "number" || !Number.isSafeInteger(actorId)) return null;
	return {
		scheme: "telegram_callback_query",
		receiverScope,
		invocationId,
		deliveryId: Number.isSafeInteger(updateId) ? String(updateId) : null,
		providerActorId: String(actorId),
	};
}
