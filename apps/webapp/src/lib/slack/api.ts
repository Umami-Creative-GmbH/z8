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
