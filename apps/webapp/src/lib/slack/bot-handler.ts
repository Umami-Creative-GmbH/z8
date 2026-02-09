/**
 * Slack Bot Message Handler
 *
 * Handles incoming slash commands, events, and interactions.
 * Routes to appropriate handlers (commands, approvals, linking).
 */

import { executeCommand, parseCommand } from "@/lib/bot-platform/command-registry";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { postMessage } from "./api";
import { handleApprovalAction } from "./approval-handler";
import { saveConversation } from "./conversation-manager";
import type {
	ResolvedSlackBot,
	SlackEventCallback,
	SlackInteractionPayload,
	SlackSlashCommandPayload,
} from "./types";
import { claimLinkCode, resolveSlackUser } from "./user-resolver";

const logger = createLogger("SlackBotHandler");

// ============================================
// SLASH COMMAND HANDLER
// ============================================

/**
 * Handle an incoming Slack slash command (/z8 <command>)
 */
export async function handleSlashCommand(
	payload: SlackSlashCommandPayload,
	bot: ResolvedSlackBot,
): Promise<{ text: string }> {
	const text = payload.text.trim();
	const slackUserId = payload.user_id;
	const channelId = payload.channel_id;

	// Handle /link command
	if (text.startsWith("link ") || text === "link") {
		return handleLinkCommand(text, slackUserId, payload.user_name, bot);
	}

	// Handle /start or empty command
	if (!text || text === "start") {
		return {
			text: "Welcome to Z8! To connect your account, go to Settings > Integrations > Slack in your Z8 dashboard and generate a link code. Then use: /z8 link YOUR_CODE",
		};
	}

	// Check if commands are enabled
	if (!bot.enableCommands) {
		return { text: "Commands are not enabled for this workspace." };
	}

	// Resolve user
	const userResult = await resolveSlackUser(slackUserId, bot.slackTeamId, payload.user_name);

	if (userResult.status !== "found") {
		return {
			text: "Your Slack account is not linked to Z8. Go to Settings > Integrations > Slack in your Z8 dashboard to generate a link code, then use: /z8 link YOUR_CODE",
		};
	}

	// Save conversation for proactive messaging
	await saveConversation(channelId, "im", userResult.user.userId, bot.organizationId);

	// Parse command
	const parsed = parseCommand(`/${text}`);

	if (!parsed || !parsed.command) {
		return { text: "Unknown command. Use `/z8 help` to see available commands." };
	}

	// Build shared command context
	const commandContext: BotCommandContext = {
		platform: "slack",
		organizationId: bot.organizationId,
		employeeId: userResult.user.employeeId,
		userId: userResult.user.userId,
		platformUserId: slackUserId,
		config: {
			organizationId: bot.organizationId,
			enableApprovals: bot.enableApprovals,
			enableCommands: bot.enableCommands,
			enableDailyDigest: bot.enableDailyDigest,
			enableEscalations: bot.enableEscalations,
			digestTime: bot.digestTime,
			digestTimezone: bot.digestTimezone,
			escalationTimeoutHours: bot.escalationTimeoutHours,
		},
		args: parsed.args,
	};

	// Execute command (shared with Teams and Telegram)
	const response = await executeCommand(parsed.command, commandContext);

	return { text: response.text };
}

// ============================================
// EVENT HANDLER
// ============================================

/**
 * Handle an incoming Slack event (Events API)
 */
export async function handleEvent(event: SlackEventCallback, bot: ResolvedSlackBot): Promise<void> {
	const slackEvent = event.event;

	try {
		// Handle DM messages (for /link and general interaction)
		if (slackEvent.type === "message" && slackEvent.channel_type === "im") {
			await handleDirectMessage(slackEvent, bot);
		}
	} catch (error) {
		logger.error(
			{ error, eventType: slackEvent.type, organizationId: bot.organizationId },
			"Error handling Slack event",
		);
	}
}

/**
 * Handle a direct message to the bot
 */
async function handleDirectMessage(
	event: SlackEventCallback["event"],
	bot: ResolvedSlackBot,
): Promise<void> {
	const text = event.text?.trim() || "";
	const slackUserId = event.user;
	const channelId = event.channel;

	if (!text || !slackUserId || !channelId) return;

	// Ignore bot messages
	if (slackUserId === bot.botUserId) return;

	// Handle link command in DM
	if (text.toLowerCase().startsWith("link ")) {
		const result = await handleLinkCommand(text, slackUserId, undefined, bot);
		await postMessage(bot.botAccessToken, {
			channel: channelId,
			text: result.text,
		});
		return;
	}

	// Resolve user
	const userResult = await resolveSlackUser(slackUserId, bot.slackTeamId);

	if (userResult.status !== "found") {
		await postMessage(bot.botAccessToken, {
			channel: channelId,
			text: "Your Slack account is not linked to Z8. Go to Settings > Integrations > Slack in your Z8 dashboard to generate a link code, then send: link YOUR_CODE",
		});
		return;
	}

	// Save conversation for proactive messaging
	await saveConversation(channelId, "im", userResult.user.userId, bot.organizationId);

	await postMessage(bot.botAccessToken, {
		channel: channelId,
		text: "Use `/z8 help` to see available commands.",
	});
}

// ============================================
// INTERACTION HANDLER
// ============================================

/**
 * Handle an incoming Slack interaction (button clicks, etc.)
 */
export async function handleInteraction(
	payload: SlackInteractionPayload,
	bot: ResolvedSlackBot,
): Promise<void> {
	if (payload.type !== "block_actions" || !payload.actions?.length) return;

	const action = payload.actions[0];
	const slackUserId = payload.user.id;

	try {
		if (action.action_id === "approval_approve" || action.action_id === "approval_reject") {
			await handleApprovalAction(payload, action, slackUserId, bot);
		}
	} catch (error) {
		logger.error(
			{ error, actionId: action.action_id, organizationId: bot.organizationId },
			"Error handling Slack interaction",
		);
	}
}

// ============================================
// LINK COMMAND
// ============================================

async function handleLinkCommand(
	text: string,
	slackUserId: string,
	slackUsername: string | undefined,
	bot: ResolvedSlackBot,
): Promise<{ text: string }> {
	const parts = text.split(/\s+/);
	const code = parts[1];

	if (!code) {
		return { text: "Please provide your link code: `/z8 link YOUR_CODE`" };
	}

	const result = await claimLinkCode(
		code,
		slackUserId,
		bot.slackTeamId,
		bot.organizationId,
		slackUsername,
	);

	switch (result.status) {
		case "success":
			return {
				text: "Your Slack account has been linked to Z8! Use `/z8 help` to see available commands.",
			};

		case "invalid_code":
			return { text: "Invalid link code. Please check your code and try again." };

		case "expired":
			return {
				text: "This link code has expired. Please generate a new one from your Z8 settings.",
			};

		case "already_linked":
			return {
				text: "This Slack account is already linked to a Z8 account in this workspace.",
			};
	}
}
