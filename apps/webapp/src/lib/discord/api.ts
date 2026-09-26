/**
 * Discord REST API Client
 *
 * Lightweight wrapper around the Discord REST API v10 using fetch().
 * No external library needed.
 */

import { createLogger } from "@/lib/logger";
import type { DiscordCallFailure } from "./delivery-outcome";
import type {
	DiscordMessagePayload,
	DiscordSlashCommandDefinition,
} from "./types";

const logger = createLogger("DiscordAPI");

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Call the Discord REST API
 */
async function callApi<T>(
	botToken: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ ok: boolean; data?: T; status: number }> {
	const url = `${DISCORD_API_BASE}${path}`;

	const response = await fetch(url, {
		method,
		headers: {
			Authorization: `Bot ${botToken}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "Unknown error");
		logger.error({ method, path, status: response.status, error: errorText }, "Discord API error");
		return { ok: false, status: response.status };
	}

	// 204 No Content
	if (response.status === 204) {
		return { ok: true, status: 204 };
	}

	const data = (await response.json()) as T;
	return { ok: true, data, status: response.status };
}

// ============================================
// MESSAGES
// ============================================

interface DiscordMessageResponse {
	id: string;
	channel_id: string;
	content?: string;
}

/**
 * Send a message to a channel
 */
export async function sendMessage(
	botToken: string,
	channelId: string,
	options: DiscordMessagePayload,
): Promise<DiscordMessageResponse | null> {
	const result = await callApi<DiscordMessageResponse>(
		botToken,
		"POST",
		`/channels/${channelId}/messages`,
		options,
	);
	return result.data ?? null;
}

/**
 * Edit an existing message
 */
export async function editMessage(
	botToken: string,
	channelId: string,
	messageId: string,
	options: DiscordMessagePayload,
): Promise<boolean> {
	const result = await callApi(
		botToken,
		"PATCH",
		`/channels/${channelId}/messages/${messageId}`,
		options,
	);
	return result.ok;
}

const DELIVERY_CALL_TIMEOUT_MS = 30_000;

export type DiscordCallOutcome<T> = { kind: "ok"; result: T } | DiscordCallFailure;

function errorCode(body: unknown): number | null {
	if (typeof body !== "object" || body === null || !("code" in body)) return null;
	const code = (body as { code: unknown }).code;
	return typeof code === "number" && Number.isSafeInteger(code) ? code : null;
}

/**
 * Call the REST API and report exactly what is known about the outcome.
 * Unlike `callApi`, a thrown or timed-out request is reported as `unknown`
 * (Discord may have processed it) instead of propagating, so durable delivery
 * can classify it explicitly.
 */
async function callApiWithOutcome<T>(
	botToken: string,
	method: string,
	path: string,
	body: unknown,
	isResult: (value: unknown) => value is T,
): Promise<DiscordCallOutcome<T>> {
	let response: Response;
	let text: string;
	try {
		// The body is read inside the timeout on every status; failures are classified from it below.
		// react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
		response = await fetch(`${DISCORD_API_BASE}${path}`, {
			method,
			headers: {
				Authorization: `Bot ${botToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(DELIVERY_CALL_TIMEOUT_MS),
		});
		text = await response.text();
	} catch (error) {
		const timeout =
			error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
		logger.warn({ method, path, timeout }, "Discord API call outcome unknown");
		return { kind: "unknown", reason: timeout ? "timeout" : "network" };
	}
	let parsed: unknown = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	if (!response.ok) {
		const code = errorCode(parsed);
		logger.error({ method, path, status: response.status, code }, "Discord API error");
		return { kind: "failed", status: response.status, code };
	}
	if (!isResult(parsed)) {
		logger.error({ method, path, status: response.status }, "Invalid Discord API response");
		return { kind: "unknown", reason: "invalid_response" };
	}
	return { kind: "ok", result: parsed };
}

function isDiscordMessage(value: unknown): value is DiscordMessageResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { id?: unknown }).id === "string" &&
		typeof (value as { channel_id?: unknown }).channel_id === "string"
	);
}

function isDiscordChannel(value: unknown): value is DiscordChannel {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { id?: unknown }).id === "string" &&
		typeof (value as { type?: unknown }).type === "number"
	);
}

