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
import type {
	AllowanceOverrideKind,
	AllowanceOverrideScope,
	AllowanceSituation,
} from "@/lib/travel-expenses/allowance-override.types";
import { travelExpenseReport, travelExpenseReportItem } from "./travel-expense";

/**
 * Audited manual allowance amounts (#610). An expense administrator records
 * one for a mileage or per diem item of an editable report whose allowance the
 * server cannot calculate (missing organization coverage or an unsupported
 * itinerary), with reason, evidence and calculation basis. `scope` is the
 * exact facts it was authorized for: it applies only while the item still has
 * them. `situation` is the ordinary result it resolved. Rows are immutable
 * (trigger `travel_expense_allowance_override_immutable`): the one permitted
 * change is revoking an active row once; a replacement is a new row. At most
 * one active override per item. The authorizer and revoker are kept by value.
 */
export const travelExpenseAllowanceOverride = pgTable(
	"travel_expense_allowance_override",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull(),
		reportId: uuid("report_id").notNull(),
		itemId: uuid("item_id").notNull(),
		kind: text("kind").$type<AllowanceOverrideKind>().notNull(),
		amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
		currency: text("currency").notNull(),
		reason: text("reason").notNull(),
		evidence: text("evidence").notNull(),
		calculationBasis: text("calculation_basis").notNull(),
		scope: jsonb("scope").$type<AllowanceOverrideScope>().notNull(),
		situation: jsonb("situation").$type<AllowanceSituation>().notNull(),
		authorizedByEmployeeId: uuid("authorized_by_employee_id").notNull(),
		authorizedByUserId: text("authorized_by_user_id").notNull(),
		authorizedByName: text("authorized_by_name").notNull(),
		authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokedByEmployeeId: uuid("revoked_by_employee_id"),
		revokedByUserId: text("revoked_by_user_id"),
		revokedByName: text("revoked_by_name"),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_allowance_override_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_allowance_override_item_fk",
			columns: [table.itemId, table.organizationId],
			foreignColumns: [travelExpenseReportItem.id, travelExpenseReportItem.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseAllowanceOverride_active_item_idx")
			.on(table.itemId)
			.where(sql`${table.revokedAt} IS NULL`),
		index("travelExpenseAllowanceOverride_org_report_idx").on(table.organizationId, table.reportId),
		check(
			"travel_expense_allowance_override_kind_check",
			sql`${table.kind} IN ('mileage', 'per_diem')`,
		),
		check(
			"travel_expense_allowance_override_amount_check",
			sql`${table.amount} >= 0 AND ${table.amount} <= 1000000 AND (${table.kind} <> 'mileage' OR ${table.amount} > 0)`,
		),
		check(
			"travel_expense_allowance_override_currency_check",
			sql`${table.currency} ~ '^[A-Z]{3}$'`,
		),
		check(
			"travel_expense_allowance_override_text_check",
			sql`char_length(btrim(${table.reason})) BETWEEN 1 AND 1000
				AND char_length(btrim(${table.evidence})) BETWEEN 1 AND 2000
				AND char_length(btrim(${table.calculationBasis})) BETWEEN 1 AND 2000`,
		),
		check(
			"travel_expense_allowance_override_revoked_check",
			sql`(${table.revokedAt} IS NULL) = (${table.revokedByUserId} IS NULL)
				AND (${table.revokedAt} IS NULL) = (${table.revokedByName} IS NULL)`,
		),
	],
);
