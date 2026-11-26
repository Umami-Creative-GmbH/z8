/**
 * Slack API Client
 *
 * Thin wrapper around @slack/web-api for the methods we use.
 */

import { WebClient } from "@slack/web-api";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { type SlackCallFailure, slackCallFailure } from "./delivery-outcome";

const logger = createLogger("SlackAPI");

/**
 * Create a WebClient instance for a bot token
 */
export function createClient(botToken: string): WebClient {
	return new WebClient(botToken);
}

/**
 * Post a message to a channel
 */
export async function postMessage(
	botToken: string,
	params: {
		channel: string;
		text: string;
		blocks?: unknown[];
	},
): Promise<{ ts: string; channel: string } | null> {
	try {
		const client = createClient(botToken);
		const result = await client.chat.postMessage({
			channel: params.channel,
			text: params.text,
			blocks: params.blocks as never,
		});
		return { ts: result.ts!, channel: result.channel! };
	} catch (error) {
		logger.error({ error, channel: params.channel }, "Failed to post message");
		throw error;
	}
}

/**
 * Update an existing message
 */
export async function updateMessage(
	botToken: string,
	params: {
		channel: string;
		ts: string;
		text: string;
		blocks?: unknown[];
	},
): Promise<boolean> {
	try {
		const client = createClient(botToken);
		await client.chat.update({
			channel: params.channel,
			ts: params.ts,
			text: params.text,
			blocks: params.blocks as never,
		});
		return true;
	} catch (error) {
		logger.error({ error, channel: params.channel, ts: params.ts }, "Failed to update message");
		return false;
	}
}

/**
 * Open a DM conversation with a user
 */
export async function openConversation(
	botToken: string,
	slackUserId: string,
): Promise<string | null> {
	try {
		const client = createClient(botToken);
		const result = await client.conversations.open({ users: slackUserId });
		return result.channel?.id ?? null;
	} catch (error) {
		logger.error({ error, slackUserId }, "Failed to open conversation");
		return null;
	}
}

const DELIVERY_CALL_TIMEOUT_MS = 30_000;

export type SlackCallOutcome<T> = { kind: "ok"; result: T } | SlackCallFailure;

/**
 * A client for durable delivery: one attempt per call and a bounded wait.
 * Retries belong to the delivery owner's schedule, and a rate limit is
 * reported instead of waited out while a lease is held.
 */
function createDeliveryClient(botToken: string): WebClient {
	return new WebClient(botToken, {
		retryConfig: { retries: 0 },
		rejectRateLimitedCalls: true,
		timeout: DELIVERY_CALL_TIMEOUT_MS,
	});
}

/**
 * Call a method and report exactly what is known about the outcome, so
 * durable delivery can classify it explicitly. A response without the
 * identity we need is reported as `unknown`: Slack may have processed it.
 */
async function callWithOutcome<T>(
	method: string,
	call: () => Promise<T | null>,
): Promise<SlackCallOutcome<T>> {
	try {
		const result = await call();
		if (result === null) {
			logger.warn({ method }, "Slack API response lacks the expected identity");
			return { kind: "unknown", reason: "invalid_response" };
		}
		return { kind: "ok", result };
	} catch (error) {
		const failure = slackCallFailure(error);
		logger.warn({ method, failure }, "Slack API delivery call failed");
		return failure;
	}
}

/** `chat.postMessage` with an explicit outcome for durable delivery. */
export function postMessageWithOutcome(
	botToken: string,
	params: { channel: string; text: string; blocks: unknown[] },
): Promise<SlackCallOutcome<{ channel: string; ts: string }>> {
	return callWithOutcome("chat.postMessage", async () => {
		const result = await createDeliveryClient(botToken).chat.postMessage({
			channel: params.channel,
			text: params.text,
			blocks: params.blocks as never,
		});
		return result.channel && result.ts ? { channel: result.channel, ts: result.ts } : null;
	});
}

/** `chat.update` with an explicit outcome for durable delivery. */
export function updateMessageWithOutcome(
	botToken: string,
	params: { channel: string; ts: string; text: string; blocks: unknown[] },
): Promise<SlackCallOutcome<true>> {
	return callWithOutcome("chat.update", async () => {
		await createDeliveryClient(botToken).chat.update({
			channel: params.channel,
			ts: params.ts,
			text: params.text,
			blocks: params.blocks as never,
		});
		return true as const;
	});
}

/** `conversations.open` for a DM, with an explicit outcome. */
export function openConversationWithOutcome(
	botToken: string,
	slackUserId: string,
): Promise<SlackCallOutcome<string>> {
	return callWithOutcome("conversations.open", async () => {
		const result = await createDeliveryClient(botToken).conversations.open({
			users: slackUserId,
		});
		return result.channel?.id ?? null;
	});
}

/**
 * Exchange an OAuth2 authorization code for an access token
 */
export async function exchangeOAuthCode(
	code: string,
	redirectUri: string,
): Promise<{
	accessToken: string;
	teamId: string;
	teamName: string;
	botUserId: string;
	scope: string;
} | null> {
	try {
		const client = new WebClient();
		const result = await client.oauth.v2.access({
			client_id: env.SLACK_CLIENT_ID!,
			client_secret: env.SLACK_CLIENT_SECRET!,
			code,
			redirect_uri: redirectUri,
		});

		if (!result.ok) {
			logger.error({ error: result.error }, "OAuth token exchange failed");
			return null;
		}

		return {
			accessToken: result.access_token!,
			teamId: result.team!.id!,
			teamName: result.team!.name || "",
			botUserId: result.bot_user_id || "",
			scope: result.scope || "",
		};
	} catch (error) {
		logger.error({ error }, "OAuth code exchange failed");
		return null;
	}
}

