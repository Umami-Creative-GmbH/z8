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
import { employee } from "./organization";
import { approvalRequest } from "./approval";

// ============================================
// TEAMS INTEGRATION (Multi-Tenant SaaS Bot)
// ============================================

/**
 * Maps Microsoft 365 tenants to Z8 organizations.
 * This is the KEY table for multi-tenant bot support.
 *
 * When a customer installs the Z8 bot from Teams App Directory,
 * their O365 admin must link their tenant to their Z8 organization.
 */
export const teamsTenantConfig = pgTable(
	"teams_tenant_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Microsoft 365 Tenant Identity
		tenantId: text("tenant_id").notNull().unique(), // Azure AD Tenant ID (GUID)
		tenantName: text("tenant_name"), // Friendly name (e.g., "Contoso Ltd")

		// Z8 Organization Link
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Setup state
		// "pending" = installed but not configured
		// "active" = fully configured and working
		// "suspended" = temporarily disabled by admin
		// "disconnected" = unlinked by admin
		setupStatus: text("setup_status").default("pending").notNull(),

		// Feature configuration (O365 admin controls these via Z8 settings UI)
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

		// Service URL for proactive messaging (captured on first bot interaction)
		serviceUrl: text("service_url"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("teamsTenantConfig_organizationId_idx").on(table.organizationId),
		index("teamsTenantConfig_tenantId_idx").on(table.tenantId),
		index("teamsTenantConfig_setupStatus_idx").on(table.setupStatus),
		// Each M365 tenant can only link to one Z8 organization
		uniqueIndex("teamsTenantConfig_tenantId_unique_idx").on(table.tenantId),
	],
);

/**
 * Maps Z8 users to their Teams identities within an organization.
 * Uses email matching for automatic linking.
 */
export const teamsUserMapping = pgTable(
	"teams_user_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Z8 Identity
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Teams Identity
		teamsUserId: text("teams_user_id").notNull(), // Microsoft AAD User Object ID
		teamsEmail: text("teams_email").notNull(), // Should match user.email
		teamsTenantId: text("teams_tenant_id").notNull(), // Microsoft Tenant ID

		// Optional Teams metadata
		teamsDisplayName: text("teams_display_name"),
		teamsUserPrincipalName: text("teams_user_principal_name"), // UPN (user@domain.com)

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastSeenAt: timestamp("last_seen_at"), // Track when user last interacted with bot
	},
	(table) => [
		index("teamsUserMapping_userId_idx").on(table.userId),
		index("teamsUserMapping_organizationId_idx").on(table.organizationId),
		index("teamsUserMapping_teamsUserId_idx").on(table.teamsUserId),
		index("teamsUserMapping_teamsEmail_idx").on(table.teamsEmail),
		index("teamsUserMapping_teamsTenantId_idx").on(table.teamsTenantId),
		// One Z8 user = one Teams user per organization
		uniqueIndex("teamsUserMapping_user_org_unique_idx").on(table.userId, table.organizationId),
		// One Teams user = one Z8 user per tenant
		uniqueIndex("teamsUserMapping_teams_tenant_unique_idx").on(
			table.teamsUserId,
			table.teamsTenantId,
		),
	],
);

/**
 * Stores Bot Framework conversation references for proactive messaging.
 * Required to send messages to users without them initiating first.
 */
export const teamsConversation = pgTable(
	"teams_conversation",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),

		// Bot Framework conversation reference (stored as JSON string)
		conversationReference: text("conversation_reference").notNull(),

		// Teams metadata
		teamsConversationId: text("teams_conversation_id").notNull(),
		teamsServiceUrl: text("teams_service_url").notNull(),
		teamsTenantId: text("teams_tenant_id").notNull(),
		// "personal" = 1:1 chat, "channel" = team channel, "groupChat" = group chat
		conversationType: text("conversation_type").default("personal").notNull(),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		lastUsedAt: timestamp("last_used_at"),
	},
	(table) => [
		index("teamsConversation_organizationId_idx").on(table.organizationId),
		index("teamsConversation_userId_idx").on(table.userId),
		index("teamsConversation_teamsConversationId_idx").on(table.teamsConversationId),
		index("teamsConversation_teamsTenantId_idx").on(table.teamsTenantId),
		index("teamsConversation_isActive_idx").on(table.isActive),
		// One conversation per user per org per type
		uniqueIndex("teamsConversation_user_org_type_unique_idx").on(
			table.userId,
			table.organizationId,
			table.conversationType,
		),
	],
);

/**
 * Tracks approval Adaptive Cards sent via Teams.
 * Used for updating card status after approve/reject and deduplication.
 */
export const teamsApprovalCard = pgTable(
	"teams_approval_card",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Link to approval request
		approvalRequestId: uuid("approval_request_id")
			.notNull()
			.references(() => approvalRequest.id, { onDelete: "cascade" }),

		// Teams message details (for updating the card)
		teamsMessageId: text("teams_message_id").notNull(),
		teamsConversationId: text("teams_conversation_id").notNull(),
		teamsActivityId: text("teams_activity_id").notNull(), // Bot Framework activity ID

		// Recipient
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Status
		// "sent" = card sent, awaiting response
		// "approved" = user clicked approve
		// "rejected" = user clicked reject
		// "expired" = approval was handled elsewhere or timed out
		status: text("status").default("sent").notNull(),
		respondedAt: timestamp("responded_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("teamsApprovalCard_organizationId_idx").on(table.organizationId),
		index("teamsApprovalCard_approvalRequestId_idx").on(table.approvalRequestId),
		index("teamsApprovalCard_recipientUserId_idx").on(table.recipientUserId),
		index("teamsApprovalCard_status_idx").on(table.status),
		// One card per approval request (can update existing card)
		uniqueIndex("teamsApprovalCard_approvalRequest_unique_idx").on(table.approvalRequestId),
	],
);

/**
 * Tracks escalation events for approval requests.
 * When an approval times out, it escalates to the backup manager.
 */
export const teamsEscalation = pgTable(
	"teams_escalation",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Link to approval request
		approvalRequestId: uuid("approval_request_id")
			.notNull()
			.references(() => approvalRequest.id, { onDelete: "cascade" }),

		// Original approver (who didn't respond in time)
		originalApproverId: uuid("original_approver_id")
			.notNull()
			.references(() => employee.id),

		// Escalated to (backup manager)
		escalatedToApproverId: uuid("escalated_to_approver_id")
			.notNull()
			.references(() => employee.id),

		// Timing
		escalatedAt: timestamp("escalated_at").defaultNow().notNull(),
		timeoutHours: integer("timeout_hours").notNull(),

		// Resolution
		resolvedAt: timestamp("resolved_at"),
		// "approved" | "rejected" | "cancelled" | null (still pending)
		resolution: text("resolution"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("teamsEscalation_organizationId_idx").on(table.organizationId),
		index("teamsEscalation_approvalRequestId_idx").on(table.approvalRequestId),
		index("teamsEscalation_originalApproverId_idx").on(table.originalApproverId),
		index("teamsEscalation_escalatedToApproverId_idx").on(table.escalatedToApproverId),
		index("teamsEscalation_resolvedAt_idx").on(table.resolvedAt),
	],
);
