import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";

// ============================================
// CUSTOMERS
// ============================================

// Customer entity for project assignment (org-level, reusable across projects)
export const customer = pgTable(
	"customer",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Core fields
		name: text("name").notNull(), // Company name (required)

		// Optional contact/business info
		address: text("address"),
		vatId: text("vat_id"),
		email: text("email"),
		contactPerson: text("contact_person"),
		phone: text("phone"),
		website: text("website"),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

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
		index("customer_organizationId_idx").on(table.organizationId),
		index("customer_isActive_idx").on(table.isActive),
		uniqueIndex("customer_org_name_idx").on(table.organizationId, table.name),
	],
);