/**
 * Test if a bot token is valid
 */
export async function authTest(
	botToken: string,
): Promise<{ botUserId: string; teamId: string; teamName: string } | null> {
	try {
		const client = createClient(botToken);
		const result = await client.auth.test();
		return {
			botUserId: result.user_id!,
			teamId: result.team_id!,
			teamName: result.team || "",
		};
	} catch (error) {
		logger.error({ error }, "Auth test failed");
		return null;
	}
}

export interface VerifiedSlackBotIdentity {
	appId: string;
	teamId: string;
	teamName: string;
	botId: string;
	botUserId: string;
	botUsername: string | null;
}

export type VerifySlackBotMetadataResult =
	| { kind: "ok"; identity: VerifiedSlackBotIdentity }
	| { kind: "invalid_token"; slackError: string }
	| { kind: "missing_scope"; slackError: string }
	| { kind: "identity_mismatch"; reason: string }
	| { kind: "unavailable"; reason: string };

const INVALID_SLACK_TOKEN_ERRORS = new Set([
	"invalid_auth",
	"not_authed",
	"token_revoked",
	"token_expired",
	"account_inactive",
	"invalid_arguments",
]);

function extractSlackErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object") {
		return null;
	}
	const dataError = (error as { data?: { error?: unknown } }).data?.error;
	return typeof dataError === "string" ? dataError : null;
}

/**
 * Verifies a Slack organization-owned bot token using `auth.test` and `bots.info`,
 * confirming the authoritative app_id, team_id, bot_id, and bot_user_id metadata.
 */
export async function verifySlackBotMetadata(
	botToken: string,
): Promise<VerifySlackBotMetadataResult> {
	const client = createDeliveryClient(botToken);

	let authResult: Awaited<ReturnType<WebClient["auth"]["test"]>>;
	try {
		authResult = await client.auth.test();
	} catch (error) {
		const code = extractSlackErrorCode(error);
		if (code && INVALID_SLACK_TOKEN_ERRORS.has(code)) {
			return { kind: "invalid_token", slackError: code };
		}
		if (code === "missing_scope") {
			return { kind: "missing_scope", slackError: code };
		}
		logger.warn({ slackError: code }, "Slack auth.test failed during candidate verification");
		return { kind: "unavailable", reason: code ?? "slack_api_unavailable" };
	}

	if (!authResult.ok) {
		const code = authResult.error ?? "invalid_auth";
		if (INVALID_SLACK_TOKEN_ERRORS.has(code)) {
			return { kind: "invalid_token", slackError: code };
		}
		if (code === "missing_scope") {
			return { kind: "missing_scope", slackError: code };
		}
		return { kind: "unavailable", reason: code };
	}

	const teamId = authResult.team_id?.trim() ?? "";
	const botUserId = authResult.user_id?.trim() ?? "";
	const botId = authResult.bot_id?.trim() ?? "";
	const teamName = authResult.team?.trim() ?? "";
	const botUsername = authResult.user?.trim() || null;

	if (!teamId || !botUserId || !botId) {
		return { kind: "identity_mismatch", reason: "missing_auth_metadata" };
	}

	let botInfoResult: Awaited<ReturnType<WebClient["bots"]["info"]>>;
	try {
		botInfoResult = await client.bots.info({ bot: botId });
	} catch (error) {
		const code = extractSlackErrorCode(error);
		if (code && INVALID_SLACK_TOKEN_ERRORS.has(code)) {
			return { kind: "invalid_token", slackError: code };
		}
		if (code === "missing_scope") {
			return { kind: "missing_scope", slackError: code };
		}
		if (code === "bot_not_found") {
			return { kind: "identity_mismatch", reason: "bot_not_found" };
		}
		logger.warn({ slackError: code }, "Slack bots.info failed during candidate verification");
		return { kind: "unavailable", reason: code ?? "slack_api_unavailable" };
	}

	if (!botInfoResult.ok || !botInfoResult.bot) {
		const code = botInfoResult.error ?? "bot_not_found";
		if (code === "missing_scope") {
			return { kind: "missing_scope", slackError: code };
		}
		return { kind: "identity_mismatch", reason: code };
	}

	const botMeta = botInfoResult.bot;
	const appId = botMeta.app_id?.trim() ?? "";
	if (!appId || botMeta.deleted) {
		return {
			kind: "identity_mismatch",
			reason: botMeta.deleted ? "bot_deleted" : "missing_app_id",
		};
	}

	if (botMeta.id && botMeta.id !== botId) {
		return { kind: "identity_mismatch", reason: "bot_id_mismatch" };
	}

	if (botMeta.user_id && botMeta.user_id !== botUserId) {
		return { kind: "identity_mismatch", reason: "bot_user_id_mismatch" };
	}

	return {
		kind: "ok",
		identity: {
			appId,
			teamId,
			teamName,
			botId,
			botUserId,
			botUsername: botMeta.name?.trim() || botUsername,
		},
	};
}
