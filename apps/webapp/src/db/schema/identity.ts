import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { team, employee } from "./organization";
import { roleEnum } from "./enums";

// ============================================
// IDENTITY MODULE ENUMS
// ============================================

export const lifecycleEventTypeEnum = pgEnum("lifecycle_event_type", [
	"join",
	"move",
	"leave",
]);

export const lifecycleSourceEnum = pgEnum("lifecycle_source", [
	"manual",
	"scim",
	"sso",
	"invite_code",
]);

export const idpTypeEnum = pgEnum("idp_type", ["sso", "scim"]);

// ============================================
// USER LIFECYCLE CONFIGURATION
// Per-organization settings for join/move/leave lifecycle
// ============================================

export const userLifecycleConfig = pgTable(
	"user_lifecycle_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// JOIN lifecycle settings
		// When true, new members require admin approval before activation
		requireJoinApproval: boolean("require_join_approval").default(true).notNull(),
		// Auto-approve users provisioned via SCIM (overrides requireJoinApproval)
		autoApproveViaScim: boolean("auto_approve_via_scim").default(false).notNull(),
		// Auto-approve users provisioned via SSO (overrides requireJoinApproval)
		autoApproveViaSso: boolean("auto_approve_via_sso").default(false).notNull(),

		// MOVE lifecycle settings
		// When true, role/team changes require approval
		requireMoveApproval: boolean("require_move_approval").default(false).notNull(),
		// Minimum role required to approve move requests
		moveApproverRole: roleEnum("move_approver_role").default("admin"),

		// LEAVE lifecycle settings
		// What happens when a user leaves (via SCIM deprovision, manual removal, etc.)
		// - "soft_delete": Set employee.isActive=false, preserve all data for compliance
		// - "suspend": Set member.status="suspended", can be reactivated
		leaveAction: text("leave_action")
			.$type<"soft_delete" | "suspend">()
			.default("suspend")
			.notNull(),
		// For soft_delete: days to retain data before permanent deletion (null = forever)
		softDeleteRetentionDays: integer("soft_delete_retention_days").default(90),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("userLifecycleConfig_organizationId_idx").on(table.organizationId)],
);

// ============================================
// ROLE TEMPLATES
// Reusable permission bundles for automated provisioning
// ============================================

export const roleTemplate = pgTable(
	"role_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		// Null organizationId = global template (available to all orgs)
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),

		// Template metadata
		name: text("name").notNull(),
		description: text("description"),
		// Global templates are system-defined and available to all organizations
		isGlobal: boolean("is_global").default(false).notNull(),
		isActive: boolean("is_active").default(true).notNull(),

		// Employee role assignment
		employeeRole: roleEnum("employee_role").default("employee").notNull(),

		// Default team assignment (optional)
		defaultTeamId: uuid("default_team_id").references(() => team.id, {
			onDelete: "set null",
		}),

		// Team permissions (JSONB for flexibility)
		// These are applied via PermissionsService when template is assigned
		teamPermissions: jsonb("team_permissions")
			.$type<{
				canCreateTeams?: boolean;
				canManageTeamMembers?: boolean;
				canManageTeamSettings?: boolean;
				canApproveTeamRequests?: boolean;
			}>()
			.default({}),

		// App access permissions
		canUseWebapp: boolean("can_use_webapp").default(true).notNull(),
		canUseDesktop: boolean("can_use_desktop").default(true).notNull(),
		canUseMobile: boolean("can_use_mobile").default(true).notNull(),

		// Associated conditional access policy (optional)
		accessPolicyId: uuid("access_policy_id"),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("roleTemplate_organizationId_idx").on(table.organizationId),
		index("roleTemplate_isGlobal_idx").on(table.isGlobal),
		index("roleTemplate_isActive_idx").on(table.isActive),
		// Unique name per organization (null org = global namespace)
		uniqueIndex("roleTemplate_org_name_idx").on(table.organizationId, table.name),
	],
);

// ============================================
// ROLE TEMPLATE MAPPING
// Maps IdP groups (from SSO/SCIM) to role templates
// ============================================

export const roleTemplateMapping = pgTable(
	"role_template_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// IdP group identifier
		idpType: idpTypeEnum("idp_type").notNull(),
		// External group ID from IdP (e.g., Okta group ID, Azure AD group ID)
		idpGroupId: text("idp_group_id").notNull(),
		// Human-readable group name for display
		idpGroupName: text("idp_group_name"),

		// Target role template
		roleTemplateId: uuid("role_template_id")
			.notNull()
			.references(() => roleTemplate.id, { onDelete: "cascade" }),

		// Priority (higher = applied first if multiple groups match)
		priority: integer("priority").default(0).notNull(),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("roleTemplateMapping_organizationId_idx").on(table.organizationId),
		index("roleTemplateMapping_roleTemplateId_idx").on(table.roleTemplateId),
		// Unique: one IdP group maps to one template per org
		uniqueIndex("roleTemplateMapping_unique_idx").on(
			table.organizationId,
			table.idpType,
			table.idpGroupId,
		),
	],
);

// ============================================
// USER ROLE TEMPLATE ASSIGNMENT
// Tracks which role template is assigned to each user
// ============================================

export const userRoleTemplateAssignment = pgTable(
	"user_role_template_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		roleTemplateId: uuid("role_template_id")
			.notNull()
			.references(() => roleTemplate.id, { onDelete: "cascade" }),

		// How the template was assigned
		assignmentSource: lifecycleSourceEnum("assignment_source").notNull(),
		// If assigned via IdP mapping, store the group ID
		idpGroupId: text("idp_group_id"),

		// Audit
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
		assignedBy: text("assigned_by").references(() => user.id),
	},
	(table) => [
		// One active template assignment per user per org
		uniqueIndex("userRoleTemplateAssignment_user_org_idx").on(
			table.userId,
			table.organizationId,
		),
		index("userRoleTemplateAssignment_roleTemplateId_idx").on(table.roleTemplateId),
	],
);

// ============================================
// USER LIFECYCLE EVENT
// Audit log for join/move/leave events
// ============================================

export const userLifecycleEvent = pgTable(
	"user_lifecycle_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),

		// Event type
		eventType: lifecycleEventTypeEnum("event_type").notNull(),
		// How the event was triggered
		source: lifecycleSourceEnum("source").notNull(),

		// Event metadata (JSONB for flexibility)
		metadata: jsonb("metadata").$type<{
			// For JOIN events
			inviteCodeId?: string;
			scimExternalId?: string;
			ssoProviderId?: string;

			// For MOVE events
			fromRole?: string;
			toRole?: string;
			fromTeamId?: string;
			toTeamId?: string;
			fromTemplateId?: string;
			toTemplateId?: string;

			// For LEAVE events
			reason?: string;
			retainDataUntil?: string; // ISO date

			// General
			initiatedBy?: string;
			notes?: string;
		}>(),

		// Approval tracking (for events requiring approval)
		requiresApproval: boolean("requires_approval").default(false).notNull(),
		approvalStatus: text("approval_status")
			.$type<"pending" | "approved" | "rejected">()
			.default("pending"),
		approvedBy: text("approved_by").references(() => user.id),
		approvedAt: timestamp("approved_at"),
		rejectionReason: text("rejection_reason"),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("userLifecycleEvent_organizationId_idx").on(table.organizationId),
		index("userLifecycleEvent_userId_idx").on(table.userId),
		index("userLifecycleEvent_eventType_idx").on(table.eventType),
		index("userLifecycleEvent_approvalStatus_idx").on(table.approvalStatus),
		index("userLifecycleEvent_createdAt_idx").on(table.createdAt),
	],
);
