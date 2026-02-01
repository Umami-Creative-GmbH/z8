import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user, organization } from "../auth-schema";

/**
 * Platform Admin Audit Log
 *
 * Tracks all actions performed by platform administrators.
 * This is separate from the org-scoped audit_log table.
 */
export const platformAdminAuditLog = pgTable(
	"platform_admin_audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		adminUserId: text("admin_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		action: text("action").notNull(), // "ban_user", "unban_user", "revoke_session", "suspend_org", "unsuspend_org", "delete_org"
		targetType: text("target_type").notNull(), // "user", "session", "organization"
		targetId: text("target_id").notNull(),
		metadata: text("metadata"), // JSON string with action-specific details
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("platform_admin_audit_log_admin_user_id_idx").on(table.adminUserId),
		index("platform_admin_audit_log_action_idx").on(table.action),
		index("platform_admin_audit_log_target_type_idx").on(table.targetType),
		index("platform_admin_audit_log_created_at_idx").on(table.createdAt),
	],
);

/**
 * Organization Suspension
 *
 * Tracks when organizations are suspended (put in read-only mode).
 * A suspended org exists but users cannot create/edit data.
 */
export const organizationSuspension = pgTable(
	"organization_suspension",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		reason: text("reason").notNull(),
		suspendedBy: text("suspended_by")
			.notNull()
			.references(() => user.id),
		suspendedAt: timestamp("suspended_at").defaultNow().notNull(),
		unsuspendedAt: timestamp("unsuspended_at"),
		unsuspendedBy: text("unsuspended_by").references(() => user.id),
		isActive: boolean("is_active").default(true).notNull(),
	},
	(table) => [
		index("organization_suspension_org_id_idx").on(table.organizationId),
		index("organization_suspension_is_active_idx").on(table.isActive),
	],
);

// Relations
export const platformAdminAuditLogRelations = relations(platformAdminAuditLog, ({ one }) => ({
	adminUser: one(user, {
		fields: [platformAdminAuditLog.adminUserId],
		references: [user.id],
	}),
}));

export const organizationSuspensionRelations = relations(organizationSuspension, ({ one }) => ({
	organization: one(organization, {
		fields: [organizationSuspension.organizationId],
		references: [organization.id],
	}),
	suspendedByUser: one(user, {
		fields: [organizationSuspension.suspendedBy],
		references: [user.id],
		relationName: "suspendedBy",
	}),
	unsuspendedByUser: one(user, {
		fields: [organizationSuspension.unsuspendedBy],
		references: [user.id],
		relationName: "unsuspendedBy",
	}),
}));