/** Create Message with an explicit outcome for durable delivery. */
export function sendMessageWithOutcome(
	botToken: string,
	channelId: string,
	payload: DiscordMessagePayload,
): Promise<DiscordCallOutcome<DiscordMessageResponse>> {
	return callApiWithOutcome(
		botToken,
		"POST",
		`/channels/${channelId}/messages`,
		payload,
		isDiscordMessage,
	);
}

/** Edit Message with an explicit outcome for durable delivery. */
export function editMessageWithOutcome(
	botToken: string,
	channelId: string,
	messageId: string,
	payload: DiscordMessagePayload,
): Promise<DiscordCallOutcome<DiscordMessageResponse>> {
	return callApiWithOutcome(
		botToken,
		"PATCH",
		`/channels/${channelId}/messages/${messageId}`,
		payload,
		isDiscordMessage,
	);
}

// ============================================
// DM CHANNELS
// ============================================

interface DiscordChannel {
	id: string;
	type: number;
}

/**
 * Create a DM channel with a user.
 * Discord DM channels are persistent and can be reused.
 */
export async function createDM(botToken: string, recipientId: string): Promise<string | null> {
	const result = await callApi<DiscordChannel>(botToken, "POST", "/users/@me/channels", {
		recipient_id: recipientId,
	});
	return result.data?.id ?? null;
}

const DM_CHANNEL_TYPE = 1;

/**
 * The recipient's DM channel with this bot, with an explicit outcome. Discord
 * returns the existing DM channel, so this is idempotent and sends nothing.
 * Anything but a DM channel is refused: approval cards never go to a server.
 */
export async function openDMChannelWithOutcome(
	botToken: string,
	recipientId: string,
): Promise<DiscordCallOutcome<string>> {
	const opened = await callApiWithOutcome(
		botToken,
		"POST",
		"/users/@me/channels",
		{ recipient_id: recipientId },
		isDiscordChannel,
	);
	if (opened.kind !== "ok") return opened;
	if (opened.result.type !== DM_CHANNEL_TYPE) return { kind: "unknown", reason: "invalid_response" };
	return { kind: "ok", result: opened.result.id };
}

// ============================================
// INTERACTIONS
// ============================================

/**
 * Respond to an interaction (initial response).
 * Must be called within 3 seconds of receiving the interaction.
 */
export async function createInteractionResponse(
	interactionId: string,
	interactionToken: string,
	type: number,
	data?: DiscordMessagePayload & { flags?: number },
): Promise<boolean> {
	// This endpoint does not use bot token auth - uses interaction token instead
	const url = `${DISCORD_API_BASE}/interactions/${interactionId}/${interactionToken}/callback`;

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type, data }),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "Unknown error");
		logger.error(
			{ interactionId, type, status: response.status, error: errorText },
			"Failed to create interaction response",
		);
	}

	return response.ok;
}

/**
 * Send a follow-up message after deferring an interaction.
 * Used when the initial response was DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE.
 */
export async function createFollowupMessage(
	botToken: string,
	applicationId: string,
	interactionToken: string,
	options: DiscordMessagePayload & { flags?: number },
): Promise<DiscordMessageResponse | null> {
	const result = await callApi<DiscordMessageResponse>(
		botToken,
		"POST",
		`/webhooks/${applicationId}/${interactionToken}`,
		options,
	);
	return result.data ?? null;
}

// ============================================
// SLASH COMMANDS
// ============================================

/**
 * Register global slash commands for a Discord application.
 * This overwrites all existing global commands.
 */
export async function registerGlobalCommands(
	botToken: string,
	applicationId: string,
	commands: DiscordSlashCommandDefinition[],
): Promise<boolean> {
	const result = await callApi(
		botToken,
		"PUT",
		`/applications/${applicationId}/commands`,
		commands,
	);

	if (result.ok) {
		logger.info(
			{ applicationId, commandCount: commands.length },
			"Discord slash commands registered",
		);
	}

	return result.ok;
}

// ============================================
// APPLICATION INFO
// ============================================

interface DiscordApplication {
	id: string;
	name: string;
	verify_key: string;
}

/**
 * Get application info (verify bot token is valid).
 * Returns the application ID and verify key.
 */
export async function getApplicationInfo(
	botToken: string,
): Promise<{ id: string; name: string; verifyKey: string } | null> {
	const result = await callApi<DiscordApplication>(botToken, "GET", "/applications/@me");

	if (!result.data) return null;

	return {
		id: result.data.id,
		name: result.data.name,
		verifyKey: result.data.verify_key,
	};
}
