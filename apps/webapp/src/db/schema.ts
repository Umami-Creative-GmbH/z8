import { relations } from "drizzle-orm";
import {
	boolean,
	decimal,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

// ============================================
// ENUMS
// ============================================

export const roleEnum = pgEnum("role", ["admin", "manager", "employee"]);
export const absenceTypeEnum = pgEnum("absence_type", [
	"home_office",
	"sick",
	"vacation",
	"personal",
	"unpaid",
	"parental",
	"bereavement",
	"custom",
]);
export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const timeEntryTypeEnum = pgEnum("time_entry_type", ["clock_in", "clock_out", "correction"]);
export const holidayCategoryEnum = pgEnum("holiday_category", [
	"public_holiday",
	"company_holiday",
	"training_day",
	"custom",
]);
export const recurrenceTypeEnum = pgEnum("recurrence_type", ["none", "yearly", "custom"]);

// ============================================
// ORGANIZATION STRUCTURE
// ============================================

// Import auth tables from auth-schema for references
import { organization, user } from "./auth-schema";

// Teams/departments within organizations
export const team = pgTable(
	"team",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("team_organizationId_idx").on(table.organizationId)],
);

// Employee profile - extends Better Auth user with business-specific fields
// Better Auth member table handles organization membership and roles
export const employee = pgTable(
	"employee",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "set null" }),
		managerId: uuid("manager_id"), // Self-reference to another employee
		role: roleEnum("role").default("employee").notNull(),
		employeeNumber: text("employee_number"),
		position: text("position"),
		startDate: timestamp("start_date"),
		endDate: timestamp("end_date"),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("employee_userId_idx").on(table.userId),
		index("employee_organizationId_idx").on(table.organizationId),
		index("employee_teamId_idx").on(table.teamId),
		index("employee_managerId_idx").on(table.managerId),
	],
);

// ============================================
// HOLIDAY MANAGEMENT
// ============================================

// Holiday categories with organization-specific settings
export const holidayCategory = pgTable(
	"holiday_category",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: holidayCategoryEnum("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		color: text("color"), // Hex color for calendar display
		blocksTimeEntry: boolean("blocks_time_entry").default(true).notNull(),
		excludeFromCalculations: boolean("exclude_from_calculations").default(true).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("holidayCategory_organizationId_idx").on(table.organizationId)],
);

// Holidays and closing days with recurrence support
export const holiday = pgTable(
	"holiday",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => holidayCategory.id),
		name: text("name").notNull(),
		description: text("description"),
		startDate: timestamp("start_date").notNull(),
		endDate: timestamp("end_date").notNull(),
		recurrenceType: recurrenceTypeEnum("recurrence_type").default("none").notNull(),
		recurrenceRule: text("recurrence_rule"), // JSON: { month: 12, day: 25 }
		recurrenceEndDate: timestamp("recurrence_end_date"),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("holiday_organizationId_idx").on(table.organizationId),
		index("holiday_startDate_idx").on(table.startDate),
		index("holiday_categoryId_idx").on(table.categoryId),
	],
);

// ============================================
// TIME TRACKING
// ============================================

// Blockchain-style time entries - immutable and linked
export const timeEntry = pgTable(
	"time_entry",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		type: timeEntryTypeEnum("type").notNull(),
		timestamp: timestamp("timestamp").notNull(),

		// Blockchain linking
		previousEntryId: uuid("previous_entry_id"), // Links to previous entry
		hash: text("hash").notNull(), // Hash of this entry for integrity
		previousHash: text("previous_hash"), // Hash of previous entry

		// Correction tracking
		replacesEntryId: uuid("replaces_entry_id"), // If this is a correction
		isSuperseded: boolean("is_superseded").default(false).notNull(), // True if replaced by correction
		supersededById: uuid("superseded_by_id"), // Points to the correction entry

		// Metadata
		notes: text("notes"),
		location: text("location"), // GPS coordinates or location name
		ipAddress: text("ip_address"),
		deviceInfo: text("device_info"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id), // Who created this entry
	},
	(table) => [
		index("timeEntry_employeeId_idx").on(table.employeeId),
		index("timeEntry_timestamp_idx").on(table.timestamp),
		index("timeEntry_previousEntryId_idx").on(table.previousEntryId),
		index("timeEntry_replacesEntryId_idx").on(table.replacesEntryId),
	],
);

// Calculate total hours from time entries
export const workPeriod = pgTable(
	"work_period",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		clockInId: uuid("clock_in_id")
			.notNull()
			.references(() => timeEntry.id),
		clockOutId: uuid("clock_out_id").references(() => timeEntry.id),

		startTime: timestamp("start_time").notNull(),
		endTime: timestamp("end_time"),
		durationMinutes: integer("duration_minutes"), // Calculated when clocked out

		isActive: boolean("is_active").default(true).notNull(), // False when clocked out

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("workPeriod_employeeId_idx").on(table.employeeId),
		index("workPeriod_startTime_idx").on(table.startTime),
	],
);

