import { sql } from "drizzle-orm";
import {
	boolean,
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
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { holidayPresetAssignmentTypeEnum } from "./enums";
import { employee, team } from "./organization";

// ============================================
// VACATION ALLOWANCE MANAGEMENT
// ============================================

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
		accrualType: text("accrual_type").notNull(), // "annual" | "monthly" | "biweekly"
		accrualStartMonth: integer("accrual_start_month").default(1), // 1-12, default Jan

		// Carryover rules
		allowCarryover: boolean("allow_carryover").default(false).notNull(),
		maxCarryoverDays: decimal("max_carryover_days"), // null = unlimited
		carryoverExpiryMonths: integer("carryover_expiry_months"), // e.g., 3 months

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

// Individual vacation adjustment events (tracks all manual adjustments with full history)
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
		adjustedBy: uuid("adjusted_by")
			.notNull()
			.references(() => employee.id),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("vacationAdjustment_employee_year_idx").on(table.employeeId, table.year)],
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
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),
		priority: integer("priority").default(0).notNull(), // 0=org, 1=team, 2=employee
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
		// One org default per organization per policy
		uniqueIndex("vacationPolicyAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One policy assignment per team
		uniqueIndex("vacationPolicyAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One policy assignment per employee
		uniqueIndex("vacationPolicyAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);
