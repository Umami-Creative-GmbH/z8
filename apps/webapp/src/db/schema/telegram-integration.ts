import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { approvalRequest } from "./approval";
import { employee } from "./organization";

// ============================================
// TELEGRAM INTEGRATION (Multi-Tenant SaaS Bot)
// ============================================

/**
 * Per-organization Telegram bot configuration.
 * Each organization provides their own bot token from BotFather.
 */
export const telegramBotConfig = pgTable(
	"telegram_bot_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Organization Link
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Telegram Bot Identity
		botToken: text("bot_token").notNull(), // Sentinel value — real token stored in Vault at telegram/bot_token
		botUsername: text("bot_username"), // e.g., "z8_acme_bot"
		botDisplayName: text("bot_display_name"), // e.g., "Z8 Acme Time Tracking"

		// Webhook configuration
		webhookSecret: text("webhook_secret").notNull(), // Random secret for webhook URL path
		webhookRegistered: boolean("webhook_registered").default(false).notNull(),

		// Setup state
		// "pending" = token saved but webhook not registered
		// "active" = fully configured and working
		// "suspended" = temporarily disabled by admin
		// "disconnected" = unlinked by admin
		setupStatus: text("setup_status").default("pending").notNull(),

		// Feature configuration
		enableApprovals: boolean("enable_approvals").default(true).notNull(),
		enableCommands: boolean("enable_commands").default(true).notNull(),
		enableDailyDigest: boolean("enable_daily_digest").default(true).notNull(),
		enableEscalations: boolean("enable_escalations").default(true).notNull(),

		// Daily digest settings
		digestTime: text("digest_time").default("08:00").notNull(), // HH:mm format
		digestTimezone: text("digest_timezone").default("UTC").notNull(),

		// Escalation settings
		escalationTimeoutHours: integer("escalation_timeout_hours").default(24).notNull(),

		// Admin who configured this
		configuredByUserId: text("configured_by_user_id").references(() => user.id),
		configuredAt: timestamp("configured_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		// One bot per organization
		uniqueIndex("telegramBotConfig_organizationId_unique_idx").on(table.organizationId),
		index("telegramBotConfig_setupStatus_idx").on(table.setupStatus),
		// Webhook secret is used in URL path for routing
		uniqueIndex("telegramBotConfig_webhookSecret_unique_idx").on(table.webhookSecret),
	],
);

/**
 * Maps Z8 users to their Telegram identities.
 * Uses link codes (not email matching) since Telegram doesn't expose email.
 */
export const telegramUserMapping = pgTable(
	"telegram_user_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Identity
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Telegram Identity
		telegramUserId: text("telegram_user_id").notNull(), // Telegram numeric user ID (as string)
		telegramUsername: text("telegram_username"), // @username (optional, can change)
		telegramDisplayName: text("telegram_display_name"),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastSeenAt: timestamp("last_seen_at"),
	},
	(table) => [
		index("telegramUserMapping_userId_idx").on(table.userId),
		index("telegramUserMapping_organizationId_idx").on(table.organizationId),
		index("telegramUserMapping_telegramUserId_idx").on(table.telegramUserId),
		// One Z8 user = one Telegram user per organization
		uniqueIndex("telegramUserMapping_user_org_unique_idx").on(table.userId, table.organizationId),
		// One Telegram user = one Z8 user per organization
		uniqueIndex("telegramUserMapping_telegram_org_unique_idx").on(
			table.telegramUserId,
			table.organizationId,
		),
	],
);

/**
 * Stores Telegram chat IDs for proactive messaging.
 * Much simpler than Teams conversation references - just a chat_id.
 */
