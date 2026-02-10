/**
 * Telegram Bot API Client
 *
 * Lightweight wrapper around the Telegram Bot API using fetch().
 * No external library needed.
 */

import { createLogger } from "@/lib/logger";
import type {
	TelegramApiResponse,
	TelegramEditMessageParams,
	TelegramMessage,
	TelegramSendMessageParams,
} from "./types";

const logger = createLogger("TelegramAPI");

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Normalize a bot token: trim whitespace and strip accidental "bot" prefix.
 */
function normalizeToken(token: string): string {
	const trimmed = token.trim();
	// Users sometimes paste "bot123456:ABC..." instead of just "123456:ABC..."
	return trimmed.replace(/^bot/i, "");
}

/**
 * Call a Telegram Bot API method
 */
async function callApi<T>(
	botToken: string,
	method: string,
	params?: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
	const token = normalizeToken(botToken);
	const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: params ? JSON.stringify(params) : undefined,
	});

	const data = (await response.json()) as TelegramApiResponse<T>;

	if (!data.ok) {
		// Redact token but show format for debugging (e.g. "1234***:AB***")
		const [id, hash] = token.split(":");
		const redacted = id && hash ? `${id.slice(0, 4)}***:${hash.slice(0, 2)}***` : "***";
		logger.error(
			{
				method,
				httpStatus: response.status,
				errorCode: data.error_code,
				description: data.description,
				tokenFormat: redacted,
				tokenLength: token.length,
			},
			"Telegram API error",
		);
	}

	return data;
}

/**
 * Send a text message
 */
export async function sendMessage(
	botToken: string,
	params: TelegramSendMessageParams,
): Promise<TelegramMessage | null> {
	const result = await callApi<TelegramMessage>(
		botToken,
		"sendMessage",
		params as unknown as Record<string, unknown>,
	);
	return result.result ?? null;
}

/**
 * Edit an existing message
 */
export async function editMessageText(
	botToken: string,
	params: TelegramEditMessageParams,
): Promise<boolean> {
	const result = await callApi(
		botToken,
		"editMessageText",
		params as unknown as Record<string, unknown>,
	);
	return result.ok;
}

/**
 * Answer a callback query (acknowledge inline keyboard button press)
 */
export async function answerCallbackQuery(
	botToken: string,
	callbackQueryId: string,
	text?: string,
): Promise<boolean> {
	const result = await callApi(botToken, "answerCallbackQuery", {
		callback_query_id: callbackQueryId,
		text,
	});
	return result.ok;
}

/**
 * Register a webhook URL with Telegram
 */
export async function setWebhook(
	botToken: string,
	url: string,
	secretToken?: string,
): Promise<boolean> {
	const result = await callApi(botToken, "setWebhook", {
		url,
		secret_token: secretToken,
		allowed_updates: ["message", "callback_query"],
	});

	if (result.ok) {
		logger.info({ url: url.replace(botToken, "***") }, "Telegram webhook registered");
	}

	return result.ok;
}

/**
 * Remove the webhook
 */
export async function deleteWebhook(botToken: string): Promise<boolean> {
	const result = await callApi(botToken, "deleteWebhook");
	return result.ok;
}

/**
 * Get bot information (verify token is valid)
 */
export async function getMe(
	botToken: string,
): Promise<{ id: number; username?: string; first_name: string } | null> {
	const result = await callApi<{ id: number; username?: string; first_name: string }>(
		botToken,
		"getMe",
	);
	return result.result ?? null;
}
