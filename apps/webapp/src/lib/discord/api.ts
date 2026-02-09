/**
 * Discord REST API Client
 *
 * Lightweight wrapper around the Discord REST API v10 using fetch().
 * No external library needed.
 */

import { createLogger } from "@/lib/logger";
import type { DiscordActionRow, DiscordEmbed, DiscordSlashCommandDefinition } from "./types";

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
	options: {
		content?: string;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
	},
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
	options: {
		content?: string;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
	},
): Promise<boolean> {
	const result = await callApi(
		botToken,
		"PATCH",
		`/channels/${channelId}/messages/${messageId}`,
		options,
	);
	return result.ok;
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
	data?: {
		content?: string;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
		flags?: number;
	},
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
	options: {
		content?: string;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
		flags?: number;
	},
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
