import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
	SUBMISSION_CADENCE_KINDS,
	SUBMISSION_WEEKDAYS,
	type SubmissionCadenceKind,
	type SubmissionWeekday,
} from "@/lib/time-tracking/period-submissions/cadence";
import {
	DEFAULT_SECOND_REMINDER_DELAY_DAYS,
	MAX_SECOND_REMINDER_DELAY_DAYS,
	MIN_SECOND_REMINDER_DELAY_DAYS,
} from "@/lib/time-tracking/period-submissions/settings-policy";
import { organization, user } from "../auth-schema";

function textIn(column: string, values: readonly string[]): string {
	return `${column} IN (${values.map((value) => `'${value}'`).join(", ")})`;
}

/**
 * Per-organization period submission settings (#805). A missing row means the defaults. The
 * cadence itself is kept as a history in `period_submission_cadence_change`, because a change
 * takes effect only at the next period boundary the old and new cadence share.
 */
export const periodSubmissionSettings = pgTable(
	"period_submission_settings",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		secondReminderDelayDays: integer("second_reminder_delay_days")
			.default(DEFAULT_SECOND_REMINDER_DELAY_DAYS)
			.notNull(),
		revision: integer("revision").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		check(
			"period_submission_settings_delay_check",
			sql.raw(
				`second_reminder_delay_days BETWEEN ${MIN_SECOND_REMINDER_DELAY_DAYS} AND ${MAX_SECOND_REMINDER_DELAY_DAYS}`,
			),
		),
		check("period_submission_settings_revision_check", sql`${table.revision} >= 1`),
	],
);

/**
 * Every saved submission cadence of an organization, append-only. The derivation of expected
 * submission periods replays it to find when each cadence was in effect.
 */
export const periodSubmissionCadenceChange = pgTable(
	"period_submission_cadence_change",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		cadence: text("cadence").$type<SubmissionCadenceKind>().notNull(),
		/** Set exactly for a weekly cadence. */
		weekStartDay: text("week_start_day").$type<SubmissionWeekday>(),
		changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
		changedBy: text("changed_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		index("period_submission_cadence_change_org_idx").on(table.organizationId, table.changedAt),
		check(
			"period_submission_cadence_change_cadence_check",
			sql.raw(textIn("cadence", SUBMISSION_CADENCE_KINDS)),
		),
		check(
			"period_submission_cadence_change_week_start_check",
			sql.raw(
				`(week_start_day IS NULL OR ${textIn("week_start_day", SUBMISSION_WEEKDAYS)}) AND ((cadence = 'weekly') = (week_start_day IS NOT NULL))`,
			),
		),
	],
);
