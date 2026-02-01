import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";

// ============================================
// SCIM EXTENDED CONFIGURATION
//
// Better Auth provides the core SCIM 2.0 protocol via @better-auth/scim plugin.
// This table extends it with organization-specific provisioning settings.
//
// Better Auth's scimProvider table handles:
// - providerId, scimToken, organizationId
//
// This table handles:
// - Auto-activation settings
// - Deprovision action (soft delete vs suspend)
// - Default role template assignment
// - Audit logging settings
// ============================================

export const scimProviderConfig = pgTable(
	"scim_provider_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Reference to Better Auth's scimProvider.providerId
		// This links our extended config to the Better Auth provider
		providerId: text("provider_id").notNull(),

		// Provisioning settings
		// When true, SCIM-provisioned users are auto-activated (no approval required)
		// When false, users go through the existing PendingMemberService workflow
		autoActivateUsers: boolean("auto_activate_users").default(false).notNull(),

		// When a user is deactivated via SCIM DELETE or active=false:
		// - "soft_delete": Set employee.isActive=false (preserves data for compliance)
		// - "suspend": Set member.status="suspended" (can be reactivated via SCIM)
		deprovisionAction: text("deprovision_action")
			.$type<"soft_delete" | "suspend">()
			.default("suspend")
			.notNull(),

		// Default role template to apply to SCIM-provisioned users
		// If no IdP group mapping matches, this template is applied
		defaultRoleTemplateId: uuid("default_role_template_id"),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("scimProviderConfig_organizationId_idx").on(table.organizationId),
		index("scimProviderConfig_providerId_idx").on(table.providerId),
	],
);

// ============================================
// SCIM PROVISIONING LOG
// Audit trail for SCIM provisioning events
// Complements Better Auth's SCIM operations with lifecycle tracking
// ============================================

export const scimProvisioningEventTypeEnum = pgEnum("scim_provisioning_event_type", [
	"user_created", // New user provisioned via SCIM
	"user_updated", // User attributes updated via SCIM
	"user_deactivated", // User deactivated (active=false)
	"user_reactivated", // User reactivated (active=true)
	"user_deleted", // User deleted via SCIM
	"group_created", // Group/team created via SCIM
	"group_updated", // Group/team updated via SCIM
	"group_deleted", // Group/team deleted via SCIM
	"group_member_added", // User added to group
	"group_member_removed", // User removed from group
	"role_template_applied", // Role template was applied to user
	"error", // Provisioning error occurred
]);

export const scimProvisioningLog = pgTable(
	"scim_provisioning_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Event type
		eventType: scimProvisioningEventTypeEnum("event_type").notNull(),

		// Affected resources
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		// For group events: the team ID
		teamId: uuid("team_id"),
		// SCIM external ID (from IdP)
		externalId: text("external_id"),

		// Event metadata
		metadata: jsonb("metadata").$type<{
			// SCIM request details
			scimUserName?: string;
			scimDisplayName?: string;
			scimExternalId?: string;
			scimGroupId?: string;

			// Role template info (if applied)
			roleTemplateId?: string;
			roleTemplateName?: string;

			// Provisioning decision
			autoActivated?: boolean;
			deprovisionAction?: "soft_delete" | "suspend";

			// Error details (if error event)
			errorCode?: string;
			errorMessage?: string;

			// IdP info
			idpProvider?: string;
		}>(),

		// Request context
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),

		// Timing
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("scimProvisioningLog_organizationId_idx").on(table.organizationId),
		index("scimProvisioningLog_eventType_idx").on(table.eventType),
		index("scimProvisioningLog_userId_idx").on(table.userId),
		index("scimProvisioningLog_createdAt_idx").on(table.createdAt),
	],
);
