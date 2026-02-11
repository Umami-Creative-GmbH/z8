/**
 * Telegram Bot Message Handler
 *
 * Main entry point for handling incoming Telegram webhook updates.
 * Routes messages and callback queries to appropriate handlers.
 */

import { executeCommand, getAllCommands, parseCommand } from "@/lib/bot-platform/command-registry";
import { getBotTranslate, getUserLocale, setUserLocale } from "@/lib/bot-platform/i18n";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";
import { answerCallbackQuery, editMessageText, sendMessage } from "./api";
import { handleApprovalCallback } from "./approval-handler";
import { saveConversation } from "./conversation-manager";
import { escapeMarkdownV2, markdownToHtml } from "./formatters";
import type {
	ApprovalCallbackData,
	CommandCallbackData,
	LanguageCallbackData,
	ResolvedTelegramBot,
	TelegramInlineKeyboardButton,
	TelegramUpdate,
} from "./types";
import { claimLinkCode, resolveTelegramUser } from "./user-resolver";

const logger = createLogger("TelegramBotHandler");

/** Language display config for inline keyboard */
const LANGUAGE_BUTTONS: Array<{ code: string; label: string }> = [
	{ code: "en", label: "\u{1F1EC}\u{1F1E7} English" },
	{ code: "de", label: "\u{1F1E9}\u{1F1EA} Deutsch" },
	{ code: "fr", label: "\u{1F1EB}\u{1F1F7} Fran\u00E7ais" },
	{ code: "es", label: "\u{1F1EA}\u{1F1F8} Espa\u00F1ol" },
	{ code: "it", label: "\u{1F1EE}\u{1F1F9} Italiano" },
	{ code: "pt", label: "\u{1F1E7}\u{1F1F7} Portugu\u00EAs" },
];

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

	// Handle /start command (first interaction) — no auth needed, use default locale
	if (text === "/start") {
		const t = await getBotTranslate(DEFAULT_LANGUAGE);
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2(
				t(
					"bot.static.welcome",
					"Welcome to Z8! To connect your account, go to Settings > Integrations > Telegram in your Z8 dashboard and generate a link code. Then send: /link YOUR_CODE",
				),
			),
			parse_mode: "MarkdownV2",
		});
		return;
	}

	// Handle /link command (account linking) — no auth needed, use default locale
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
		const t = await getBotTranslate(DEFAULT_LANGUAGE);
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2(
				t(
					"bot.static.notLinked",
					"Your Telegram account is not linked to Z8. Go to Settings > Integrations > Telegram in your Z8 dashboard to generate a link code, then send: /link YOUR_CODE",
				),
			),
			parse_mode: "MarkdownV2",
		});
		return;
	}

	// Get user locale
	const locale = await getUserLocale(userResult.user.userId);

	// Save conversation for proactive messaging
	await saveConversation(chatId, message.chat.type, userResult.user.userId, bot.organizationId);

	// Handle /language command
	if (text === "/language" || text === "/lang") {
		await handleLanguageCommand(chatId, locale, bot);
		return;
	}

	// Parse command
	const parsed = parseCommand(text);

	if (!parsed || !parsed.command) {
		const t = await getBotTranslate(locale);
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2(t("bot.static.typeHelp", "Type /help to see available commands.")),
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
		locale,
	};

	// Execute command (shared with Teams)
	const response = await executeCommand(parsed.command, commandContext);

	// Send response
	// For card responses on Telegram, we fall back to the text version
	// since Telegram doesn't support Adaptive Cards.
	// Command responses use generic markdown (**bold**, _italic_) — convert to HTML.
	await sendMessage(bot.botToken, {
		chat_id: chatId,
		text: markdownToHtml(response.text),
		parse_mode: "HTML",
		...(parsed.command === "help" && { reply_markup: buildCommandKeyboard() }),
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
		const callbackData = JSON.parse(query.data) as
			| ApprovalCallbackData
			| CommandCallbackData
			| LanguageCallbackData;

		if (callbackData.a === "ap" || callbackData.a === "rj") {
			await handleApprovalCallback(
				query,
				callbackData as ApprovalCallbackData,
				telegramUserId,
				bot,
			);
		} else if (callbackData.a === "cmd") {
			await handleCommandCallback(
				query,
				callbackData as CommandCallbackData,
				telegramUserId,
				bot,
			);
		} else if (callbackData.a === "lang") {
			await handleLanguageCallback(
				query,
				callbackData as LanguageCallbackData,
				telegramUserId,
				bot,
			);
		}
	} catch (error) {
		logger.error({ error, data: query.data }, "Failed to parse callback data");
	}

	// Always acknowledge the callback query
	await answerCallbackQuery(bot.botToken, query.id);
}

/**
 * Handle /language command — show inline keyboard with language buttons
 */
