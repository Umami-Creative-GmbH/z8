import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

export const dailyDigestDelivery = pgTable(
	"daily_digest_delivery",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		recipientUserId: text("recipient_user_id").notNull(),
		platform: text("platform").notNull(),
		type: text("type").notNull(),
		recipientLocalDate: date("recipient_local_date").notNull(),
		status: text("status").default("processing").notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
		sentAt: timestamp("sent_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("dailyDigestDelivery_recipient_date_unique_idx").on(
			table.organizationId,
			table.recipientUserId,
			table.platform,
			table.type,
			table.recipientLocalDate,
		),
		index("dailyDigestDelivery_organization_status_idx").on(
			table.organizationId,
			table.status,
		),
		check(
			"daily_digest_delivery_status_check",
			sql`${table.status} IN ('processing', 'sent', 'failed')`,
		),
		foreignKey({
			name: "daily_digest_delivery_organization_id_fkey",
			columns: [table.organizationId],
			foreignColumns: [organization.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "daily_digest_delivery_recipient_user_id_fkey",
			columns: [table.recipientUserId],
			foreignColumns: [user.id],
		}).onDelete("cascade"),
	],
);
