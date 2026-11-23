import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { CompensationBasis, DayUnitRuleKind } from "@/lib/contractor-compensation/kinds";
import { organization, user } from "../auth-schema";
import { employeeEmploymentPeriod } from "./employee-lifecycle";
import { currentTimestamp } from "./timestamp";

/*
 * Not re-exported from the schema barrel (`./index.ts`), like
 * `contractor-profile.ts`: one more table in the relational `db.query` type
 * passes TypeScript's instantiation depth (TS2589). Import it from this module;
 * drizzle.config.ts lists it for `db:push`.
 */

/**
 * Effective-dated compensation terms of an External Contractor (#1998, spec
 * #1935), per contractor employment period. Strictly apart from employee
 * employment terms (`contract_type` fixed | hourly), payroll and Billable Time
 * cost rates; org admins only.
 *
 * Periods are half-open date ranges `[effective_from, effective_to)` of the
 * contractor's local calendar days. Migration 0330 adds what Drizzle cannot
 * express: the non-overlap EXCLUDE constraint per employment period and the
 * trigger that admits contractor periods only.
 */
export const contractorCompensationTerms = pgTable(
	"contractor_compensation_terms",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").notNull(),
		employmentPeriodId: uuid("employment_period_id").notNull(),
		compensationBasis: text("compensation_basis").$type<CompensationBasis>().notNull(),
		/** In the currency's major unit, at most its minor-unit digits. */
		rateAmount: numeric("rate_amount", { precision: 12, scale: 3 }).notNull(),
		/** ISO 4217. */
		currency: text("currency").default("EUR").notNull(),
		/** Null for an hourly basis; required for a daily one. */
		dayUnitRule: text("day_unit_rule").$type<DayUnitRuleKind>(),
		/** `half_and_full_day` only: 1..1440. */
		halfDayThresholdMinutes: integer("half_day_threshold_minutes"),
		/** `prorated_by_standard_day` only: 1..1440. */
		standardDayMinutes: integer("standard_day_minutes"),
		/** `prorated_by_standard_day` only. */
		capAtOneDay: boolean("cap_at_one_day"),
		effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
		/** Exclusive; null while open. */
		effectiveTo: date("effective_to", { mode: "string" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
	},
	(table) => [
		foreignKey({
			name: "contractorCompensationTerms_period_fk",
			columns: [table.employmentPeriodId, table.organizationId, table.employeeId],
			foreignColumns: [
				employeeEmploymentPeriod.id,
				employeeEmploymentPeriod.organizationId,
				employeeEmploymentPeriod.employeeId,
			],
		}).onDelete("cascade"),
		index("contractorCompensationTerms_employee_idx").on(
			table.organizationId,
			table.employeeId,
			table.effectiveFrom,
		),
		check(
			"contractorCompensationTerms_basis_check",
			sql`${table.compensationBasis} IN ('hourly', 'daily')`,
		),
		check("contractorCompensationTerms_rate_positive_check", sql`${table.rateAmount} > 0`),
		check("contractorCompensationTerms_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
		check(
			"contractorCompensationTerms_period_check",
			sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
		),
		check(
			"contractorCompensationTerms_day_unit_rule_check",
			sql`((
				${table.compensationBasis} = 'hourly'
				AND ${table.dayUnitRule} IS NULL
				AND ${table.halfDayThresholdMinutes} IS NULL
				AND ${table.standardDayMinutes} IS NULL
				AND ${table.capAtOneDay} IS NULL
			) OR (
				${table.compensationBasis} = 'daily'
				AND ${table.dayUnitRule} = 'any_work_full_day'
				AND ${table.halfDayThresholdMinutes} IS NULL
				AND ${table.standardDayMinutes} IS NULL
				AND ${table.capAtOneDay} IS NULL
			) OR (
				${table.compensationBasis} = 'daily'
				AND ${table.dayUnitRule} = 'half_and_full_day'
				AND ${table.halfDayThresholdMinutes} BETWEEN 1 AND 1440
				AND ${table.standardDayMinutes} IS NULL
				AND ${table.capAtOneDay} IS NULL
			) OR (
				${table.compensationBasis} = 'daily'
				AND ${table.dayUnitRule} = 'prorated_by_standard_day'
				AND ${table.halfDayThresholdMinutes} IS NULL
				AND ${table.standardDayMinutes} BETWEEN 1 AND 1440
				AND ${table.capAtOneDay} IS NOT NULL
			)) IS TRUE`,
		),
	],
);

export type ContractorCompensationTermsRow = typeof contractorCompensationTerms.$inferSelect;
