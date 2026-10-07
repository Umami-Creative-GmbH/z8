import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";
import { travelExpenseReport } from "./travel-expense";

// Links an adjustment report to the exported or reimbursed report it corrects
// (#615). The adjustment report is an ordinary report (a corrected copy of the
// approved facts) that is reviewed afresh; once approved, its frozen signed
// delta joins the original report's settlement account. The original report,
// its decisions, export batches and reimbursements are never changed. The copy
// source (the original or the latest approved adjustment) is kept by value.
// Immutable: an UPDATE trigger refuses every change.
export const travelExpenseReportAdjustment = pgTable(
	"travel_expense_report_adjustment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The adjustment report. */
		reportId: uuid("report_id").notNull(),
		/** The report whose settlement account the delta corrects. */
		originalReportId: uuid("original_report_id").notNull(),
		/** The approved report whose facts were copied, and its revision. */
		sourceReportId: uuid("source_report_id").notNull(),
		sourceRevisionId: uuid("source_revision_id").notNull(),
		reason: text("reason").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		createdByEmployeeId: uuid("created_by_employee_id").notNull(),
		createdByUserId: text("created_by_user_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_adjustment_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_report_adjustment_original_fk",
			columns: [table.originalReportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseReportAdjustment_org_report_idx").on(
			table.organizationId,
			table.reportId,
		),
		uniqueIndex("travelExpenseReportAdjustment_org_idempotency_idx").on(
			table.organizationId,
			table.idempotencyKey,
		),
		index("travelExpenseReportAdjustment_org_original_idx").on(
			table.organizationId,
			table.originalReportId,
		),
		check(
			"travel_expense_report_adjustment_link_check",
			sql`${table.reportId} <> ${table.originalReportId} AND ${table.sourceReportId} <> ${table.reportId}`,
		),
		check(
			"travel_expense_report_adjustment_reason_check",
			sql`length(btrim(${table.reason})) BETWEEN 1 AND 1000`,
		),
	],
);
