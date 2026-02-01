import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { dayOfWeekEnum } from "./enums";
import { locationSubarea } from "./organization";

// ============================================
// COVERAGE TARGETS
// ============================================

/**
 * Coverage rules define minimum staffing requirements per subarea,
 * day of week, and time range. Used to calculate coverage gaps
 * in the shift scheduler.
 */
export const coverageRule = pgTable(
	"coverage_rule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		subareaId: uuid("subarea_id")
			.notNull()
			.references(() => locationSubarea.id, { onDelete: "cascade" }),

		// Time configuration
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		startTime: text("start_time").notNull(), // "HH:mm" format
		endTime: text("end_time").notNull(), // "HH:mm" format

		// Staffing requirement
		minimumStaffCount: integer("minimum_staff_count").notNull(),

		// Extensibility fields (for future skill-based coverage)
		priority: integer("priority").default(0).notNull(), // For conflict resolution if MAX isn't sufficient

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
		index("coverageRule_organizationId_idx").on(table.organizationId),
		index("coverageRule_subareaId_idx").on(table.subareaId),
		// Composite index for efficient rule lookups by org, subarea, and day
		index("coverageRule_org_subarea_dow_idx").on(
			table.organizationId,
			table.subareaId,
			table.dayOfWeek,
		),
	],
);

// ============================================
// COVERAGE SETTINGS (Per Organization)
// ============================================

/**
 * Organization-level coverage settings.
 * Controls behavior of coverage validation and publishing.
 */
export const coverageSettings = pgTable(
	"coverage_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.unique()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Publishing behavior
		allowPublishWithGaps: boolean("allow_publish_with_gaps").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [index("coverageSettings_organizationId_idx").on(table.organizationId)],
);
