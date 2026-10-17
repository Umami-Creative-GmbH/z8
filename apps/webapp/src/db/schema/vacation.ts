import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	decimal,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee } from "./organization";
import { currentTimestamp } from "./timestamp";

// ============================================
// VACATION ALLOWANCE MANAGEMENT
// ============================================

/**
 * How a vacation policy grants its allowance: all at once for the year (`annual`), or month by
 * month through accrual adjustments (`monthly`, `biweekly`; #1106).
 */
export type VacationAccrualType = "annual" | "monthly" | "biweekly";

// Organization-wide vacation policies (date-based)
export const vacationAllowance = pgTable(
	"vacation_allowance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Policy name for identification (e.g., "5-day workers", "4-day workers", "Part-time")
		name: text("name").notNull(),

		// Date-based validity (replaces year)
		startDate: date("start_date").notNull(), // When policy becomes effective
		validUntil: date("valid_until"), // Nullable - auto-set when superseded, null = active

		// Company-wide default flag - only one active default per org
		isCompanyDefault: boolean("is_company_default").default(false).notNull(),

		// Soft delete flag
		isActive: boolean("is_active").default(true).notNull(),

		// Default days for the organization
		defaultAnnualDays: decimal("default_annual_days").notNull(),

		// Accrual settings
		accrualType: text("accrual_type").$type<VacationAccrualType>().notNull(),
		accrualStartMonth: integer("accrual_start_month").default(1), // 1-12, default Jan

		// Carryover rules
		allowCarryover: boolean("allow_carryover").default(false).notNull(),
		maxCarryoverDays: decimal("max_carryover_days"), // null = unlimited
		carryoverExpiryMonths: integer("carryover_expiry_months"), // e.g., 3 months

		// Proration (#1104): prorate the allowance in a year the employee joins or leaves.
		// Only annual policies are prorated; monthly and biweekly accrual already covers part years.
		prorateInStartAndExitYear: boolean("prorate_in_start_and_exit_year").default(true).notNull(),
		// Floor of the prorated allowance once the waiting period is complete. Between 0 and
		// defaultAnnualDays; new policies get min(20, defaultAnnualDays) (defaultStatutoryMinimumDays).
		statutoryMinimumDays: decimal("statutory_minimum_days").notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("vacationAllowance_organizationId_idx").on(table.organizationId),
		index("vacationAllowance_startDate_idx").on(table.startDate),
		// Unique policy name per org (active policies only)
		uniqueIndex("vacationAllowance_org_name_active_idx")
			.on(table.organizationId, table.name)
			.where(sql`is_active = true AND valid_until IS NULL`),
		// Only one company default per org at a time (active and not superseded)
		uniqueIndex("vacationAllowance_org_company_default_idx")
			.on(table.organizationId)
			.where(sql`is_company_default = true AND is_active = true AND valid_until IS NULL`),
	],
);

// Per-employee vacation allowance overrides
export const employeeVacationAllowance = pgTable(
	"employee_vacation_allowance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		year: integer("year").notNull(),

		// Override values (null = use organization default)
		customAnnualDays: decimal("custom_annual_days"), // Override for specific employee
		customCarryoverDays: decimal("custom_carryover_days"), // Carried from previous year

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employeeVacationAllowance_employeeId_idx").on(table.employeeId),
		index("employeeVacationAllowance_employeeId_year_idx").on(table.employeeId, table.year),
	],
);

/**
 * `manual`: an admin's or manager's adjustment. `accrual`: one period's share written by the
 * monthly/biweekly accrual job, the only source of an accrual policy's allowance (#1106).
 */
export type VacationAdjustmentKind = "manual" | "accrual" | "historical_usage";

