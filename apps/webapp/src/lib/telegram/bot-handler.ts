/**
 * Telegram Bot Message Handler
 *
 * Main entry point for handling incoming Telegram webhook updates.
 * Routes messages and callback queries to appropriate handlers.
 */

import { executeCommand, parseCommand } from "@/lib/bot-platform/command-registry";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { answerCallbackQuery, sendMessage } from "./api";
import { handleApprovalCallback } from "./approval-handler";
import { saveConversation } from "./conversation-manager";
import { escapeMarkdownV2 } from "./formatters";
import type { ApprovalCallbackData, ResolvedTelegramBot, TelegramUpdate } from "./types";
import { claimLinkCode, resolveTelegramUser } from "./user-resolver";

const logger = createLogger("TelegramBotHandler");

/**
 * Handle an incoming Telegram webhook update
 */
export async function handleTelegramUpdate(
	update: TelegramUpdate,
	bot: ResolvedTelegramBot,
): Promise<void> {
	try {
		if (update.callback_query) {
			await handleCallbackQuery(update.callback_query, bot);
		} else if (update.message) {
			await handleMessage(update.message, bot);
		}
	} catch (error) {
		logger.error(
			{ error, updateId: update.update_id, organizationId: bot.organizationId },
			"Error handling Telegram update",
		);
	}
}

/**
 * Handle incoming text message
 */
async function handleMessage(
	message: TelegramUpdate["message"] & {},
	bot: ResolvedTelegramBot,
): Promise<void> {
	const chatId = String(message.chat.id);
	const telegramUserId = String(message.from?.id);
	const telegramUsername = message.from?.username;
	const text = message.text?.trim() || "";

	if (!text || !message.from) return;

	// Handle /start command (first interaction)
	if (text === "/start") {
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2(
				"Welcome to Z8! To connect your account, go to Settings > Integrations > Telegram in your Z8 dashboard and generate a link code. Then send: /link YOUR_CODE",
			),
			parse_mode: "MarkdownV2",
		});
		return;
	}

	// Handle /link command (account linking)
	if (text.startsWith("/link")) {
		await handleLinkCommand(text, chatId, telegramUserId, telegramUsername, message.from, bot);
		return;
	}

	// Check if commands are enabled
	if (!bot.enableCommands) return;

	// Resolve user
	const userResult = await resolveTelegramUser(
		telegramUserId,
		bot.organizationId,
		telegramUsername,
	);

	if (userResult.status !== "found") {
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2(
				"Your Telegram account is not linked to Z8. Go to Settings > Integrations > Telegram in your Z8 dashboard to generate a link code, then send: /link YOUR_CODE",
			),
			parse_mode: "MarkdownV2",
		});
		return;
	}

	// Save conversation for proactive messaging
	await saveConversation(chatId, message.chat.type, userResult.user.userId, bot.organizationId);

	// Parse command
	const parsed = parseCommand(text);

	if (!parsed || !parsed.command) {
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2("Type /help to see available commands."),
			parse_mode: "MarkdownV2",
		});
		return;
	}

	// Build shared command context
	const commandContext: BotCommandContext = {
		platform: "telegram",
		organizationId: bot.organizationId,
		employeeId: userResult.user.employeeId,
		userId: userResult.user.userId,
		platformUserId: telegramUserId,
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

	// Execute command (shared with Teams)
	const response = await executeCommand(parsed.command, commandContext);

	// Send response
	// For card responses on Telegram, we fall back to the text version
	// since Telegram doesn't support Adaptive Cards
	await sendMessage(bot.botToken, {
		chat_id: chatId,
		text: escapeMarkdownV2(response.text),
		parse_mode: "MarkdownV2",
	});
}

/**
 * Handle callback query (inline keyboard button press)
 */
async function handleCallbackQuery(
	query: TelegramUpdate["callback_query"] & {},
	bot: ResolvedTelegramBot,
): Promise<void> {
	if (!query.data || !query.from) return;

	const telegramUserId = String(query.from.id);

	try {
		// Parse callback data
		const callbackData = JSON.parse(query.data) as ApprovalCallbackData;

		if (callbackData.a === "ap" || callbackData.a === "rj") {
			await handleApprovalCallback(query, callbackData, telegramUserId, bot);
		}
	} catch (error) {
		logger.error({ error, data: query.data }, "Failed to parse callback data");
	}

	// Always acknowledge the callback query
	await answerCallbackQuery(bot.botToken, query.id);
}

/**
 * Handle the /link command for account linking
 */
async function handleLinkCommand(
	text: string,
	chatId: string,
	telegramUserId: string,
	telegramUsername: string | undefined,
	from: NonNullable<TelegramUpdate["message"]>["from"] & {},
	bot: ResolvedTelegramBot,
): Promise<void> {
	const parts = text.split(/\s+/);
	const code = parts[1];

	if (!code) {
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2("Please provide your link code: /link YOUR_CODE"),
			parse_mode: "MarkdownV2",
		});
		return;
	}

	const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ");

	const result = await claimLinkCode(
		code,
		telegramUserId,
		bot.organizationId,
		telegramUsername,
		displayName,
	);

	switch (result.status) {
		case "success":
			// Save conversation for proactive messaging
			await saveConversation(chatId, "private", result.userId, bot.organizationId);
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2(
					"Your Telegram account has been linked to Z8! Type /help to see available commands.",
				),
				parse_mode: "MarkdownV2",
			});
			break;

		case "invalid_code":
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2("Invalid link code. Please check your code and try again."),
				parse_mode: "MarkdownV2",
			});
			break;

		case "expired":
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2(
					"This link code has expired. Please generate a new one from your Z8 settings.",
				),
				parse_mode: "MarkdownV2",
			});
			break;

		case "already_linked":
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2(
					"This Telegram account is already linked to a Z8 account in this organization.",
				),
				parse_mode: "MarkdownV2",
			});
			break;
	}
}
