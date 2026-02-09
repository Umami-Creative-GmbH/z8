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
// DISCORD INTEGRATION (Multi-Tenant SaaS Bot)
// ============================================

/**
 * Per-organization Discord bot configuration.
 * Each organization creates their own Discord bot via Developer Portal.
 */
export const discordBotConfig = pgTable(
	"discord_bot_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Organization Link
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Discord Bot Identity
		botToken: text("bot_token").notNull(), // Encrypted at rest
		applicationId: text("application_id").notNull(), // Discord application ID (for slash command registration)
		publicKey: text("public_key").notNull(), // Discord public key (for interaction signature verification)

		// Webhook configuration
		webhookSecret: text("webhook_secret").notNull(), // Random secret for webhook URL path
		interactionEndpointConfigured: boolean("interaction_endpoint_configured")
			.default(false)
			.notNull(),

		// Setup state
		// "pending" = token saved but slash commands not registered
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
		uniqueIndex("discordBotConfig_organizationId_unique_idx").on(table.organizationId),
		index("discordBotConfig_setupStatus_idx").on(table.setupStatus),
		// Webhook secret is used in URL path for routing
		uniqueIndex("discordBotConfig_webhookSecret_unique_idx").on(table.webhookSecret),
	],
);

/**
 * Maps Z8 users to their Discord identities.
 * Uses link codes (not email matching) since Discord doesn't expose email via interactions.
 */
export const discordUserMapping = pgTable(
	"discord_user_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Identity
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Discord Identity
		discordUserId: text("discord_user_id").notNull(), // Discord snowflake ID (as string)
		discordUsername: text("discord_username"), // e.g., "johndoe" (can change)
		discordDisplayName: text("discord_display_name"),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastSeenAt: timestamp("last_seen_at"),
	},
	(table) => [
		index("discordUserMapping_userId_idx").on(table.userId),
		index("discordUserMapping_organizationId_idx").on(table.organizationId),
		index("discordUserMapping_discordUserId_idx").on(table.discordUserId),
		// One Z8 user = one Discord user per organization
		uniqueIndex("discordUserMapping_user_org_unique_idx").on(table.userId, table.organizationId),
		// One Discord user = one Z8 user per organization
		uniqueIndex("discordUserMapping_discord_org_unique_idx").on(
			table.discordUserId,
			table.organizationId,
		),
	],
);

/**
 * Stores Discord DM channel IDs for proactive messaging.
 * Discord requires creating a DM channel first, then sending messages to it.
 */
export const discordConversation = pgTable(
	"discord_conversation",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),

		// Discord DM channel details
		channelId: text("channel_id").notNull(), // Discord DM channel ID

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastUsedAt: timestamp("last_used_at"),
	},
	(table) => [
		index("discordConversation_organizationId_idx").on(table.organizationId),
		index("discordConversation_userId_idx").on(table.userId),
		index("discordConversation_channelId_idx").on(table.channelId),
		index("discordConversation_isActive_idx").on(table.isActive),
		// One DM conversation per user per org
		uniqueIndex("discordConversation_user_org_unique_idx").on(table.userId, table.organizationId),
	],
);

/**
 * Link codes for connecting Discord accounts to Z8.
 * User generates a code in Z8 settings, sends /link CODE to the bot.
 */
export const discordLinkCode = pgTable(
	"discord_link_code",
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

		// When used, the Discord user ID that claimed it
		claimedByDiscordUserId: text("claimed_by_discord_user_id"),
		claimedAt: timestamp("claimed_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("discordLinkCode_code_unique_idx").on(table.code),
		index("discordLinkCode_userId_idx").on(table.userId),
		index("discordLinkCode_organizationId_idx").on(table.organizationId),
		index("discordLinkCode_status_idx").on(table.status),
		index("discordLinkCode_expiresAt_idx").on(table.expiresAt),
	],
);

/**
 * Tracks approval messages sent via Discord.
 * Used for updating messages after approve/reject and deduplication.
 */
export const discordApprovalMessage = pgTable(
	"discord_approval_message",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Link to approval request
		approvalRequestId: uuid("approval_request_id")
			.notNull()
			.references(() => approvalRequest.id, { onDelete: "cascade" }),

		// Discord message details (for editing the message)
		channelId: text("channel_id").notNull(),
		messageId: text("message_id").notNull(), // Discord message ID

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
		index("discordApprovalMessage_organizationId_idx").on(table.organizationId),
		index("discordApprovalMessage_approvalRequestId_idx").on(table.approvalRequestId),
		index("discordApprovalMessage_recipientUserId_idx").on(table.recipientUserId),
		index("discordApprovalMessage_status_idx").on(table.status),
		uniqueIndex("discordApprovalMessage_approvalRequest_recipient_unique_idx").on(
			table.approvalRequestId,
			table.recipientUserId,
		),
	],
);

/**
 * Tracks escalation events for approval requests via Discord.
 */
export const discordEscalation = pgTable(
	"discord_escalation",
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
		index("discordEscalation_organizationId_idx").on(table.organizationId),
		index("discordEscalation_approvalRequestId_idx").on(table.approvalRequestId),
		index("discordEscalation_originalApproverId_idx").on(table.originalApproverId),
		index("discordEscalation_escalatedToApproverId_idx").on(table.escalatedToApproverId),
		index("discordEscalation_resolvedAt_idx").on(table.resolvedAt),
	],
);