// Individual vacation adjustment events (manual adjustments and accrual shares, with full history)
export const vacationAdjustment = pgTable(
	"vacation_adjustment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		year: integer("year").notNull(),
		days: decimal("days", { precision: 5, scale: 2 }).notNull(), // +/- days adjustment
		reason: text("reason").notNull(),
		kind: text("kind").$type<VacationAdjustmentKind>().default("manual").notNull(),
		// The calendar month (1-12) of `year` an accrual row covers; null on manual rows. Unique per
		// employee and year, so the accrual job can retry and catch up without duplicates. Null
		// only on a legacy duplicate accrual row the 0214 backfill could not give a month.
		accrualMonth: integer("accrual_month"),
		// Frozen reviewed coverage: tracking changes never reinterpret historical usage.
		historicalCoverageStart: date("historical_coverage_start"),
		historicalCoverageEnd: date("historical_coverage_end"),
		historicalTrackingStart: date("historical_tracking_start"),
		historicalTimezone: text("historical_timezone"),
		revision: integer("revision").default(0).notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
		// The adjusting employee; null only on accrual rows, which the system writes.
		adjustedBy: uuid("adjusted_by").references(() => employee.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("vacationAdjustment_historical_year_idx")
			.on(table.employeeId, table.year)
			.where(sql`${table.kind} = 'historical_usage'`),
		check(
			"vacation_adjustment_historical_check",
			sql`${table.kind} <> 'historical_usage' OR (${table.days} <= 0 AND mod(${table.days}, 0.5) = 0 AND ${table.historicalCoverageStart} IS NOT NULL AND ${table.historicalCoverageEnd} IS NOT NULL AND ${table.historicalTrackingStart} IS NOT NULL AND ${table.historicalTimezone} IS NOT NULL AND ${table.historicalCoverageStart} <= ${table.historicalCoverageEnd} AND ${table.historicalCoverageEnd} < ${table.historicalTrackingStart} AND extract(year from ${table.historicalCoverageStart}) = ${table.year} AND extract(year from ${table.historicalCoverageEnd}) = ${table.year})`,
		),
		index("vacationAdjustment_employee_year_idx").on(table.employeeId, table.year),
		uniqueIndex("vacationAdjustment_accrual_period_idx")
			.on(table.employeeId, table.year, table.accrualMonth)
			.where(sql`${table.kind} = 'accrual'`),
		check(
			"vacation_adjustment_kind_check",
			sql`${table.kind} IN ('manual', 'accrual', 'historical_usage')`,
		),
		check(
			"vacation_adjustment_manual_adjuster_check",
			sql`${table.kind} = 'accrual' OR ${table.adjustedBy} IS NOT NULL`,
		),
		check(
			"vacation_adjustment_accrual_month_check",
			sql`${table.accrualMonth} IS NULL OR (${table.kind} = 'accrual' AND ${table.accrualMonth} BETWEEN 1 AND 12)`,
		),
	],
);

// Assignment of vacation policies to organizations, teams, or employees
// This enables hierarchical vacation allowances (e.g., German team gets 30 days, Portuguese gets 22)
export const vacationPolicyAssignment = pgTable(
	"vacation_policy_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		policyId: uuid("policy_id")
			.notNull()
			.references(() => vacationAllowance.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id"),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),
		priority: integer("priority").default(0).notNull(), // 0=org, 1=team, 2=employee
		effectiveStartDate: date("effective_start_date").default(sql`NULL`).notNull(),
		effectiveEndDate: date("effective_end_date"),
		legacyBaseline: boolean("legacy_baseline").default(false).notNull(),
		reviewedBackdate: boolean("reviewed_backdate").default(false).notNull(),
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("vacationPolicyAssignment_policyId_idx").on(table.policyId),
		index("vacationPolicyAssignment_organizationId_idx").on(table.organizationId),
		index("vacationPolicyAssignment_teamId_idx").on(table.teamId),
		index("vacationPolicyAssignment_employeeId_idx").on(table.employeeId),
		// Overlaps are prevented by date-range exclusion constraints in migration 0261.
	],
);