// ============================================
// ABSENCE MANAGEMENT
// ============================================

// Configurable absence categories
export const absenceCategory = pgTable(
	"absence_category",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: absenceTypeEnum("type").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		requiresWorkTime: boolean("requires_work_time").default(false).notNull(), // Does work need to be logged on this day?
		requiresApproval: boolean("requires_approval").default(true).notNull(),
		countsAgainstVacation: boolean("counts_against_vacation").default(true).notNull(), // Determines if absence deducts from vacation balance
		color: text("color"), // For UI display
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("absenceCategory_organizationId_idx").on(table.organizationId)],
);

// Absence entries (sick days, vacation, etc.)
export const absenceEntry = pgTable(
	"absence_entry",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		categoryId: uuid("category_id")
			.notNull()
			.references(() => absenceCategory.id),

		startDate: timestamp("start_date").notNull(),
		endDate: timestamp("end_date").notNull(),

		status: approvalStatusEnum("status").default("pending").notNull(),
		notes: text("notes"),

		// Approval tracking
		approvedBy: uuid("approved_by").references(() => employee.id),
		approvedAt: timestamp("approved_at"),
		rejectionReason: text("rejection_reason"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("absenceEntry_employeeId_idx").on(table.employeeId),
		index("absenceEntry_startDate_idx").on(table.startDate),
		index("absenceEntry_status_idx").on(table.status),
	],
);

// ============================================
// VACATION ALLOWANCE MANAGEMENT
// ============================================

// Organization-wide vacation policies per year
export const vacationAllowance = pgTable(
	"vacation_allowance",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Calendar year this allowance applies to
		year: integer("year").notNull(),

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
			.$onUpdate(() => new Date())
			.notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("vacationAllowance_organizationId_year_idx").on(table.organizationId, table.year),
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

		// Adjustment tracking
		adjustmentDays: decimal("adjustment_days").default("0"), // Manual +/- adjustments
		adjustmentReason: text("adjustment_reason"),
		adjustedAt: timestamp("adjusted_at"),
		adjustedBy: uuid("adjusted_by").references(() => employee.id),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("employeeVacationAllowance_employeeId_idx").on(table.employeeId)],
);

// ============================================
// APPROVAL WORKFLOWS
// ============================================

export const approvalRequest = pgTable(
	"approval_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Polymorphic reference - can approve different entity types
		entityType: text("entity_type").notNull(), // "time_entry" | "absence_entry"
		entityId: uuid("entity_id").notNull(),

		requestedBy: uuid("requested_by")
			.notNull()
			.references(() => employee.id),
		approverId: uuid("approver_id")
			.notNull()
			.references(() => employee.id),

		status: approvalStatusEnum("status").default("pending").notNull(),
		reason: text("reason"),
		notes: text("notes"),

		approvedAt: timestamp("approved_at"),
		rejectionReason: text("rejection_reason"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("approvalRequest_entityType_entityId_idx").on(table.entityType, table.entityId),
		index("approvalRequest_approverId_idx").on(table.approverId),
		index("approvalRequest_status_idx").on(table.status),
	],
);

// ============================================
// AUDIT TRAIL
// ============================================

export const auditLog = pgTable(
	"audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// What was changed
		entityType: text("entity_type").notNull(),
		entityId: uuid("entity_id").notNull(),
		action: text("action").notNull(), // "create", "update", "delete", "approve", "reject"

		// Who made the change
		performedBy: text("performed_by")
			.notNull()
			.references(() => user.id),
		employeeId: uuid("employee_id").references(() => employee.id), // If action was on behalf of employee

		// Change details
		changes: text("changes"), // JSON of what changed
		metadata: text("metadata"), // JSON for additional context

		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),

		timestamp: timestamp("timestamp").defaultNow().notNull(),
	},
	(table) => [
		index("auditLog_entityType_entityId_idx").on(table.entityType, table.entityId),
		index("auditLog_performedBy_idx").on(table.performedBy),
		index("auditLog_timestamp_idx").on(table.timestamp),
	],
);

// ============================================
// RELATIONS
// ============================================

// Organization relations
export const organizationRelations = relations(organization, ({ many }) => ({
	teams: many(team),
	employees: many(employee),
	absenceCategories: many(absenceCategory),
	holidayCategories: many(holidayCategory),
	holidays: many(holiday),
	vacationAllowances: many(vacationAllowance),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
	organization: one(organization, {
		fields: [team.organizationId],
		references: [organization.id],
	}),
	employees: many(employee),
}));

