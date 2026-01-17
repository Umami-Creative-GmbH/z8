import { sql } from "drizzle-orm";
import {
	boolean,
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
import { dayOfWeekEnum, holidayPresetAssignmentTypeEnum, surchargeRuleTypeEnum } from "./enums";
import { employee, team } from "./organization";
import { workPeriod } from "./time-tracking";
import type { SurchargeCalculationDetails } from "./types";

// ============================================
// SURCHARGES
// ============================================

// Surcharge model (template for surcharge rules)
export const surchargeModel = pgTable(
	"surcharge_model",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		name: text("name").notNull(),
		description: text("description"),

		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("surchargeModel_organizationId_idx").on(table.organizationId),
		index("surchargeModel_isActive_idx").on(table.isActive),
		uniqueIndex("surchargeModel_org_name_idx").on(table.organizationId, table.name),
	],
);

// Surcharge rules (child of model)
export const surchargeRule = pgTable(
	"surcharge_rule",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		modelId: uuid("model_id")
			.notNull()
			.references(() => surchargeModel.id, { onDelete: "cascade" }),

		name: text("name").notNull(),
		description: text("description"),

		ruleType: surchargeRuleTypeEnum("rule_type").notNull(),

		// Percentage as decimal (e.g., 0.50 = 50%, 1.00 = 100%)
		percentage: decimal("percentage", { precision: 5, scale: 4 }).notNull(),

		// For day_of_week type
		dayOfWeek: dayOfWeekEnum("day_of_week"),

		// For time_window type (time only, no date) - HH:mm format
		windowStartTime: text("window_start_time"),
		windowEndTime: text("window_end_time"),

		// For date_based type
		specificDate: timestamp("specific_date", { mode: "date" }),
		dateRangeStart: timestamp("date_range_start", { mode: "date" }),
		dateRangeEnd: timestamp("date_range_end", { mode: "date" }),

		// Priority for overlap resolution (higher = applied first for "max wins")
		priority: integer("priority").default(0).notNull(),

		// Rule validity period
		validFrom: timestamp("valid_from"),
		validUntil: timestamp("valid_until"),

		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("surchargeRule_modelId_idx").on(table.modelId),
		index("surchargeRule_ruleType_idx").on(table.ruleType),
		index("surchargeRule_priority_idx").on(table.modelId, table.priority),
		index("surchargeRule_isActive_idx").on(table.isActive),
	],
);

// Hierarchical assignment of surcharge models (reuses pattern from time regulations)
export const surchargeModelAssignment = pgTable(
	"surcharge_model_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		modelId: uuid("model_id")
			.notNull()
			.references(() => surchargeModel.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Assignment target (reuses existing enum)
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "cascade",
		}),

		// Priority: 0=org, 1=team, 2=employee (higher wins)
		priority: integer("priority").default(0).notNull(),

		// Effective dates
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),

		isActive: boolean("is_active").default(true).notNull(),

		// Audit fields
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("surchargeModelAssignment_modelId_idx").on(table.modelId),
		index("surchargeModelAssignment_organizationId_idx").on(table.organizationId),
		index("surchargeModelAssignment_teamId_idx").on(table.teamId),
		index("surchargeModelAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("surchargeModelAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("surchargeModelAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("surchargeModelAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);

// Immutable surcharge calculation log (GoBD compliance)
export const surchargeCalculation = pgTable(
	"surcharge_calculation",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Links to source data
		workPeriodId: uuid("work_period_id")
			.notNull()
			.references(() => workPeriod.id, { onDelete: "cascade" }),
		surchargeRuleId: uuid("surcharge_rule_id").references(() => surchargeRule.id, {
			onDelete: "set null",
		}),
		surchargeModelId: uuid("surcharge_model_id").references(() => surchargeModel.id, {
			onDelete: "set null",
		}),

		// Calculation results
		calculationDate: timestamp("calculation_date").notNull(),
		baseMinutes: integer("base_minutes").notNull(), // Original work period duration
		qualifyingMinutes: integer("qualifying_minutes").notNull(), // Minutes that qualified for surcharge
		surchargeMinutes: integer("surcharge_minutes").notNull(), // Extra minutes credited
		appliedPercentage: decimal("applied_percentage", {
			precision: 5,
			scale: 4,
		}).notNull(),

		// Full breakdown for audit (JSON)
		calculationDetails: text("calculation_details").$type<SurchargeCalculationDetails>(),

		// Immutable - createdAt only, no updatedAt
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("surchargeCalculation_employeeId_idx").on(table.employeeId),
		index("surchargeCalculation_organizationId_idx").on(table.organizationId),
		index("surchargeCalculation_workPeriodId_idx").on(table.workPeriodId),
		index("surchargeCalculation_calculationDate_idx").on(table.calculationDate),
		index("surchargeCalculation_emp_date_idx").on(table.employeeId, table.calculationDate),
		// Prevent duplicate calculations for same work period
		uniqueIndex("surchargeCalculation_workPeriod_idx").on(table.workPeriodId),
	],
);
