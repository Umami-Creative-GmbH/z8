import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { approvalStatusEnum } from "./enums";
// Import tables for FK references
import { employee } from "./organization";

// ============================================
// APPROVAL WORKFLOWS
// ============================================

export const approvalRequest = pgTable(
	"approval_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Polymorphic reference - can approve different entity types
		entityType: text("entity_type").notNull(), // "time_entry" | "absence_entry"
		entityId: uuid("entity_id").notNull(),

		requestedBy: uuid("requested_by")
			.notNull()
			.references(() => employee.id),
		approverId: uuid("approver_id")
			.notNull()
			.references(() => employee.id),

		status: approvalStatusEnum("status").default("pending").notNull(),
		reason: text("reason"),
		notes: text("notes"),

		approvedAt: timestamp("approved_at"),
		rejectionReason: text("rejection_reason"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("approvalRequest_entityType_entityId_idx").on(table.entityType, table.entityId),
		index("approvalRequest_approverId_idx").on(table.approverId),
		index("approvalRequest_status_idx").on(table.status),
	],
);
