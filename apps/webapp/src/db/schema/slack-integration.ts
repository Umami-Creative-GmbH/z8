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
// SLACK INTEGRATION (Multi-Workspace SaaS Bot)
// ============================================

/**
 * Per-organization Slack workspace configuration.
 * Created after successful OAuth2 install.
 */
export const slackWorkspaceConfig = pgTable(
	"slack_workspace_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Organization Link
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Slack Workspace Identity
		slackTeamId: text("slack_team_id").notNull(), // Slack workspace ID (T...)
		slackTeamName: text("slack_team_name"),

		// OAuth2 Tokens
		botAccessToken: text("bot_access_token").notNull(), // xoxb-...
		botUserId: text("bot_user_id"), // Bot user ID (U...)

		// Setup state
		// "active" = fully configured and working
		// "suspended" = temporarily disabled by admin
		// "disconnected" = unlinked by admin
		setupStatus: text("setup_status").default("active").notNull(),

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

		// Admin who installed this
		configuredByUserId: text("configured_by_user_id").references(() => user.id),
		configuredAt: timestamp("configured_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		// One workspace per organization
		uniqueIndex("slackWorkspaceConfig_organizationId_unique_idx").on(table.organizationId),
		uniqueIndex("slackWorkspaceConfig_slackTeamId_unique_idx").on(table.slackTeamId),
		index("slackWorkspaceConfig_setupStatus_idx").on(table.setupStatus),
	],
);

/**
 * OAuth2 state tokens for secure install flow.
 * Created when admin starts install, validated on callback.
 */
export const slackOAuthState = pgTable(
	"slack_oauth_state",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Random state token (used in OAuth URL)
		stateToken: text("state_token").notNull(),

		// Who initiated the OAuth flow
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Expiry and status
		expiresAt: timestamp("expires_at").notNull(), // 15 minutes
		status: text("status").default("pending").notNull(), // "pending" | "used" | "expired"

		usedAt: timestamp("used_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("slackOAuthState_stateToken_unique_idx").on(table.stateToken),
		index("slackOAuthState_organizationId_idx").on(table.organizationId),
		index("slackOAuthState_status_idx").on(table.status),
		index("slackOAuthState_expiresAt_idx").on(table.expiresAt),
	],
);

/**
 * Maps Z8 users to their Slack identities.
 * Uses link codes (not email matching) for explicit user consent.
 */
export const slackUserMapping = pgTable(
	"slack_user_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Identity
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Slack Identity
		slackUserId: text("slack_user_id").notNull(), // Slack user ID (U...)
		slackTeamId: text("slack_team_id").notNull(), // Workspace ID
		slackUsername: text("slack_username"), // @username (can change)
		slackDisplayName: text("slack_display_name"),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastSeenAt: timestamp("last_seen_at"),
	},
	(table) => [
		index("slackUserMapping_userId_idx").on(table.userId),
		index("slackUserMapping_organizationId_idx").on(table.organizationId),
		index("slackUserMapping_slackUserId_idx").on(table.slackUserId),
		// One Z8 user = one Slack user per organization
		uniqueIndex("slackUserMapping_user_org_unique_idx").on(table.userId, table.organizationId),
		// One Slack user = one Z8 user per workspace
		uniqueIndex("slackUserMapping_slack_team_unique_idx").on(table.slackUserId, table.slackTeamId),
	],
);

/**
 * Link codes for connecting Slack accounts to Z8.
 * User generates code in Z8 settings, runs /link CODE in Slack.
 */
export const slackLinkCode = pgTable(
	"slack_link_code",
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

		// When used, the Slack user ID that claimed it
		claimedBySlackUserId: text("claimed_by_slack_user_id"),
		claimedAt: timestamp("claimed_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("slackLinkCode_code_unique_idx").on(table.code),
		index("slackLinkCode_userId_idx").on(table.userId),
		index("slackLinkCode_organizationId_idx").on(table.organizationId),
		index("slackLinkCode_status_idx").on(table.status),
		index("slackLinkCode_expiresAt_idx").on(table.expiresAt),
	],
);

/**
 * Stores Slack DM channel IDs for proactive messaging.
 * Simpler than Teams conversation references - just a channel_id.
 */
export const slackConversation = pgTable(
	"slack_conversation",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),

		// Slack channel details
		channelId: text("channel_id").notNull(), // DM channel ID (D...) or channel (C...)
		channelType: text("channel_type").default("im").notNull(), // "im" | "channel" | "mpim"

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastUsedAt: timestamp("last_used_at"),
	},
	(table) => [
		index("slackConversation_organizationId_idx").on(table.organizationId),
		index("slackConversation_userId_idx").on(table.userId),
		index("slackConversation_channelId_idx").on(table.channelId),
		index("slackConversation_isActive_idx").on(table.isActive),
		// One conversation per user per org per channel type
		uniqueIndex("slackConversation_user_org_type_unique_idx").on(
			table.userId,
			table.organizationId,
			table.channelType,
		),
	],
);

/**
 * Tracks approval messages sent via Slack.
 * Used for updating messages after approve/reject and deduplication.
 */
export const slackApprovalMessage = pgTable(
	"slack_approval_message",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Link to approval request
		approvalRequestId: uuid("approval_request_id")
			.notNull()
			.references(() => approvalRequest.id, { onDelete: "cascade" }),

		// Slack message details (for editing the message)
		channelId: text("channel_id").notNull(),
		messageTs: text("message_ts").notNull(), // Slack uses timestamp as message ID

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
		index("slackApprovalMessage_organizationId_idx").on(table.organizationId),
		index("slackApprovalMessage_approvalRequestId_idx").on(table.approvalRequestId),
		index("slackApprovalMessage_recipientUserId_idx").on(table.recipientUserId),
		index("slackApprovalMessage_status_idx").on(table.status),
		uniqueIndex("slackApprovalMessage_approvalRequest_unique_idx").on(table.approvalRequestId),
	],
);

/**
 * Tracks escalation events for approval requests via Slack.
 */
export const slackEscalation = pgTable(
	"slack_escalation",
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
		index("slackEscalation_organizationId_idx").on(table.organizationId),
		index("slackEscalation_approvalRequestId_idx").on(table.approvalRequestId),
		index("slackEscalation_originalApproverId_idx").on(table.originalApproverId),
		index("slackEscalation_escalatedToApproverId_idx").on(table.escalatedToApproverId),
		index("slackEscalation_resolvedAt_idx").on(table.resolvedAt),
	],
);
