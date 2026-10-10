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
import { organization } from "../auth-schema";
import { absenceEntry } from "./absence";
import { employee } from "./organization";

/**
 * Sent markers of the cover summaries (#1018, spec #802, migration 0193): one
 * per absence, deputy and kind, claimed before notifying so each summary goes
 * out at most once, even with in-app notifications off. `cover_start` tells the
 * deputy what is waiting; `return` tells the approver what the deputy decided.
 */
export const approvalDeputyCoverSummary = pgTable(
	"approval_deputy_cover_summary",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The absent approver X's absence. */
		absenceId: uuid("absence_id").notNull(),
		/** The covering deputy Y. */
		deputyEmployeeId: uuid("deputy_employee_id").notNull(),
		kind: text("kind").$type<"cover_start" | "return">().notNull(),
		/** X's local day the summary was sent on (`YYYY-MM-DD`). */
		localDate: date("local_date", { mode: "string" }).notNull(),
		/** Waiting approvals (cover start) or deputy decisions (return) it reported. */
		itemCount: integer("item_count").notNull(),
		sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("approvalDeputyCoverSummary_absence_deputy_kind_idx").on(
			table.organizationId,
			table.absenceId,
			table.deputyEmployeeId,
			table.kind,
		),
		index("approvalDeputyCoverSummary_organizationId_idx").on(table.organizationId),
		check(
			"approval_deputy_cover_summary_kind_check",
			sql`${table.kind} IN ('cover_start', 'return')`,
		),
		foreignKey({
			name: "approval_deputy_cover_summary_absence_fk",
			columns: [table.absenceId, table.organizationId],
			foreignColumns: [absenceEntry.id, absenceEntry.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "approval_deputy_cover_summary_deputy_fk",
			columns: [table.deputyEmployeeId, table.organizationId],
			foreignColumns: [employee.id, employee.organizationId],
		}).onDelete("cascade"),
	],
);
