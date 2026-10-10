import { sql } from "drizzle-orm";
import {
	check,
	decimal,
	foreignKey,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";
import { organization } from "../auth-schema";
import { employee } from "./organization";
import { payrollExportJob } from "./payroll-export";
import { travelExpenseReport } from "./travel-expense";

/**
 * What became of a report a payroll run included (#852):
 * - `included`: an unconfirmed run carries it; nothing else may reimburse it.
 * - `superseded`: a later export of the same period took it into its own run.
 * - `removed`: an officer took it out of the run (audited).
 * - `discarded`: the run was discarded, or its export never produced a file.
 * - `confirmed`: an officer confirmed the run paid it (#853); final. Its lines
 *   are what earlier payroll runs carried for the report.
 */
export const TRAVEL_EXPENSE_PAYROLL_RUN_INCLUSION_STATES = [
	"included",
	"superseded",
	"removed",
	"discarded",
	"confirmed",
] as const;
export type TravelExpensePayrollRunInclusionState =
	(typeof TRAVEL_EXPENSE_PAYROLL_RUN_INCLUSION_STATES)[number];

/** One frozen money line of an inclusion: a payroll line with the wage type it was exported under. */
export interface TravelExpensePayrollRunInclusionLine {
	kind: PayrollLineKind;
	/** Euros at two decimals. */
	amount: string;
	currency: "EUR";
	wageTypeCode: string;
}

/**
 * A report a payroll run carries (#852, ADR 0003). The payroll run is the
 * payroll export job of a file format; its inclusions freeze the lines and
 * wage-type codes it exported, which make up its per-report amounts. A report
 * is included in at most one unconfirmed run: the partial unique index answers
 * "is this report included?" for every reimbursement path. Only `state` and
 * the ending columns ever change.
 */
export const travelExpensePayrollRunInclusion = pgTable(
	"travel_expense_payroll_run_inclusion",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		payrollExportJobId: uuid("payroll_export_job_id")
			.notNull()
			.references(() => payrollExportJob.id, { onDelete: "cascade" }),
		reportId: uuid("report_id").notNull(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		// The approved frozen revision the lines were computed from.
		basisRevisionId: uuid("basis_revision_id").notNull(),
		lines: jsonb("lines").$type<TravelExpensePayrollRunInclusionLine[]>().notNull(),
		state: text("state")
			.$type<TravelExpensePayrollRunInclusionState>()
			.default("included")
			.notNull(),
		includedAt: timestamp("included_at", { withTimezone: true }).defaultNow().notNull(),
		// When it stopped being included; for `confirmed`, when the run was confirmed.
		endedAt: timestamp("ended_at", { withTimezone: true }),
		// Who removed, discarded or confirmed it; null for a superseded or failed export.
		endedByUserId: text("ended_by_user_id"),
		/**
		 * Overpaid by payroll (#853): how much more the run paid than the account
		 * still owed when it was confirmed. Only the owed part is recorded as a
		 * reimbursement; an officer settles the rest by hand. Confirmed only.
		 */
		overpaidAmount: decimal("overpaid_amount", { precision: 12, scale: 2 }),
		// The run that took the report over; set only when superseded.
		supersededByJobId: uuid("superseded_by_job_id").references(() => payrollExportJob.id, {
			onDelete: "set null",
		}),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_payroll_run_inclusion_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpensePayrollRunInclusion_org_report_included_idx")
			.on(table.organizationId, table.reportId)
			.where(sql`${table.state} = 'included'`),
		index("travelExpensePayrollRunInclusion_org_job_idx").on(
			table.organizationId,
			table.payrollExportJobId,
		),
		check(
			"travel_expense_payroll_run_inclusion_state_check",
			sql`${table.state} IN ('included', 'superseded', 'removed', 'discarded', 'confirmed')`,
		),
		check(
			"travel_expense_payroll_run_inclusion_ended_check",
			sql`(${table.state} = 'included') = (${table.endedAt} IS NULL)
			AND (${table.supersededByJobId} IS NULL OR ${table.state} = 'superseded')`,
		),
		check(
			"travel_expense_payroll_run_inclusion_overpaid_check",
			sql`${table.overpaidAmount} IS NULL OR (${table.state} = 'confirmed' AND ${table.overpaidAmount} > 0)`,
		),
		index("travelExpensePayrollRunInclusion_org_report_confirmed_idx")
			.on(table.organizationId, table.reportId)
			.where(sql`${table.state} = 'confirmed'`),
	],
);