export const telegramConversation = pgTable(
	"telegram_conversation",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),

		// Telegram chat details
		chatId: text("chat_id").notNull(), // Telegram chat ID (numeric, as string)
		chatType: text("chat_type").default("private").notNull(), // "private" | "group" | "supergroup"

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastUsedAt: timestamp("last_used_at"),
	},
	(table) => [
		index("telegramConversation_organizationId_idx").on(table.organizationId),
		index("telegramConversation_userId_idx").on(table.userId),
		index("telegramConversation_chatId_idx").on(table.chatId),
		index("telegramConversation_isActive_idx").on(table.isActive),
		// One conversation per user per org per chat type
		uniqueIndex("telegramConversation_user_org_type_unique_idx").on(
			table.userId,
			table.organizationId,
			table.chatType,
		),
	],
);

/**
 * Link codes for connecting Telegram accounts to Z8.
 * User generates a code in Z8 settings, sends /link CODE to the bot.
 */
export const telegramLinkCode = pgTable(
	"telegram_link_code",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Identity (who generated the code)
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Link code (6 alphanumeric characters)
		code: text("code").notNull(),

		// Expiry (default 15 minutes)
		expiresAt: timestamp("expires_at").notNull(),

		// Status
		// "pending" = waiting for user to send to bot
		// "used" = successfully linked
		// "expired" = code expired without use
		status: text("status").default("pending").notNull(),

		// When used, the Telegram user ID that claimed it
		claimedByTelegramUserId: text("claimed_by_telegram_user_id"),
		claimedAt: timestamp("claimed_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("telegramLinkCode_code_unique_idx").on(table.code),
		index("telegramLinkCode_userId_idx").on(table.userId),
		index("telegramLinkCode_organizationId_idx").on(table.organizationId),
		index("telegramLinkCode_status_idx").on(table.status),
		index("telegramLinkCode_expiresAt_idx").on(table.expiresAt),
	],
);

/**
 * Tracks approval messages sent via Telegram.
 * Used for updating messages after approve/reject and deduplication.
 */
export const telegramApprovalMessage = pgTable(
	"telegram_approval_message",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Link to approval request
		approvalRequestId: uuid("approval_request_id")
			.notNull()
			.references(() => approvalRequest.id, { onDelete: "cascade" }),

		// Telegram message details (for editing the message)
		chatId: text("chat_id").notNull(),
		messageId: text("message_id").notNull(), // Telegram message ID

		// Recipient
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Status
		status: text("status").default("sent").notNull(),
		respondedAt: timestamp("responded_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("telegramApprovalMessage_organizationId_idx").on(table.organizationId),
		index("telegramApprovalMessage_approvalRequestId_idx").on(table.approvalRequestId),
		index("telegramApprovalMessage_recipientUserId_idx").on(table.recipientUserId),
		index("telegramApprovalMessage_status_idx").on(table.status),
		uniqueIndex("telegramApprovalMessage_approvalRequest_unique_idx").on(table.approvalRequestId),
	],
);

/**
 * Tracks escalation events for approval requests via Telegram.
 */
export const telegramEscalation = pgTable(
	"telegram_escalation",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		approvalRequestId: uuid("approval_request_id")
			.notNull()
			.references(() => approvalRequest.id, { onDelete: "cascade" }),

		originalApproverId: uuid("original_approver_id")
			.notNull()
			.references(() => employee.id),

		escalatedToApproverId: uuid("escalated_to_approver_id")
			.notNull()
			.references(() => employee.id),

		escalatedAt: timestamp("escalated_at").defaultNow().notNull(),
		timeoutHours: integer("timeout_hours").notNull(),

		resolvedAt: timestamp("resolved_at"),
		resolution: text("resolution"), // "approved" | "rejected" | "cancelled" | null

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("telegramEscalation_organizationId_idx").on(table.organizationId),
		index("telegramEscalation_approvalRequestId_idx").on(table.approvalRequestId),
		index("telegramEscalation_originalApproverId_idx").on(table.originalApproverId),
		index("telegramEscalation_escalatedToApproverId_idx").on(table.escalatedToApproverId),
		index("telegramEscalation_resolvedAt_idx").on(table.resolvedAt),
	],
);
