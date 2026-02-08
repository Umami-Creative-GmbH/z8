import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

// ============================================
// CLOCKODO IMPORT USER MAPPING
// ============================================

/**
 * Maps Clockodo users to existing Z8 employees during import.
 * Created in the user-mapping wizard step before running the import.
 *
 * Mapping types:
 * - auto_email: auto-matched by email address
 * - manual: admin manually mapped to an existing employee
 * - new_employee: admin chose to create a new employee
 * - skipped: admin chose to skip this Clockodo user
 */
export const clockodoUserMapping = pgTable(
	"clockodo_user_mapping",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Organization scope
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Clockodo identity
		clockodoUserId: integer("clockodo_user_id").notNull(),
		clockodoUserName: text("clockodo_user_name").notNull(),
		clockodoUserEmail: text("clockodo_user_email").notNull(),

		// Z8 identity (nullable — null when skipped)
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "set null" }),

		// How the mapping was created
		mappingType: text("mapping_type").notNull(), // auto_email | manual | new_employee | skipped

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		// One mapping per Clockodo user per organization
		uniqueIndex("clockodoUserMapping_org_clockodoUser_unique_idx").on(
			table.organizationId,
			table.clockodoUserId,
		),
		index("clockodoUserMapping_organizationId_idx").on(table.organizationId),
		index("clockodoUserMapping_employeeId_idx").on(table.employeeId),
	],
);
