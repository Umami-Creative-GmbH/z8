/**
 * Telegram Bot API Client
 *
 * Lightweight wrapper around the Telegram Bot API using fetch().
 * No external library needed.
 */

import { createLogger } from "@/lib/logger";
import type { TelegramCallFailure } from "./delivery-outcome";
import type {
	TelegramApiResponse,
	TelegramEditMessageParams,
	TelegramMessage,
	TelegramSendMessageParams,
} from "./types";

const logger = createLogger("TelegramAPI");

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_CHAT_TYPES = [
	"private",
	"group",
	"supergroup",
	"channel",
] as const;

type ResultDecoder<T> = (value: unknown) => value is T;

interface TelegramBotInfo {
	id: number;
	username?: string;
	first_name: string;
}

/**
 * Normalize a bot token: trim whitespace and strip accidental "bot" prefix.
 */
function normalizeToken(token: string): string {
	const trimmed = token.trim();
	// Users sometimes paste "bot123456:ABC..." instead of just "123456:ABC..."
	return trimmed.replace(/^bot/i, "");
}

function redactToken(value: string, token: string): string {
	return token ? value.replaceAll(token, "***") : value;
}

function getWebhookLogLabel(url: string): string {
	try {
		const origin = new URL(url).origin;
		return origin === "null"
			? "invalid webhook URL"
			: `${origin}/api/telegram/webhook/***`;
	} catch {
		return "invalid webhook URL";
	}
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isTelegramFailure(
	value: unknown,
): value is TelegramApiResponse<never> & { ok: false } {
	return (
		typeof value === "object" &&
		value !== null &&
		"ok" in value &&
		value.ok === false &&
		!("result" in value) &&
		(!("error_code" in value) ||
			(typeof value.error_code === "number" &&
				Number.isFinite(value.error_code))) &&
		(!("description" in value) || typeof value.description === "string")
	);
}

function isTelegramSuccess<T>(
	value: unknown,
	decodeResult: ResultDecoder<T>,
): value is { ok: true; result: T } {
	return (
		typeof value === "object" &&
		value !== null &&
		"ok" in value &&
		value.ok === true &&
		"result" in value &&
		decodeResult(value.result)
	);
}

function isTrue(value: unknown): value is true {
	return value === true;
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
	if (typeof value !== "object" || value === null) return false;
	if (
		!("chat" in value) ||
		typeof value.chat !== "object" ||
		value.chat === null
	) {
		return false;
	}
	const chat = value.chat;

	return (
		"message_id" in value &&
		typeof value.message_id === "number" &&
		Number.isFinite(value.message_id) &&
		"date" in value &&
		typeof value.date === "number" &&
		Number.isFinite(value.date) &&
		"id" in chat &&
		typeof chat.id === "number" &&
		Number.isFinite(chat.id) &&
		"type" in chat &&
		typeof chat.type === "string" &&
		TELEGRAM_CHAT_TYPES.some((type) => type === chat.type) &&
		(!("text" in value) || typeof value.text === "string")
	);
}

function isEditMessageResult(value: unknown): value is true | TelegramMessage {
	return isTrue(value) || isTelegramMessage(value);
}

function isTelegramBotInfo(value: unknown): value is TelegramBotInfo {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "number" &&
		Number.isFinite(value.id) &&
		"first_name" in value &&
		typeof value.first_name === "string" &&
		(!("username" in value) || typeof value.username === "string")
	);
}

function logApiFailure(
	method: string,
	httpStatus: number,
	token: string,
	failure: TelegramApiResponse<never>,
): void {
	// Redact token but show format for debugging (e.g. "1234***:AB***")
	const [id, hash] = token.split(":");
	const redacted =
		id && hash ? `${id.slice(0, 4)}***:${hash.slice(0, 2)}***` : "***";
	logger.error(
		{
			method,
			httpStatus,
			errorCode: failure.error_code,
			description: redactToken(failure.description ?? "", token),
			tokenFormat: redacted,
			tokenLength: token.length,
		},
		"Telegram API error",
	);
}

/**
 * Call a Telegram Bot API method
 */
async function callApi<T>(
	botToken: string,
	method: string,
	decodeResult: ResultDecoder<T>,
	params?: Record<string, unknown>,
): Promise<TelegramApiResponse<T>> {
	const token = normalizeToken(botToken);
	const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: params ? JSON.stringify(params) : undefined,
	});

	if (!response.ok) {
		const parsed = parseJson(await response.text());
		const failure = isTelegramFailure(parsed)
			? parsed
			: {
					ok: false as const,
					error_code: response.status,
					description: `HTTP ${response.status}`,
				};
		logApiFailure(method, response.status, token, failure);
		return failure;
	}

	const parsed = parseJson(await response.text());

	if (isTelegramFailure(parsed)) {
		logApiFailure(method, response.status, token, parsed);
		return parsed;
	}

	if (!isTelegramSuccess(parsed, decodeResult)) {
		const failure = {
			ok: false as const,
			error_code: response.status,
			description: "Invalid Telegram API response",
		};
		logApiFailure(method, response.status, token, failure);
		return failure;
	}

	return parsed;
}

