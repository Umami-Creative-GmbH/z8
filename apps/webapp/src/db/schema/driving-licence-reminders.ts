import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";

/** One recipient's delivery for a check/deadline/employment occurrence, never a read receipt. */
export const drivingLicenceReminderDelivery = pgTable(
	"driving_licence_reminder_delivery",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id"),
		occasionKey: text("occasion_key").notNull(),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		notificationId: uuid("notification_id"),
		emailState: text("email_state")
			.$type<"pending" | "sent" | "suppressed" | "obsolete" | "unavailable">()
			.default("pending")
			.notNull(),
		emailAttempts: integer("email_attempts").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		emailedAt: timestamp("emailed_at", { withTimezone: true }),
	},
	(t) => [
		index("driving_reminder_pending").on(t.organizationId, t.emailState),
		unique("driving_reminder_recipient_occasion").on(
			t.organizationId,
			t.occasionKey,
			t.recipientUserId,
		),
		foreignKey({
			columns: [t.employeeId, t.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
		check(
			"driving_reminder_email_state",
			sql`${t.emailState} IN ('pending','sent','suppressed','obsolete','unavailable')`,
		),
	],
);
