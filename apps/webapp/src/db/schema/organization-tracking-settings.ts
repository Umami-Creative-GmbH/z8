import { sql } from "drizzle-orm";
import {
	check,
	date,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

/** Explicit tracking dates are independent from work-record admission and approval rollouts. */
export const organizationTrackingSettings = pgTable(
	"organization_tracking_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		trackingStartDate: date("tracking_start_date", {
			mode: "string",
		}).notNull(),
		// No row, or a null activation, preserves an existing organization's legacy calculations.
		activatedAt: timestamp("activated_at", { withTimezone: true }),
		activatedBy: text("activated_by").references(() => user.id, {
			onDelete: "set null",
		}),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		check(
			"organization_tracking_settings_revision_check",
			sql`${table.revision} >= 1`,
		),
	],
);