const DELIVERY_CALL_TIMEOUT_MS = 30_000;

export type TelegramCallOutcome<T> =
	| { kind: "ok"; result: T }
	| TelegramCallFailure;

/**
 * Call a method and report exactly what is known about the outcome. Unlike
 * `callApi`, a thrown or timed-out request is reported as `unknown` (Telegram
 * may have processed it) instead of propagating, so durable delivery can
 * classify it explicitly.
 */
async function callApiWithOutcome<T>(
	botToken: string,
	method: string,
	decodeResult: ResultDecoder<T>,
	params: Record<string, unknown>,
): Promise<TelegramCallOutcome<T>> {
	const token = normalizeToken(botToken);
	let response: Response;
	let text: string;
	try {
		// The body is read inside the timeout on every status; failures are classified from it below.
		// react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
		response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(params),
			signal: AbortSignal.timeout(DELIVERY_CALL_TIMEOUT_MS),
		});
		text = await response.text();
	} catch (error) {
		const timeout =
			error instanceof Error &&
			(error.name === "TimeoutError" || error.name === "AbortError");
		logger.warn({ method, timeout }, "Telegram API call outcome unknown");
		return { kind: "unknown", reason: timeout ? "timeout" : "network" };
	}
	const parsed = parseJson(text);
	if (isTelegramFailure(parsed) || !response.ok) {
		const failure = isTelegramFailure(parsed)
			? parsed
			: {
					ok: false as const,
					error_code: response.status,
					description: `HTTP ${response.status}`,
				};
		logApiFailure(method, response.status, token, failure);
		return {
			kind: "failed",
			errorCode: failure.error_code ?? null,
			description: redactToken(failure.description ?? "", token),
		};
	}
	if (!isTelegramSuccess(parsed, decodeResult)) {
		logApiFailure(method, response.status, token, {
			ok: false,
			error_code: response.status,
			description: "Invalid Telegram API response",
		});
		return { kind: "unknown", reason: "invalid_response" };
	}
	return { kind: "ok", result: parsed.result };
}

/** `sendMessage` with an explicit outcome for durable delivery. */
export function sendMessageWithOutcome(
	botToken: string,
	params: TelegramSendMessageParams,
): Promise<TelegramCallOutcome<TelegramMessage>> {
	return callApiWithOutcome(
		botToken,
		"sendMessage",
		isTelegramMessage,
		params as unknown as Record<string, unknown>,
	);
}

/** `editMessageText` with an explicit outcome for durable delivery. */
export function editMessageTextWithOutcome(
	botToken: string,
	params: TelegramEditMessageParams,
): Promise<TelegramCallOutcome<true | TelegramMessage>> {
	return callApiWithOutcome(
		botToken,
		"editMessageText",
		isEditMessageResult,
		params as unknown as Record<string, unknown>,
	);
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
		isTelegramMessage,
		params as unknown as Record<string, unknown>,
	);
	return result.ok ? (result.result ?? null) : null;
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
		isEditMessageResult,
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
	const result = await callApi(botToken, "answerCallbackQuery", isTrue, {
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
	const result = await callApi(botToken, "setWebhook", isTrue, {
		url,
		secret_token: secretToken,
		allowed_updates: ["message", "callback_query"],
	});

	if (result.ok) {
		logger.info(
			{ url: getWebhookLogLabel(url) },
			"Telegram webhook registered",
		);
	}

	return result.ok;
}

/**
 * Register bot commands for the Telegram command menu
 */
export async function setMyCommands(
	botToken: string,
	commands: Array<{ command: string; description: string }>,
): Promise<boolean> {
	const result = await callApi(botToken, "setMyCommands", isTrue, {
		commands,
	});
	return result.ok;
}

/**
 * Remove the webhook
 */
export async function deleteWebhook(botToken: string): Promise<boolean> {
	const result = await callApi(botToken, "deleteWebhook", isTrue);
	return result.ok;
}

/**
 * Get bot information (verify token is valid)
 */
export async function getMe(
	botToken: string,
): Promise<{ id: number; username?: string; first_name: string } | null> {
	const result = await callApi(botToken, "getMe", isTelegramBotInfo);
	return result.ok ? (result.result ?? null) : null;
}
