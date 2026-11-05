import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { notificationChannelEnum } from "./enums";
import { equipmentAssignment } from "./equipment";

/** Delivery evidence, never equipment state. Delete with retained assignment history (#1549). */
export const equipmentReminderDelivery = pgTable(
	"equipment_reminder_delivery",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentId: uuid("assignment_id").notNull(),
		deadline: date("deadline").notNull(),
		timezone: text("timezone").notNull(),
		occasionDate: date("occasion_date").notNull(),
		audience: text("audience", { enum: ["employee", "staff"] }).notNull(),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		channel: notificationChannelEnum("channel").notNull(),
		state: text("state", {
			enum: [
				"pending",
				"attempted",
				"sent",
				"suppressed",
				"obsolete",
				"unavailable",
			],
		})
			.notNull()
			.default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }),
	},
	(t) => [
		foreignKey({
			name: "equipment_reminder_assignment_org_fk",
			columns: [t.assignmentId, t.organizationId],
			foreignColumns: [
				equipmentAssignment.id,
				equipmentAssignment.organizationId,
			],
		}).onDelete("cascade"),
		unique("equipment_reminder_occasion_channel_unique").on(
			t.organizationId,
			t.assignmentId,
			t.deadline,
			t.timezone,
			t.occasionDate,
			t.audience,
			t.recipientUserId,
			t.channel,
		),
		check(
			"equipment_reminder_audience_check",
			sql`${t.audience} in ('employee', 'staff')`,
		),
		check(
			"equipment_reminder_state_check",
			sql`${t.state} in ('pending', 'attempted', 'sent', 'suppressed', 'obsolete', 'unavailable')`,
		),
	],
);
