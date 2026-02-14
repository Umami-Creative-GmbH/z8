/**
 * Bot Platform - Shared Types
 *
 * Platform-agnostic type definitions shared by all bot integrations
 * (Microsoft Teams, Telegram, etc.).
 */

// ============================================
// PLATFORM ENUM
// ============================================

export type BotPlatform = "teams" | "telegram" | "discord" | "slack";

// ============================================
// PLATFORM CONFIG
// ============================================

/**
 * Platform-agnostic configuration for a bot integration.
 * Each platform adapter maps its own config to this shape.
 */
export interface PlatformConfig {
	organizationId: string;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

// ============================================
// COMMAND TYPES
// ============================================

/**
 * Platform-agnostic command context passed to handlers.
 */
export interface BotCommandContext {
	platform: BotPlatform;
	organizationId: string;
	employeeId: string;
	userId: string;
	/** Platform-specific user ID (Teams AAD Object ID or Telegram user ID) */
	platformUserId: string;
	config: PlatformConfig;
	args: string[];
	/** User's preferred locale (e.g., "en", "de") */
	locale: string;
}

/**
 * Platform-agnostic command definition.
 */
export interface BotCommand {
	/** Command name (e.g., "clockedin") */
	name: string;
	/** Alternative names that trigger this command */
	aliases?: string[];
	/** Help text shown in /help */
	description: string;
	/** Usage example */
	usage: string;
	/** Whether user must be linked to Z8 account */
	requiresAuth: boolean;
	/** Handler function */
	handler: (ctx: BotCommandContext) => Promise<BotCommandResponse>;
}

/**
 * Platform-agnostic command response.
 *
 * Commands return text or a structured card. The platform adapter
 * is responsible for rendering cards in the platform's native format.
 */
export interface BotCommandResponse {
	/** Response type */
	type: "text" | "card";
	/** Plain text response (for type: "text" or as fallback for cards) */
	text: string;
	/**
	 * Platform-specific card payload.
	 * - Teams: Adaptive Card JSON
	 * - Telegram: rendered by TelegramRenderer into MarkdownV2 + inline keyboard
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Card payloads vary by platform
	card?: any;
}

// ============================================
// APPROVAL CARD DATA (shared across platforms)
// ============================================

/**
 * Data for building an approval notification (card or message).
 */
export interface ApprovalCardData {
	approvalId: string;
	entityType: "absence_entry" | "time_entry";
	requesterName: string;
	requesterEmail?: string;
	reason?: string;
	createdAt: Date;
	// Absence-specific
	absenceCategory?: string;
	startDate?: string;
	endDate?: string;
	days?: number;
	// Time correction-specific
	originalTime?: string;
	correctedTime?: string;
}

/**
 * Data for resolved approval (after approve/reject action).
 */
export interface ApprovalResolvedData {
	action: "approved" | "rejected";
	approverName: string;
	resolvedAt: Date;
}

// ============================================
// DAILY DIGEST DATA (shared across platforms)
// ============================================

/**
 * Data for building a daily digest message.
 */
export interface DailyDigestData {
	date: Date;
	timezone: string;
	pendingApprovals: number;
	employeesOut: Array<{
		name: string;
		category: string;
		returnDate: string;
	}>;
	employeesClockedIn: Array<{
		name: string;
		clockedInAt: string;
		durationSoFar: string;
	}>;
	coverageGaps?: Array<{
		subareaName: string;
		locationName: string;
		timeSlot: string;
		scheduled: number;
		actual: number;
		shortage: number;
	}>;
	openShiftsToday?: number;
	openShiftsTomorrow?: number;
	compliancePending?: number;
}