async function handleLanguageCommand(
	chatId: string,
	currentLocale: string,
	bot: ResolvedTelegramBot,
): Promise<void> {
	const t = await getBotTranslate(currentLocale);

	// Build 2 buttons per row
	const rows: TelegramInlineKeyboardButton[][] = [];
	for (let i = 0; i < LANGUAGE_BUTTONS.length; i += 2) {
		const row: TelegramInlineKeyboardButton[] = LANGUAGE_BUTTONS.slice(i, i + 2).map(
			(lang) => {
				const data: LanguageCallbackData = { a: "lang", l: lang.code };
				const label =
					lang.code === currentLocale ? `${lang.label} \u2713` : lang.label;
				return {
					text: label,
					callback_data: JSON.stringify(data),
				};
			},
		);
		rows.push(row);
	}

	await sendMessage(bot.botToken, {
		chat_id: chatId,
		text: escapeMarkdownV2(
			t("bot.language.prompt", "Choose your language:"),
		),
		parse_mode: "MarkdownV2",
		reply_markup: { inline_keyboard: rows },
	});
}

/**
 * Handle language selection callback
 */
async function handleLanguageCallback(
	query: TelegramUpdate["callback_query"] & {},
	data: LanguageCallbackData,
	telegramUserId: string,
	bot: ResolvedTelegramBot,
): Promise<void> {
	const chatId = String(query.message?.chat.id);
	const messageId = query.message?.message_id;
	if (!chatId || !messageId) return;

	const newLocale = data.l;
	if (!ALL_LANGUAGES.includes(newLocale)) return;

	// Resolve user to get userId
	const userResult = await resolveTelegramUser(telegramUserId, bot.organizationId);
	if (userResult.status !== "found") return;

	// Persist locale
	await setUserLocale(userResult.user.userId, newLocale);

	// Get translator in the new locale
	const t = await getBotTranslate(newLocale);
	const langLabel =
		LANGUAGE_BUTTONS.find((b) => b.code === newLocale)?.label || newLocale;

	// Edit the original message to show confirmation
	await editMessageText(bot.botToken, {
		chat_id: chatId,
		message_id: messageId,
		text: escapeMarkdownV2(
			t("bot.language.changed", "Language changed to {language}.", {
				language: langLabel,
			}),
		),
		parse_mode: "MarkdownV2",
	});
}

/**
 * Build inline keyboard with command buttons for the help response.
 * Lays out commands in rows of 2.
 */
function buildCommandKeyboard() {
	const commands = getAllCommands().filter((cmd) => cmd.name !== "help");
	commands.sort((a, b) => a.name.localeCompare(b.name));

	const rows: TelegramInlineKeyboardButton[][] = [];
	for (let i = 0; i < commands.length; i += 2) {
		const row: TelegramInlineKeyboardButton[] = commands.slice(i, i + 2).map((cmd) => ({
			text: `/${cmd.name}`,
			callback_data: JSON.stringify({ a: "cmd", c: cmd.name }),
		}));
		rows.push(row);
	}

	return { inline_keyboard: rows };
}

/**
 * Handle command callback from inline keyboard button press.
 */
async function handleCommandCallback(
	query: TelegramUpdate["callback_query"] & {},
	data: CommandCallbackData,
	telegramUserId: string,
	bot: ResolvedTelegramBot,
): Promise<void> {
	const chatId = String(query.message?.chat.id);
	if (!chatId) return;

	const userResult = await resolveTelegramUser(
		telegramUserId,
		bot.organizationId,
		query.from.username,
	);

	if (userResult.status !== "found") return;

	const locale = await getUserLocale(userResult.user.userId);

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
		args: [],
		locale,
	};

	const response = await executeCommand(data.c, commandContext);

	await sendMessage(bot.botToken, {
		chat_id: chatId,
		text: markdownToHtml(response.text),
		parse_mode: "HTML",
	});
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
	const t = await getBotTranslate(DEFAULT_LANGUAGE);

	if (!code) {
		await sendMessage(bot.botToken, {
			chat_id: chatId,
			text: escapeMarkdownV2(
				t("bot.static.linkUsage", "Please provide your link code: /link YOUR_CODE"),
			),
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
					t(
						"bot.static.linkSuccess",
						"Your Telegram account has been linked to Z8! Type /help to see available commands.",
					),
				),
				parse_mode: "MarkdownV2",
			});
			break;

		case "invalid_code":
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2(
					t("bot.static.linkInvalid", "Invalid link code. Please check your code and try again."),
				),
				parse_mode: "MarkdownV2",
			});
			break;

		case "expired":
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2(
					t(
						"bot.static.linkExpired",
						"This link code has expired. Please generate a new one from your Z8 settings.",
					),
				),
				parse_mode: "MarkdownV2",
			});
			break;

		case "already_linked":
			await sendMessage(bot.botToken, {
				chat_id: chatId,
				text: escapeMarkdownV2(
					t(
						"bot.static.linkAlreadyLinked",
						"This Telegram account is already linked to a Z8 account in this organization.",
					),
				),
				parse_mode: "MarkdownV2",
			});
			break;
	}
}
