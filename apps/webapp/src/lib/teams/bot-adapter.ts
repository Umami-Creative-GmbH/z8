/**
 * Teams Bot Adapter
 *
 * Wraps the Bot Framework CloudAdapter for handling Teams bot messages.
 * This is a multi-tenant bot that serves all Z8 customers.
 */

import {
	CloudAdapter,
	ConfigurationServiceClientCredentialFactory,
	ConfigurationBotFrameworkAuthentication,
	type Activity,
	type Attachment,
	type ConversationReference,
	type TurnContext,
} from "botbuilder";
import { createLogger } from "@/lib/logger";
import { TeamsError } from "./types";

const logger = createLogger("TeamsBotAdapter");

// Singleton adapter instance
let adapterInstance: CloudAdapter | null = null;

/**
 * Get or create the Bot Framework adapter
 *
 * Uses environment variables for bot credentials:
 * - MICROSOFT_APP_ID
 * - MICROSOFT_APP_PASSWORD
 * - MICROSOFT_APP_TYPE (default: "MultiTenant")
 */
export function getBotAdapter(): CloudAdapter {
	if (adapterInstance) {
		return adapterInstance;
	}

	const appId = process.env.MICROSOFT_APP_ID;
	const appPassword = process.env.MICROSOFT_APP_PASSWORD;
	const appType = (process.env.MICROSOFT_APP_TYPE as "MultiTenant" | "SingleTenant") || "MultiTenant";

	if (!appId || !appPassword) {
		throw new TeamsError(
			"Teams bot credentials not configured. Set MICROSOFT_APP_ID and MICROSOFT_APP_PASSWORD.",
			"BOT_ERROR",
		);
	}

	const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
		MicrosoftAppId: appId,
		MicrosoftAppPassword: appPassword,
		MicrosoftAppType: appType,
	});

	const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({}, credentialsFactory);
	adapterInstance = new CloudAdapter(botFrameworkAuth);

	// Global error handler
	adapterInstance.onTurnError = async (context: TurnContext, error: Error) => {
		logger.error(
			{
				error: error.message,
				stack: error.stack,
				activityId: context.activity.id,
				conversationType: context.activity.conversation?.conversationType,
			},
			"Bot turn error",
		);

		// Send error message to user
		try {
			await context.sendActivity(
				"Sorry, something went wrong processing your request. Please try again.",
			);
		} catch (sendError) {
			logger.error({ error: sendError }, "Failed to send error message to user");
		}
	};

	logger.info({ appId, appType }, "Bot adapter initialized");

	return adapterInstance;
}

/**
 * Send a proactive message to a user
 *
 * @param conversationReference - Stored conversation reference
 * @param activity - Activity to send (message, card, etc.)
 * @returns Activity ID of the sent message
 */
export async function sendProactiveMessage(
	conversationReference: ConversationReference,
	activity: Partial<Activity>,
): Promise<string | undefined> {
	const adapter = getBotAdapter();
	const appId = process.env.MICROSOFT_APP_ID;

	if (!appId) {
		throw new TeamsError("MICROSOFT_APP_ID not configured", "BOT_ERROR");
	}

	let activityId: string | undefined;

	try {
		await adapter.continueConversationAsync(
			appId,
			conversationReference,
			async (turnContext) => {
				const response = await turnContext.sendActivity(activity);
				activityId = response?.id;
			},
		);

		logger.debug(
			{
				conversationId: conversationReference.conversation?.id,
				activityId,
			},
			"Sent proactive message",
		);

		return activityId;
	} catch (error) {
		logger.error(
			{
				error,
				conversationId: conversationReference.conversation?.id,
			},
			"Failed to send proactive message",
		);
		throw new TeamsError("Failed to send proactive message", "PROACTIVE_MESSAGE_FAILED", {
			originalError: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Send an Adaptive Card to a user
 *
 * @param conversationReference - Stored conversation reference
 * @param card - Adaptive Card payload
 * @param text - Fallback text for clients that don't support cards
 * @returns Activity ID of the sent message
 */
export async function sendAdaptiveCard(
	conversationReference: ConversationReference,
	// biome-ignore lint/suspicious/noExplicitAny: Adaptive Cards are flexible JSON
	card: any,
	text?: string,
): Promise<string | undefined> {
	const attachment: Attachment = {
		contentType: "application/vnd.microsoft.card.adaptive",
		content: card,
	};

	return sendProactiveMessage(conversationReference, {
		type: "message",
		text: text || "",
		attachments: [attachment],
	});
}

/**
 * Update an existing message (e.g., update approval card after action)
 *
 * @param conversationReference - Stored conversation reference
 * @param activityId - ID of the activity to update
 * @param updatedActivity - New activity content
 */
export async function updateMessage(
	conversationReference: ConversationReference,
	activityId: string,
	updatedActivity: Partial<Activity>,
): Promise<void> {
	const adapter = getBotAdapter();
	const appId = process.env.MICROSOFT_APP_ID;

	if (!appId) {
		throw new TeamsError("MICROSOFT_APP_ID not configured", "BOT_ERROR");
	}

	try {
		await adapter.continueConversationAsync(
			appId,
			conversationReference,
			async (turnContext) => {
				await turnContext.updateActivity({
					...updatedActivity,
					id: activityId,
				});
			},
		);

		logger.debug(
			{
				conversationId: conversationReference.conversation?.id,
				activityId,
			},
			"Updated message",
		);
	} catch (error) {
		logger.error(
			{
				error,
				conversationId: conversationReference.conversation?.id,
				activityId,
			},
			"Failed to update message",
		);
		throw new TeamsError("Failed to update message", "CARD_UPDATE_FAILED", {
			originalError: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Check if the bot adapter is properly configured
 */
export function isBotConfigured(): boolean {
	return !!(process.env.MICROSOFT_APP_ID && process.env.MICROSOFT_APP_PASSWORD);
}
