import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { payrollExportJob } from "./payroll-export";

// ============================================
// SETTLED DAYS (#1891, payroll-export ADR 0004)
// ============================================

/** How a day was settled: by confirming a payroll export as paid, or by hand. */
export const PAYROLL_SETTLEMENT_METHODS = ["manual", "export"] as const;
export type PayrollSettlementMethod = (typeof PAYROLL_SETTLEMENT_METHODS)[number];

/** One approved absence of a day as it was paid. */
export interface PayrollSettledDayAbsence {
	categoryId: string;
	/** The category's name when settled, for history after a rename or deletion. */
	categoryName: string;
	categoryType: string | null;
	period: "full_day" | "am" | "pm" | "partial_day";
}

/**
 * A settled day (#1896): one employee and one calendar date in that employee's
 * timezone whose worked hours and absences have been paid. It keeps the copy of
 * the day's values at settling, so later changes show as changed since settled
 * (#1897). Settling never freezes data and is separate from closed months.
 *
 * At most one active settlement per employee-day: the partial unique index. An
 * unsettled row stays as history of what was paid; only the unsettle columns ever
 * change. Every settle and unsettle is also an append-only
 * `payroll_settled_day_event`.
 */
export const payrollSettledDay = pgTable(
	"payroll_settled_day",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		/** The employee-local calendar date. */
		date: date("date").notNull(),
		/** The zone `date` was read in when settled. */
		timezone: text("timezone").notNull(),
		/** Copy at settling: the day's credited minutes by the payroll credit rule. */
		creditedMinutes: integer("credited_minutes").notNull(),
		/** Copy at settling: the day's approved absences, sorted by category and period. */
		absences: jsonb("absences").$type<PayrollSettledDayAbsence[]>().default([]).notNull(),
		method: text("method").$type<PayrollSettlementMethod>().notNull(),
		/** The export confirmed as paid (#1899); null for a manual settlement. */
		payrollExportJobId: uuid("payroll_export_job_id").references(() => payrollExportJob.id, {
			onDelete: "set null",
		}),
		settledBy: text("settled_by").references(() => user.id, { onDelete: "set null" }),
		settledAt: timestamp("settled_at", { withTimezone: true }).defaultNow().notNull(),
		unsettledBy: text("unsettled_by").references(() => user.id, { onDelete: "set null" }),
		unsettledAt: timestamp("unsettled_at", { withTimezone: true }),
		unsettleReason: text("unsettle_reason"),
	},
	(table) => [
		uniqueIndex("payrollSettledDay_org_employee_date_active_idx")
			.on(table.organizationId, table.employeeId, table.date)
			.where(sql`${table.unsettledAt} IS NULL`),
		index("payrollSettledDay_org_employee_date_idx").on(
			table.organizationId,
			table.employeeId,
			table.date,
		),
		index("payrollSettledDay_payrollExportJobId_idx").on(table.payrollExportJobId),
		check("payroll_settled_day_method_check", sql`${table.method} IN ('manual', 'export')`),
		check("payroll_settled_day_minutes_check", sql`${table.creditedMinutes} >= 0`),
		check(
			"payroll_settled_day_unsettle_check",
			sql`(${table.unsettledAt} IS NULL) = (${table.unsettleReason} IS NULL)
			AND (${table.unsettleReason} IS NULL OR length(btrim(${table.unsettleReason})) > 0)`,
		),
	],
);

export const PAYROLL_SETTLED_DAY_EVENT_KINDS = ["settled", "unsettled"] as const;
export type PayrollSettledDayEventKind = (typeof PAYROLL_SETTLED_DAY_EVENT_KINDS)[number];

/**
 * The append-only settlement history of employee-days (#1896): who settled or
 * unsettled a day, when, how (manual or export, with the export) and why. The
 * paid values are the referenced settled day's copy. A trigger rejects updates.
 */
export const payrollSettledDayEvent = pgTable(
	"payroll_settled_day_event",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		settledDayId: uuid("settled_day_id")
			.notNull()
			.references(() => payrollSettledDay.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		kind: text("kind").$type<PayrollSettledDayEventKind>().notNull(),
		/** The settled day's method, also on its unsettle event. */
		method: text("method").$type<PayrollSettlementMethod>().notNull(),
		payrollExportJobId: uuid("payroll_export_job_id").references(() => payrollExportJob.id, {
			onDelete: "set null",
		}),
		actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
		/** Required to unsettle; never set on a settle event. */
		reason: text("reason"),
	},
	(table) => [
		index("payrollSettledDayEvent_org_employee_date_idx").on(
			table.organizationId,
			table.employeeId,
			table.date,
		),
		index("payrollSettledDayEvent_settledDayId_idx").on(table.settledDayId),
		check("payroll_settled_day_event_kind_check", sql`${table.kind} IN ('settled', 'unsettled')`),
		check("payroll_settled_day_event_method_check", sql`${table.method} IN ('manual', 'export')`),
		check(
			"payroll_settled_day_event_reason_check",
			sql`(${table.kind} = 'unsettled') = (${table.reason} IS NOT NULL)
			AND (${table.reason} IS NULL OR length(btrim(${table.reason})) > 0)`,
		),
	],
);

/**
 * One employee-day a completed payroll file carried, with the values it carried
 * (#1898/#1899). Written when the workspace prepares a file; confirming the export
 * as paid settles exactly these days with these values. Immutable.
 */
export const payrollExportCarriedDay = pgTable(
	"payroll_export_carried_day",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		jobId: uuid("job_id")
			.notNull()
			.references(() => payrollExportJob.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		timezone: text("timezone").notNull(),
		creditedMinutes: integer("credited_minutes").notNull(),
		absences: jsonb("absences").$type<PayrollSettledDayAbsence[]>().default([]).notNull(),
	},
	(table) => [
		uniqueIndex("payrollExportCarriedDay_job_employee_date_idx").on(
			table.jobId,
			table.employeeId,
			table.date,
		),
		index("payrollExportCarriedDay_organizationId_idx").on(table.organizationId),
		check("payroll_export_carried_day_minutes_check", sql`${table.creditedMinutes} >= 0`),
	],
);
