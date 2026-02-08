/**
 * Discord Integration Types
 *
 * Type definitions specific to the Discord bot integration.
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
// DISCORD API TYPES (subset of Discord API v10)
// ============================================

/** Discord interaction types */
export const InteractionType = {
	PING: 1,
	APPLICATION_COMMAND: 2,
	MESSAGE_COMPONENT: 3,
} as const;

/** Discord interaction response types */
export const InteractionResponseType = {
	PONG: 1,
	CHANNEL_MESSAGE_WITH_SOURCE: 4,
	DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
	DEFERRED_UPDATE_MESSAGE: 6,
	UPDATE_MESSAGE: 7,
} as const;

/** Discord button styles */
export const ButtonStyle = {
	PRIMARY: 1,
	SECONDARY: 2,
	SUCCESS: 3,
	DANGER: 4,
	LINK: 5,
} as const;

/** Discord component types */
export const ComponentType = {
	ACTION_ROW: 1,
	BUTTON: 2,
} as const;

/** Discord application command option types */
export const CommandOptionType = {
	STRING: 3,
} as const;

export interface DiscordInteraction {
	id: string;
	application_id: string;
	type: number;
	data?: DiscordInteractionData;
	token: string;
	member?: DiscordMember;
	user?: DiscordUser;
	channel_id?: string;
	message?: DiscordMessage;
}

export interface DiscordInteractionData {
	id?: string;
	name?: string;
	options?: DiscordCommandOption[];
	custom_id?: string;
	component_type?: number;
}

export interface DiscordCommandOption {
	name: string;
	type: number;
	value: string;
}

export interface DiscordMember {
	user: DiscordUser;
	nick?: string;
	roles: string[];
}

export interface DiscordUser {
	id: string;
	username: string;
	global_name?: string;
	discriminator?: string;
}

export interface DiscordMessage {
	id: string;
	channel_id: string;
	content?: string;
}

export interface DiscordEmbed {
	title?: string;
	description?: string;
	color?: number;
	fields?: DiscordEmbedField[];
	timestamp?: string;
	footer?: { text: string };
}

export interface DiscordEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface DiscordActionRow {
	type: 1; // ACTION_ROW
	components: DiscordButton[];
}

export interface DiscordButton {
	type: 2; // BUTTON
	style: number;
	label: string;
	custom_id?: string;
	disabled?: boolean;
}

export interface DiscordSlashCommandDefinition {
	name: string;
	description: string;
	options?: {
		type: number;
		name: string;
		description: string;
		required: boolean;
	}[];
}

// ============================================
// DISCORD BOT CONFIG
// ============================================

export interface ResolvedDiscordBot {
	organizationId: string;
	botToken: string;
	applicationId: string;
	publicKey: string;
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

export interface ResolvedDiscordUser {
	userId: string;
	employeeId: string;
	organizationId: string;
	discordUserId: string;
	discordUsername: string | null;
}

// ============================================
// CALLBACK DATA
// ============================================

/**
 * Callback data format for button interactions.
 * Encoded as JSON string in custom_id field (max 100 chars).
 */
export interface ApprovalButtonData {
	a: "ap" | "rj"; // action: approve or reject
	id: string; // approval request ID
}
