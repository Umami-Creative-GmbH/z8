import { date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";

export const dailyDigestDelivery = pgTable(
	"daily_digest_delivery",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
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
		index("dailyDigestDelivery_organization_status_idx").on(table.organizationId, table.status),
	],
);
