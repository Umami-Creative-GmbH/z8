import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	LegacyConversionFlag,
	LegacyDraftSnapshot,
} from "@/lib/travel-expenses/legacy-draft-conversion.types";
import { organization, user } from "../auth-schema";
import { travelExpenseReport } from "./travel-expense";

/**
 * A legacy claim draft an employee continued as a single-item report (#616).
 * At most one per claim, which makes conversion idempotent: a retry or a
 * concurrent second attempt returns the same report. The legacy claim row and
 * its attachments are never changed; a converted claim takes no further
 * uploads (`receipt-upload.ts`). The claim, item and owner are kept by value so
 * the record (and the provenance it shows) survives edits of the new draft,
 * including removing its expense; deleting the report removes it.
 */
export const travelExpenseLegacyDraftConversion = pgTable(
	"travel_expense_legacy_draft_conversion",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		claimId: uuid("claim_id").notNull(),
		reportId: uuid("report_id").notNull(),
		itemId: uuid("item_id").notNull(),
		legacyFacts: jsonb("legacy_facts").$type<LegacyDraftSnapshot>().notNull(),
		flags: jsonb("flags").$type<LegacyConversionFlag[]>().default(sql`'[]'::jsonb`).notNull(),
		convertedByUserId: text("converted_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		convertedAt: timestamp("converted_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_legacy_draft_conversion_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseLegacyDraftConversion_org_claim_idx").on(
			table.organizationId,
			table.claimId,
		),
		uniqueIndex("travelExpenseLegacyDraftConversion_org_report_idx").on(
			table.organizationId,
			table.reportId,
		),
		check(
			"travel_expense_legacy_draft_conversion_flags_check",
			sql`jsonb_typeof(${table.flags}) = 'array' AND jsonb_typeof(${table.legacyFacts}) = 'object'`,
		),
	],
);
