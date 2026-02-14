/**
 * Telegram Integration Types
 *
 * Type definitions specific to the Telegram bot integration.
 * Shared types are in @/lib/bot-platform/types.
 */

// Re-export shared types for convenience
export type {
	ApprovalCardData,
	ApprovalResolvedData,
	BotCommand,
	BotCommandContext,
	BotCommandResponse,
	DailyDigestData,
	PlatformConfig,
} from "@/lib/bot-platform/types";

// ============================================
// TELEGRAM API TYPES (subset of Telegram Bot API)
// ============================================

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
	entities?: TelegramMessageEntity[];
}

export interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	data?: string;
}

export interface TelegramUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
}

export interface TelegramChat {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
}

export interface TelegramMessageEntity {
	type: string;
	offset: number;
	length: number;
}

export interface TelegramInlineKeyboardButton {
	text: string;
	callback_data?: string;
	url?: string;
}

export interface TelegramInlineKeyboardMarkup {
	inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramSendMessageParams {
	chat_id: string | number;
	text: string;
	parse_mode?: "MarkdownV2" | "HTML";
	reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramEditMessageParams {
	chat_id: string | number;
	message_id: number;
	text: string;
	parse_mode?: "MarkdownV2" | "HTML";
	reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramApiResponse<T = unknown> {
	ok: boolean;
	result?: T;
	description?: string;
	error_code?: number;
}

// ============================================
// TELEGRAM BOT CONFIG
// ============================================

export interface ResolvedTelegramBot {
	organizationId: string;
	botToken: string;
	botUsername: string | null;
	webhookSecret: string;
	setupStatus: string;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface ResolvedTelegramUser {
	userId: string;
	employeeId: string;
	organizationId: string;
	telegramUserId: string;
	telegramUsername: string | null;
}

// ============================================
// CALLBACK DATA
// ============================================

/**
 * Callback data format for inline keyboard buttons.
 * Encoded as JSON string in callback_data field (max 64 bytes).
 */
export interface ApprovalCallbackData {
	a: "ap" | "rj"; // action: approve or reject
	id: string; // approval request ID (truncated UUID)
}

export interface CommandCallbackData {
	a: "cmd"; // action: execute command
	c: string; // command name
}

export interface LanguageCallbackData {
	a: "lang"; // action: set language
	l: string; // locale code (e.g., "de")
}
