import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	foreignKey,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	PerDiemArea,
	PerDiemMealDay,
	PerDiemOvernight,
	StampedPerDiemPolicy,
} from "@/lib/travel-expenses/per-diem";
import { travelExpenseReport, travelExpenseReportItem } from "./travel-expense";
import { travelExpenseAllowancePolicyVersion } from "./travel-expense-allowance-policy";

/**
 * Per diem amounts of one area in a per diem policy version (#609). The
 * version identity, dating, source and activation are the shared allowance
 * policy (`travel_expense_allowance_policy*`, kind `per_diem`); domestic rates
 * use area `DE`. An adopted verified foreign table (#611) adds one row per
 * listed country ("FR") and place ("FR:paris").
 */
export const travelExpensePerDiemRate = pgTable(
	"travel_expense_per_diem_rate",
	{
		versionId: uuid("version_id").notNull(),
		organizationId: text("organization_id").notNull(),
		area: text("area").$type<PerDiemArea>().notNull(),
		fullDayAmount: decimal("full_day_amount", { precision: 10, scale: 2 }).notNull(),
		partialDayAmount: decimal("partial_day_amount", { precision: 10, scale: 2 }).notNull(),
		breakfastDeduction: decimal("breakfast_deduction", { precision: 10, scale: 2 }).notNull(),
		lunchDeduction: decimal("lunch_deduction", { precision: 10, scale: 2 }).notNull(),
		dinnerDeduction: decimal("dinner_deduction", { precision: 10, scale: 2 }).notNull(),
	},
	(table) => [
		primaryKey({ name: "travel_expense_per_diem_rate_pk", columns: [table.versionId, table.area] }),
		foreignKey({
			name: "travel_expense_per_diem_rate_version_fk",
			columns: [table.versionId, table.organizationId],
			foreignColumns: [
				travelExpenseAllowancePolicyVersion.id,
				travelExpenseAllowancePolicyVersion.organizationId,
			],
		}).onDelete("cascade"),
		// "DE", or a country / listed place of a verified foreign table (#611, `PER_DIEM_AREA_PATTERN`).
		check(
			"travel_expense_per_diem_rate_area_check",
			sql`${table.area} ~ '^[A-Z]{2}(:[a-z0-9-]{1,40})?$'`,
		),
		check(
			"travel_expense_per_diem_rate_amount_check",
			sql`${table.fullDayAmount} > 0 AND ${table.fullDayAmount} <= 1000
				AND ${table.partialDayAmount} >= 0 AND ${table.partialDayAmount} <= ${table.fullDayAmount}
				AND ${table.breakfastDeduction} >= 0 AND ${table.breakfastDeduction} <= ${table.fullDayAmount}
				AND ${table.lunchDeduction} >= 0 AND ${table.lunchDeduction} <= ${table.fullDayAmount}
				AND ${table.dinnerDeduction} >= 0 AND ${table.dinnerDeduction} <= ${table.fullDayAmount}`,
		),
	],
);

/**
 * The entered itinerary of a per diem item (#609), one per item and at most
 * one per trip report. Travel times are local date + "HH:mm" + IANA zone as
 * entered; `start_date`/`end_date` are those local calendar days, which the
 * overlap check across the employee's reports compares. The applied rule
 * edition and policy versions are stamped in `policy` at submission
 * (`per-diem-store.ts`); an edit clears the stamp.
 */
export const travelExpenseReportPerDiem = pgTable(
	"travel_expense_report_per_diem",
	{
		itemId: uuid("item_id").primaryKey(),
		organizationId: text("organization_id").notNull(),
		reportId: uuid("report_id").notNull(),
		startDate: date("start_date"),
		startTime: text("start_time"),
		startTimeZone: text("start_time_zone"),
		endDate: date("end_date"),
		endTime: text("end_time"),
		endTimeZone: text("end_time_zone"),
		overnight: text("overnight").$type<PerDiemOvernight>(),
		prolongedWorkplace: boolean("prolonged_workplace").default(false).notNull(),
		meals: jsonb("meals").$type<PerDiemMealDay[]>().default([]).notNull(),
		policy: jsonb("policy").$type<StampedPerDiemPolicy>(),
	},
	(table) => [
		foreignKey({
			name: "travel_expense_report_per_diem_item_fk",
			columns: [table.itemId, table.organizationId],
			foreignColumns: [travelExpenseReportItem.id, travelExpenseReportItem.organizationId],
		}).onDelete("cascade"),
		foreignKey({
			name: "travel_expense_report_per_diem_report_fk",
			columns: [table.reportId, table.organizationId],
			foreignColumns: [travelExpenseReport.id, travelExpenseReport.organizationId],
		}).onDelete("cascade"),
		uniqueIndex("travelExpenseReportPerDiem_report_idx").on(table.reportId),
		index("travelExpenseReportPerDiem_org_days_idx").on(
			table.organizationId,
			table.startDate,
			table.endDate,
		),
		check(
			"travel_expense_report_per_diem_time_check",
			sql`(${table.startTime} IS NULL OR ${table.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
				AND (${table.endTime} IS NULL OR ${table.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
				AND (${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate})`,
		),
		check(
			"travel_expense_report_per_diem_overnight_check",
			sql`${table.overnight} IS NULL OR ${table.overnight} IN ('away', 'none', 'mixed')`,
		),
		check(
			"travel_expense_report_per_diem_meals_check",
			sql`jsonb_typeof(${table.meals}) = 'array' AND jsonb_array_length(${table.meals}) <= 101`,
		),
	],
);
