import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

// ============================================
// AUDIT TRAIL
// ============================================

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Organization scoping - ALL audit logs are org-scoped
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// What was changed
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		action: text("action").notNull(), // "create", "update", "delete", "approve", "reject"

		// Who made the change
		performedBy: text("performed_by")
			.notNull()
			.references(() => user.id),
		employeeId: uuid("employee_id").references(() => employee.id), // If action was on behalf of employee

		// Change details
		changes: text("changes"), // JSON of what changed
		metadata: text("metadata"), // JSON for additional context

		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),

		timestamp: timestamp("timestamp").defaultNow().notNull(),
	},
	(table) => [
		index("auditLog_organizationId_idx").on(table.organizationId),
		index("auditLog_organizationId_timestamp_idx").on(table.organizationId, table.timestamp),
		index("auditLog_entityType_entityId_idx").on(table.entityType, table.entityId),
		index("auditLog_performedBy_idx").on(table.performedBy),
		index("auditLog_timestamp_idx").on(table.timestamp),
	],
);
