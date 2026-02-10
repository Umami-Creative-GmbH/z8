import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { roleEnum } from "./enums";

// ============================================
// CUSTOM ROLES
// ============================================

// Organization-scoped custom roles with configurable permissions
export const customRole = pgTable(
	"custom_role",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		color: text("color").default("#6366f1").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		baseTier: roleEnum("base_tier").default("employee").notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("customRole_organizationId_idx").on(table.organizationId),
		index("customRole_isActive_idx").on(table.isActive),
		uniqueIndex("customRole_org_name_idx").on(table.organizationId, table.name),
	],
);

// ============================================
// CUSTOM ROLE PERMISSIONS
// ============================================

// Individual permission grants for a custom role (action + subject pairs)
export const customRolePermission = pgTable(
	"custom_role_permission",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		customRoleId: uuid("custom_role_id")
			.notNull()
			.references(() => customRole.id, { onDelete: "cascade" }),
		action: text("action").notNull(),
		subject: text("subject").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("customRolePermission_customRoleId_idx").on(table.customRoleId),
		uniqueIndex("customRolePermission_unique_idx").on(
			table.customRoleId,
			table.action,
			table.subject,
		),
	],
);

// ============================================
// EMPLOYEE CUSTOM ROLE ASSIGNMENT (Many-to-Many)
// ============================================

// Junction table linking employees to custom roles
export const employeeCustomRole = pgTable(
	"employee_custom_role",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		customRoleId: uuid("custom_role_id")
			.notNull()
			.references(() => customRole.id, { onDelete: "cascade" }),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
		assignedBy: text("assigned_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("employeeCustomRole_employeeId_idx").on(table.employeeId),
		index("employeeCustomRole_customRoleId_idx").on(table.customRoleId),
		uniqueIndex("employeeCustomRole_unique_idx").on(table.employeeId, table.customRoleId),
	],
);

// ============================================
// CUSTOM ROLE AUDIT LOG
// ============================================

// Audit trail for custom role changes
export const customRoleAuditLog = pgTable(
	"custom_role_audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		customRoleId: uuid("custom_role_id").references(() => customRole.id, {
			onDelete: "set null",
		}),
		eventType: text("event_type")
			.$type<
				| "role_created"
				| "role_updated"
				| "role_deleted"
				| "permission_added"
				| "permission_removed"
				| "employee_assigned"
				| "employee_unassigned"
			>()
			.notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("customRoleAuditLog_organizationId_idx").on(table.organizationId),
		index("customRoleAuditLog_customRoleId_idx").on(table.customRoleId),
		index("customRoleAuditLog_eventType_idx").on(table.eventType),
		index("customRoleAuditLog_createdAt_idx").on(table.createdAt),
	],
);
