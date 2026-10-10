import {
	date,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { absenceEntry } from "./absence";

/**
 * Sent markers of the deputy's day-before reminder (#1013): one per absence,
 * deputy and start date, claimed before notifying so the reminder is sent at
 * most once. A moved start date arms it again.
 */
export const absenceDeputyReminder = pgTable(
	"absence_deputy_reminder",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		absenceId: uuid("absence_id").notNull(),
		deputyEmployeeId: uuid("deputy_employee_id").notNull(),
		startDate: date("start_date", { mode: "string" }).notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("absenceDeputyReminder_absence_deputy_start_idx").on(
			table.absenceId,
			table.deputyEmployeeId,
			table.startDate,
		),
		index("absenceDeputyReminder_organizationId_idx").on(table.organizationId),
		foreignKey({
			name: "absence_deputy_reminder_absence_fk",
			columns: [table.absenceId, table.organizationId],
			foreignColumns: [absenceEntry.id, absenceEntry.organizationId],
		}).onDelete("cascade"),
	],
);