export const employeeRelations = relations(employee, ({ one, many }) => ({
	user: one(user, {
		fields: [employee.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [employee.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [employee.teamId],
		references: [team.id],
	}),
	manager: one(employee, {
		fields: [employee.managerId],
		references: [employee.id],
		relationName: "manager_employee",
	}),
	subordinates: many(employee, {
		relationName: "manager_employee",
	}),
	timeEntries: many(timeEntry),
	workPeriods: many(workPeriod),
	absenceEntries: many(absenceEntry),
	vacationAllowances: many(employeeVacationAllowance),
	requestedApprovals: many(approvalRequest, {
		relationName: "approval_requester",
	}),
	approvalsToDo: many(approvalRequest, {
		relationName: "approval_approver",
	}),
}));

// Time tracking relations
export const timeEntryRelations = relations(timeEntry, ({ one }) => ({
	employee: one(employee, {
		fields: [timeEntry.employeeId],
		references: [employee.id],
	}),
	previousEntry: one(timeEntry, {
		fields: [timeEntry.previousEntryId],
		references: [timeEntry.id],
		relationName: "entry_chain",
	}),
	replacesEntry: one(timeEntry, {
		fields: [timeEntry.replacesEntryId],
		references: [timeEntry.id],
		relationName: "entry_correction",
	}),
	supersededBy: one(timeEntry, {
		fields: [timeEntry.supersededById],
		references: [timeEntry.id],
		relationName: "entry_superseded",
	}),
	creator: one(user, {
		fields: [timeEntry.createdBy],
		references: [user.id],
	}),
}));

export const workPeriodRelations = relations(workPeriod, ({ one }) => ({
	employee: one(employee, {
		fields: [workPeriod.employeeId],
		references: [employee.id],
	}),
	clockIn: one(timeEntry, {
		fields: [workPeriod.clockInId],
		references: [timeEntry.id],
		relationName: "work_period_clock_in",
	}),
	clockOut: one(timeEntry, {
		fields: [workPeriod.clockOutId],
		references: [timeEntry.id],
		relationName: "work_period_clock_out",
	}),
}));

// Absence relations
export const absenceCategoryRelations = relations(absenceCategory, ({ one, many }) => ({
	organization: one(organization, {
		fields: [absenceCategory.organizationId],
		references: [organization.id],
	}),
	absenceEntries: many(absenceEntry),
}));

export const absenceEntryRelations = relations(absenceEntry, ({ one }) => ({
	employee: one(employee, {
		fields: [absenceEntry.employeeId],
		references: [employee.id],
	}),
	category: one(absenceCategory, {
		fields: [absenceEntry.categoryId],
		references: [absenceCategory.id],
	}),
	approver: one(employee, {
		fields: [absenceEntry.approvedBy],
		references: [employee.id],
	}),
}));

// Approval relations
export const approvalRequestRelations = relations(approvalRequest, ({ one }) => ({
	requester: one(employee, {
		fields: [approvalRequest.requestedBy],
		references: [employee.id],
		relationName: "approval_requester",
	}),
	approver: one(employee, {
		fields: [approvalRequest.approverId],
		references: [employee.id],
		relationName: "approval_approver",
	}),
}));

// Holiday relations
export const holidayCategoryRelations = relations(holidayCategory, ({ one, many }) => ({
	organization: one(organization, {
		fields: [holidayCategory.organizationId],
		references: [organization.id],
	}),
	holidays: many(holiday),
}));

export const holidayRelations = relations(holiday, ({ one }) => ({
	organization: one(organization, {
		fields: [holiday.organizationId],
		references: [organization.id],
	}),
	category: one(holidayCategory, {
		fields: [holiday.categoryId],
		references: [holidayCategory.id],
	}),
	creator: one(user, {
		fields: [holiday.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [holiday.updatedBy],
		references: [user.id],
	}),
}));

// Vacation allowance relations
export const vacationAllowanceRelations = relations(vacationAllowance, ({ one }) => ({
	organization: one(organization, {
		fields: [vacationAllowance.organizationId],
		references: [organization.id],
	}),
	creator: one(user, {
		fields: [vacationAllowance.createdBy],
		references: [user.id],
	}),
}));

export const employeeVacationAllowanceRelations = relations(
	employeeVacationAllowance,
	({ one }) => ({
		employee: one(employee, {
			fields: [employeeVacationAllowance.employeeId],
			references: [employee.id],
		}),
		adjuster: one(employee, {
			fields: [employeeVacationAllowance.adjustedBy],
			references: [employee.id],
		}),
	}),
);
