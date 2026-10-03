import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";

export const organizationTimeTrackingSettings = pgTable(
	"organization_time_tracking_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		autoClockOutEnabled: boolean("auto_clock_out_enabled").default(true).notNull(),
		maxUninterruptedMinutes: integer("max_uninterrupted_minutes").default(720).notNull(),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		check(
			"organization_time_tracking_settings_limit_check",
			sql`${table.maxUninterruptedMinutes} BETWEEN 1 AND 2147483647`,
		),
		check("organization_time_tracking_settings_revision_check", sql`${table.revision} >= 1`),
	],
);
