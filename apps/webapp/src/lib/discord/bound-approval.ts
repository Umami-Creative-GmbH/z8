import type { BotInvocationEnvelope } from "@/lib/bot-platform/approval-decision";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SNOWFLAKE_PATTERN = /^\d{1,20}$/;
const CUSTOM_ID_LIMIT = 100;

/**
 * Bound card button `custom_id`. It carries only the opaque reviewed-binding
 * handle; neither it nor the source message is proof of authority, reviewed
 * facts or invocation identity.
 */
interface BoundApprovalCustomIdData {
	a: "ba" | "br";
	b: string;
}

export function encodeBoundApprovalCustomId(
	action: "approve" | "reject",
	bindingId: string,
): string {
	const data: BoundApprovalCustomIdData = {
		a: action === "approve" ? "ba" : "br",
		b: bindingId,
	};
	const encoded = JSON.stringify(data);
	if (!UUID_PATTERN.test(bindingId) || encoded.length > CUSTOM_ID_LIMIT) {
		throw new Error("Bound approval custom_id is invalid");
	}
	return encoded;
}

export function parseBoundApprovalCustomId(
	customId: string,
): { action: "approve" | "reject"; bindingId: string } | null {
	let value: unknown;
	try {
		value = JSON.parse(customId);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 2) return null;
	if ((record.a !== "ba" && record.a !== "br") || typeof record.b !== "string") return null;
	if (!UUID_PATTERN.test(record.b)) return null;
	return { action: record.a === "ba" ? "approve" : "reject", bindingId: record.b };
}

/**
 * The receiving application's scope, `discord-app:<application id>`. Invocation
 * identity and delivered-message identity use the same scope; it never
 * contains a token or secret.
 */
export function discordReceiverScope(applicationId: string): string | null {
	return SNOWFLAKE_PATTERN.test(applicationId) ? `discord-app:${applicationId}` : null;
}

/**
 * Invocation identity per #261: the top-level `interaction.id`, scoped to the
 * installation's application. The route verified the Ed25519 signature with
 * that installation's public key; an interaction for any other application is
 * refused. Component `custom_id` and the source message ID never stand in for
 * it. Discord has no transport delivery ID. Without identity, sender or a
 * matching application there is no invocation, and the action falls back to
 * authenticated review.
 */
export function discordInvocationEnvelope(
	applicationId: string,
	interaction: {
		id?: string;
		application_id?: string;
		member?: { user?: { id?: string } };
		user?: { id?: string };
	},
): BotInvocationEnvelope | null {
	const receiverScope = discordReceiverScope(applicationId);
	if (!receiverScope || interaction.application_id !== applicationId) return null;
	const invocationId = interaction.id;
	if (typeof invocationId !== "string" || !SNOWFLAKE_PATTERN.test(invocationId)) return null;
	const actorId = interaction.member?.user?.id ?? interaction.user?.id;
	if (typeof actorId !== "string" || !SNOWFLAKE_PATTERN.test(actorId)) return null;
	return {
		scheme: "discord_interaction",
		receiverScope,
		invocationId,
		deliveryId: null,
		providerActorId: actorId,
	};
}
