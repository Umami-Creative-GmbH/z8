import {
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	index,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
/** A reviewed operation and its durable replay receipt commit with all affected vacation records. */
export const vacationReconciliation = pgTable(
	"vacation_reconciliation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
		fingerprint: text("fingerprint").notNull(),
		reviewedBy: text("reviewed_by")
			.notNull()
			.references(() => user.id),
		status: text("status")
			.$type<"reviewed" | "committed">()
			.default("reviewed")
			.notNull(),
		result: jsonb("result").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		committedAt: timestamp("committed_at"),
	},
	(table) => [
		index("vacationReconciliation_org_status_idx").on(
			table.organizationId,
			table.status,
		),
	],
);
