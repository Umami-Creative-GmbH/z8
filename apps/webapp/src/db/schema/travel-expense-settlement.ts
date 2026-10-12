import { sql } from "drizzle-orm";
import {
	check,
	date,
	decimal,
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { SettlementEntryKind } from "@/lib/travel-expenses/settlement.types";
import { organization } from "../auth-schema";
import { employee } from "./organization";
import { payrollExportJob } from "./payroll-export";
import { travelExpenseClaim, travelExpenseReport } from "./travel-expense";
import { travelExpenseExportBatch } from "./travel-expense-export";

export const TRAVEL_EXPENSE_SETTLEMENT_SOURCE_TYPES = ["report", "legacy_claim"] as const;
export type TravelExpenseSettlementSourceType =
	(typeof TRAVEL_EXPENSE_SETTLEMENT_SOURCE_TYPES)[number];

// Money that moved outside Z8 for one approved expense source (#612): a
// reimbursement paid to the employee or (#615) a recovery of an overpayment.
// The settlement account of a report or legacy claim is the set of its rows;
// balances are derived, never stored. Rows are immutable (an UPDATE trigger
// refuses changes) and every row carries the idempotency key of the command
// that recorded it, so a retried command can never record money twice.
// `balance_before` is the account balance the row was recorded against.
export const travelExpenseSettlementEntry = pgTable(
	"travel_expense_settlement_entry",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		sourceType: text("source_type").$type<TravelExpenseSettlementSourceType>().notNull(),
		reportId: uuid("report_id"),
		legacyClaimId: uuid("legacy_claim_id"),
		kind: text("kind").$type<SettlementEntryKind>().notNull(),
		amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
		currency: text("currency").notNull(),
		occurredOn: date("occurred_on").notNull(),
		reference: text("reference").notNull(),
		note: text("note"),
		// The approved frozen revision the entitlement came from (reports only).
		basisRevisionId: uuid("basis_revision_id"),
		basisSubmissionCycle: integer("basis_submission_cycle"),
		balanceBefore: decimal("balance_before", { precision: 12, scale: 2 }).notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		commandFingerprint: text("command_fingerprint").notNull(),
		recordedByEmployeeId: uuid("recorded_by_employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),
		recordedByUserId: text("recorded_by_user_id").notNull(),
		recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
		// The completed export batch this reimbursement was recorded for (#755); null otherwise.
		exportBatchId: uuid("export_batch_id"),
		// The payroll run whose confirmation recorded this reimbursement (#853); null otherwise.
		payrollRunId: uuid("payroll_run_id"),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_settlement_entry_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_settlement_entry_claim_fk",
			columns: [table.legacyClaimId, table.organizationId],
			foreignColumns: [travelExpenseClaim.id, travelExpenseClaim.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_settlement_entry_export_batch_fk",
			columns: [table.exportBatchId, table.organizationId],
			foreignColumns: [travelExpenseExportBatch.id, travelExpenseExportBatch.organizationId],
		}),
		index("travelExpenseSettlementEntry_org_export_batch_idx")
			.on(table.organizationId, table.exportBatchId)
			.where(sql`${table.exportBatchId} IS NOT NULL`),
		foreignKey({
			name: "travel_expense_settlement_entry_payroll_run_fk",
			columns: [table.payrollRunId, table.organizationId],
			foreignColumns: [payrollExportJob.id, payrollExportJob.organizationId],
		}),
		index("travelExpenseSettlementEntry_org_payroll_run_idx")
			.on(table.organizationId, table.payrollRunId)
			.where(sql`${table.payrollRunId} IS NOT NULL`),
		check(
			"travel_expense_settlement_entry_payroll_run_check",
			sql`${table.payrollRunId} IS NULL OR (${table.kind} = 'reimbursement' AND ${table.sourceType} = 'report' AND ${table.exportBatchId} IS NULL)`,
		),
		uniqueIndex("travelExpenseSettlementEntry_org_idempotency_idx").on(
			table.organizationId,
			table.idempotencyKey,
		),
		index("travelExpenseSettlementEntry_org_report_idx").on(table.organizationId, table.reportId),
		index("travelExpenseSettlementEntry_org_claim_idx").on(
			table.organizationId,
			table.legacyClaimId,
		),
		check(
			"travel_expense_settlement_entry_source_check",
			sql`(${table.sourceType} = 'report' AND ${table.reportId} IS NOT NULL AND ${table.legacyClaimId} IS NULL)
			OR (${table.sourceType} = 'legacy_claim' AND ${table.legacyClaimId} IS NOT NULL AND ${table.reportId} IS NULL
				AND ${table.basisRevisionId} IS NULL AND ${table.basisSubmissionCycle} IS NULL)`,
		),
		check(
			"travel_expense_settlement_entry_kind_check",
			sql`${table.kind} IN ('reimbursement', 'recovery')`,
		),
		check("travel_expense_settlement_entry_amount_check", sql`${table.amount} > 0`),
		check("travel_expense_settlement_entry_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
		check(
			"travel_expense_settlement_entry_reference_check",
			sql`length(btrim(${table.reference})) BETWEEN 1 AND 200
			AND (${table.note} IS NULL OR length(${table.note}) <= 1000)`,
		),
	],
);
