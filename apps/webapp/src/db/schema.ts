import { relations, sql } from "drizzle-orm";
import {
	boolean,
	decimal,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

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
export const holidayCategoryEnum = pgEnum("holiday_category_type", [
	"public_holiday",
	"company_holiday",
	"training_day",
	"custom",
]);
export const recurrenceTypeEnum = pgEnum("recurrence_type", ["none", "yearly", "custom"]);
export const holidayPresetAssignmentTypeEnum = pgEnum("holiday_preset_assignment_type", [
	"organization",
	"team",
	"employee",
]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const scheduleCycleEnum = pgEnum("schedule_cycle", [
	"daily",
	"weekly",
	"biweekly",
	"monthly",
	"yearly",
]);
export const scheduleTypeEnum = pgEnum("schedule_type", ["simple", "detailed"]);
export const workingDaysPresetEnum = pgEnum("working_days_preset", [
	"weekdays",
	"weekends",
	"all_days",
	"custom",
]);
export const dayOfWeekEnum = pgEnum("day_of_week", [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);

// Notification enums
export const notificationTypeEnum = pgEnum("notification_type", [
	"approval_request_submitted",
	"approval_request_approved",
	"approval_request_rejected",
	"time_correction_submitted",
	"time_correction_approved",
	"time_correction_rejected",
	"absence_request_submitted",
	"absence_request_approved",
	"absence_request_rejected",
	"team_member_added",
	"team_member_removed",
	"password_changed",
	"two_factor_enabled",
	"two_factor_disabled",
	"birthday_reminder",
	"vacation_balance_alert",
	// Shift scheduling notifications
	"schedule_published",
	"shift_assigned",
	"shift_swap_requested",
	"shift_swap_approved",
	"shift_swap_rejected",
	"shift_pickup_available",
	"shift_pickup_approved",
]);

export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "push", "email"]);

// Shift scheduling enums
export const shiftStatusEnum = pgEnum("shift_status", ["draft", "published"]);
export const shiftRequestTypeEnum = pgEnum("shift_request_type", ["swap", "assignment", "pickup"]);

// ============================================
// ORGANIZATION STRUCTURE
// ============================================

// Import auth tables from auth-schema for use in relations
// NOTE: Do NOT re-export these - they are exported from auth-schema.ts
// Re-exporting causes reference issues with Drizzle relation resolution
import { invitation, member, organization, user } from "./auth-schema";

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
			.$onUpdate(() => currentTimestamp())
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
		managerId: uuid("manager_id"), // DEPRECATED: Use employee_managers table instead

		// Personal information
		firstName: text("first_name"),
		lastName: text("last_name"),
		gender: genderEnum("gender"),
		birthday: timestamp("birthday", { mode: "date" }),

		// Job information
		role: roleEnum("role").default("employee").notNull(),
		employeeNumber: text("employee_number"),
		position: text("position"),
		startDate: timestamp("start_date"),
		endDate: timestamp("end_date"),
		isActive: boolean("is_active").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employee_userId_idx").on(table.userId),
		index("employee_organizationId_idx").on(table.organizationId),
		index("employee_teamId_idx").on(table.teamId),
		index("employee_managerId_idx").on(table.managerId),
		index("employee_userId_isActive_idx").on(table.userId, table.isActive),
	],
);

// ============================================
// EMPLOYEE MANAGERS (Many-to-Many)
// ============================================

// Junction table for multiple managers per employee
export const employeeManagers = pgTable(
	"employee_managers",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		managerId: uuid("manager_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		isPrimary: boolean("is_primary").default(false).notNull(), // Exactly one primary per employee
		assignedBy: text("assigned_by")
			.notNull()
			.references(() => user.id),
		assignedAt: timestamp("assigned_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("employeeManagers_employeeId_idx").on(table.employeeId),
		index("employeeManagers_managerId_idx").on(table.managerId),
		// Prevent duplicate manager assignments
		index("employeeManagers_unique_idx").on(table.employeeId, table.managerId),
		index("employeeManagers_managerId_isPrimary_idx").on(table.managerId, table.isPrimary),
	],
);

// ============================================
// TEAM PERMISSIONS (Granular Authorization)
// ============================================

// Granular permissions for team operations
export const teamPermissions = pgTable(
	"team_permissions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		employeeId: uuid("employee_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }), // null = org-wide

		// Four permission flags
		canCreateTeams: boolean("can_create_teams").default(false).notNull(),
		canManageTeamMembers: boolean("can_manage_team_members").default(false).notNull(),
		canManageTeamSettings: boolean("can_manage_team_settings").default(false).notNull(),
		canApproveTeamRequests: boolean("can_approve_team_requests").default(false).notNull(),

		grantedBy: uuid("granted_by")
			.notNull()
			.references(() => employee.id),
		grantedAt: timestamp("granted_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("teamPermissions_employeeId_idx").on(table.employeeId),
		index("teamPermissions_organizationId_idx").on(table.organizationId),
		index("teamPermissions_teamId_idx").on(table.teamId),
		// One permission record per employee per organization
		index("teamPermissions_unique_idx").on(table.employeeId, table.organizationId),
	],
);

// ============================================
// WORK SCHEDULE TEMPLATES
// ============================================

// Reusable work schedule templates
export const workScheduleTemplate = pgTable(
	"work_schedule_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Template identification
		name: text("name").notNull(),
		description: text("description"),

		// Schedule configuration
		scheduleCycle: scheduleCycleEnum("schedule_cycle").default("weekly").notNull(),
		scheduleType: scheduleTypeEnum("schedule_type").default("simple").notNull(),

		// Working days configuration
		workingDaysPreset: workingDaysPresetEnum("working_days_preset").default("weekdays").notNull(),

		// Simple mode: total hours per cycle
		hoursPerCycle: decimal("hours_per_cycle", { precision: 6, scale: 2 }),

		// Home office allowance per cycle
		homeOfficeDaysPerCycle: integer("home_office_days_per_cycle").default(0),

		// Status flags
		isActive: boolean("is_active").default(true).notNull(),
		isDefault: boolean("is_default").default(false).notNull(),

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
		index("workScheduleTemplate_organizationId_idx").on(table.organizationId),
		index("workScheduleTemplate_isActive_idx").on(table.isActive),
		uniqueIndex("workScheduleTemplate_org_name_idx").on(table.organizationId, table.name),
	],
);

// Day-by-day configuration for detailed schedules
export const workScheduleTemplateDays = pgTable(
	"work_schedule_template_days",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		templateId: uuid("template_id")
			.notNull()
			.references(() => workScheduleTemplate.id, { onDelete: "cascade" }),

		// Day configuration
		dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
		hoursPerDay: decimal("hours_per_day", { precision: 4, scale: 2 }).notNull(),
		isWorkDay: boolean("is_work_day").default(true).notNull(),

		// For biweekly cycles: which week (1 or 2)
		cycleWeek: integer("cycle_week").default(1),

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("workScheduleTemplateDays_templateId_idx").on(table.templateId),
		uniqueIndex("workScheduleTemplateDays_unique_idx").on(
			table.templateId,
			table.dayOfWeek,
			table.cycleWeek,
		),
	],
);

// Hierarchical assignment of templates to organizations, teams, or employees
export const workScheduleAssignment = pgTable(
	"work_schedule_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		templateId: uuid("template_id")
			.notNull()
			.references(() => workScheduleTemplate.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Assignment target
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "cascade" }),

		// Priority: 0=org, 1=team, 2=employee (higher wins)
		priority: integer("priority").default(0).notNull(),

		// Effective dates
		effectiveFrom: timestamp("effective_from"),
		effectiveUntil: timestamp("effective_until"),

		// Status
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
		index("workScheduleAssignment_templateId_idx").on(table.templateId),
		index("workScheduleAssignment_organizationId_idx").on(table.organizationId),
		index("workScheduleAssignment_teamId_idx").on(table.teamId),
		index("workScheduleAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("workScheduleAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("workScheduleAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("workScheduleAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
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
			.$onUpdate(() => currentTimestamp())
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
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		updatedBy: text("updated_by").references(() => user.id),
	},
	(table) => [
		index("holiday_organizationId_idx").on(table.organizationId),
		index("holiday_startDate_idx").on(table.startDate),
		index("holiday_categoryId_idx").on(table.categoryId),
		index("holiday_orgId_isActive_recurrenceType_idx").on(
			table.organizationId,
			table.isActive,
			table.recurrenceType,
		),
	],
);

// ============================================
// HOLIDAY PRESETS
// ============================================

// Holiday presets - Named presets with location metadata for reusable holiday sets
export const holidayPreset = pgTable(
	"holiday_preset",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // "Germany - Bavaria"
		description: text("description"),
		countryCode: text("country_code"), // ISO 3166-1 alpha-2 (e.g., "DE")
		stateCode: text("state_code"), // ISO 3166-2 subdivision (e.g., "BY")
		regionCode: text("region_code"), // Further subdivision if applicable
		color: text("color"), // Hex color for UI display
		isActive: boolean("is_active").default(true).notNull(),
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
		index("holidayPreset_organizationId_idx").on(table.organizationId),
		// Unique constraint for same location within organization
		uniqueIndex("holidayPreset_org_location_idx").on(
			table.organizationId,
			table.countryCode,
			table.stateCode,
			table.regionCode,
		),
	],
);

// Individual holidays within a preset
export const holidayPresetHoliday = pgTable(
	"holiday_preset_holiday",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		presetId: uuid("preset_id")
			.notNull()
			.references(() => holidayPreset.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // "Christmas Day"
		description: text("description"),
		month: integer("month").notNull(), // 1-12
		day: integer("day").notNull(), // 1-31
		durationDays: integer("duration_days").default(1).notNull(), // Multi-day holidays
		holidayType: text("holiday_type"), // "public", "bank", "optional", "school", "observance"
		isFloating: boolean("is_floating").default(false).notNull(), // Easter, Thanksgiving
		floatingRule: text("floating_rule"), // JSON for floating calculation
		categoryId: uuid("category_id").references(() => holidayCategory.id),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("holidayPresetHoliday_presetId_idx").on(table.presetId),
		index("holidayPresetHoliday_categoryId_idx").on(table.categoryId),
		// Unique holiday name per preset
		uniqueIndex("holidayPresetHoliday_preset_name_idx").on(table.presetId, table.name),
	],
);

// Assignment of presets to organizations, teams, or employees
export const holidayPresetAssignment = pgTable(
	"holiday_preset_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		presetId: uuid("preset_id")
			.notNull()
			.references(() => holidayPreset.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "cascade" }),
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
		index("holidayPresetAssignment_presetId_idx").on(table.presetId),
		index("holidayPresetAssignment_organizationId_idx").on(table.organizationId),
		index("holidayPresetAssignment_teamId_idx").on(table.teamId),
		index("holidayPresetAssignment_employeeId_idx").on(table.employeeId),
		// One org default per organization
		uniqueIndex("holidayPresetAssignment_org_default_idx")
			.on(table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		// One assignment per team
		uniqueIndex("holidayPresetAssignment_team_idx")
			.on(table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		// One assignment per employee
		uniqueIndex("holidayPresetAssignment_employee_idx")
			.on(table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);

// Assignment of individual custom holidays to organizations, teams, or employees
// This allows location-specific closing days to affect only certain teams/employees
export const holidayAssignment = pgTable(
	"holiday_assignment",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		holidayId: uuid("holiday_id")
			.notNull()
			.references(() => holiday.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		assignmentType: holidayPresetAssignmentTypeEnum("assignment_type").notNull(),
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "cascade" }),
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
		index("holidayAssignment_holidayId_idx").on(table.holidayId),
		index("holidayAssignment_organizationId_idx").on(table.organizationId),
		index("holidayAssignment_teamId_idx").on(table.teamId),
		index("holidayAssignment_employeeId_idx").on(table.employeeId),
		// Prevent duplicate assignments for the same holiday to the same target
		uniqueIndex("holidayAssignment_holiday_org_idx")
			.on(table.holidayId, table.organizationId, table.assignmentType)
			.where(sql`assignment_type = 'organization' AND is_active = true`),
		uniqueIndex("holidayAssignment_holiday_team_idx")
			.on(table.holidayId, table.teamId)
			.where(sql`team_id IS NOT NULL AND is_active = true`),
		uniqueIndex("holidayAssignment_holiday_employee_idx")
			.on(table.holidayId, table.employeeId)
			.where(sql`employee_id IS NOT NULL AND is_active = true`),
	],
);

// ============================================
// SHIFT SCHEDULING
// ============================================

// Reusable shift templates (Morning Shift, Night Shift, etc.)
export const shiftTemplate = pgTable(
	"shift_template",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		name: text("name").notNull(), // "Morning Shift", "Night Shift"
		startTime: text("start_time").notNull(), // "09:00" (HH:mm format)
		endTime: text("end_time").notNull(), // "17:00" (HH:mm format)
		color: text("color"), // Hex color for UI display

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
		index("shiftTemplate_organizationId_idx").on(table.organizationId),
		uniqueIndex("shiftTemplate_org_name_idx").on(table.organizationId, table.name),
	],
);

// Actual shift instances assigned to employees
export const shift = pgTable(
	"shift",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "set null" }), // nullable = Open Shift
		templateId: uuid("template_id").references(() => shiftTemplate.id, { onDelete: "set null" }),

		// Shift timing
		date: timestamp("date", { mode: "date" }).notNull(),
		startTime: text("start_time").notNull(), // "09:00"
		endTime: text("end_time").notNull(), // "17:00"

		// Status workflow
		status: shiftStatusEnum("status").default("draft").notNull(),
		publishedAt: timestamp("published_at"),
		publishedBy: text("published_by").references(() => user.id),

		// Metadata
		notes: text("notes"),
		color: text("color"), // Override template color if needed

		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("shift_organizationId_idx").on(table.organizationId),
		index("shift_employeeId_idx").on(table.employeeId),
		index("shift_templateId_idx").on(table.templateId),
		index("shift_date_idx").on(table.date),
		index("shift_status_idx").on(table.status),
		index("shift_org_date_status_idx").on(table.organizationId, table.date, table.status),
		index("shift_org_employee_date_idx").on(table.organizationId, table.employeeId, table.date),
	],
);

// Shift change requests (swaps, pickups, assignments)
export const shiftRequest = pgTable(
	"shift_request",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		shiftId: uuid("shift_id")
			.notNull()
			.references(() => shift.id, { onDelete: "cascade" }),

		type: shiftRequestTypeEnum("type").notNull(),
		status: approvalStatusEnum("status").default("pending").notNull(),

		// Who is requesting
		requesterId: uuid("requester_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		// Target employee (for swaps/assignments)
		targetEmployeeId: uuid("target_employee_id").references(() => employee.id, {
			onDelete: "set null",
		}),

		// Request details
		reason: text("reason"), // Free text reason
		reasonCategory: text("reason_category"), // "sick", "emergency", "childcare", "other"
		notes: text("notes"),

		// Approval tracking
		approverId: uuid("approver_id").references(() => employee.id),
		approvedAt: timestamp("approved_at"),
		rejectionReason: text("rejection_reason"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("shiftRequest_shiftId_idx").on(table.shiftId),
		index("shiftRequest_requesterId_idx").on(table.requesterId),
		index("shiftRequest_targetEmployeeId_idx").on(table.targetEmployeeId),
		index("shiftRequest_approverId_idx").on(table.approverId),
		index("shiftRequest_status_idx").on(table.status),
		index("shiftRequest_type_status_idx").on(table.type, table.status),
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
		index("timeEntry_employeeId_isSuperseded_timestamp_idx").on(
			table.employeeId,
			table.isSuperseded,
			table.timestamp,
		),
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
			.$onUpdate(() => currentTimestamp())
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
			.$onUpdate(() => currentTimestamp())
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
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("absenceEntry_employeeId_idx").on(table.employeeId),
		index("absenceEntry_startDate_idx").on(table.startDate),
		index("absenceEntry_status_idx").on(table.status),
		index("absenceEntry_employeeId_status_idx").on(table.employeeId, table.status),
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

		// Policy name for identification (e.g., "Germany Standard", "Senior Engineers")
		name: text("name").notNull(),

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
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("vacationAllowance_organizationId_year_idx").on(table.organizationId, table.year),
		uniqueIndex("vacationAllowance_org_year_name_idx").on(
			table.organizationId,
			table.year,
			table.name,
		),
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
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("employeeVacationAllowance_employeeId_idx").on(table.employeeId),
		index("employeeVacationAllowance_employeeId_year_idx").on(table.employeeId, table.year),
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
		teamId: uuid("team_id").references(() => team.id, { onDelete: "cascade" }),
		employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "cascade" }),
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
			.$onUpdate(() => currentTimestamp())
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

// Audit log relations
export const auditLogRelations = relations(auditLog, ({ one }) => ({
	performedByUser: one(user, {
		fields: [auditLog.performedBy],
		references: [user.id],
	}),
	employeeRecord: one(employee, {
		fields: [auditLog.employeeId],
		references: [employee.id],
	}),
}));

// ============================================
// NOTIFICATIONS
// ============================================

// In-app notifications for users
export const notification = pgTable(
	"notification",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		type: notificationTypeEnum("type").notNull(),
		title: text("title").notNull(),
		message: text("message").notNull(),

		// Optional link to related entity
		entityType: text("entity_type"), // "absence_entry" | "work_period" | "team" | etc.
		entityId: uuid("entity_id"),
		actionUrl: text("action_url"), // Deep link to relevant page

		// Read status
		isRead: boolean("is_read").default(false).notNull(),
		readAt: timestamp("read_at"),

		// Metadata
		metadata: text("metadata"), // JSON for additional context

		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("notification_userId_idx").on(table.userId),
		index("notification_organizationId_idx").on(table.organizationId),
		index("notification_isRead_idx").on(table.isRead),
		index("notification_createdAt_idx").on(table.createdAt),
		index("notification_type_idx").on(table.type),
		index("notification_userId_orgId_isRead_idx").on(
			table.userId,
			table.organizationId,
			table.isRead,
		),
		index("notification_userId_orgId_createdAt_idx").on(
			table.userId,
			table.organizationId,
			table.createdAt,
		),
	],
);

// User notification preferences per channel and type (user-level, not org-specific)
export const notificationPreference = pgTable(
	"notification_preference",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// organizationId kept for backwards compatibility but nullable (preferences are user-level)
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),

		notificationType: notificationTypeEnum("notification_type").notNull(),
		channel: notificationChannelEnum("channel").notNull(),
		enabled: boolean("enabled").default(true).notNull(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("notificationPreference_userId_idx").on(table.userId),
		// Unique constraint: one preference per user per type per channel (user-level)
		uniqueIndex("notificationPreference_unique_idx").on(
			table.userId,
			table.notificationType,
			table.channel,
		),
	],
);

// Push notification subscriptions (Web Push API)
export const pushSubscription = pgTable(
	"push_subscription",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Web Push subscription data
		endpoint: text("endpoint").notNull(),
		p256dh: text("p256dh").notNull(), // Public key
		auth: text("auth").notNull(), // Auth secret

		// Device/browser info for management
		userAgent: text("user_agent"),
		deviceName: text("device_name"), // User-friendly name

		// Status
		isActive: boolean("is_active").default(true).notNull(),
		lastUsedAt: timestamp("last_used_at"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("pushSubscription_userId_idx").on(table.userId),
		index("pushSubscription_endpoint_idx").on(table.endpoint),
		index("pushSubscription_isActive_idx").on(table.isActive),
		index("pushSubscription_userId_isActive_idx").on(table.userId, table.isActive),
	],
);

// ============================================
// RELATIONS
// ============================================

// Organization relations (includes auth relations: members, invitations)
export const organizationRelations = relations(organization, ({ one, many }) => ({
	// Auth relations (from auth-schema tables)
	members: many(member),
	invitations: many(invitation),
	// Business relations
	teams: many(team),
	employees: many(employee),
	absenceCategories: many(absenceCategory),
	holidayCategories: many(holidayCategory),
	holidays: many(holiday),
	holidayPresets: many(holidayPreset),
	holidayPresetAssignments: many(holidayPresetAssignment),
	holidayAssignments: many(holidayAssignment),
	vacationAllowances: many(vacationAllowance),
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	workScheduleTemplates: many(workScheduleTemplate),
	workScheduleAssignments: many(workScheduleAssignment),
	// Shift scheduling
	shiftTemplates: many(shiftTemplate),
	shifts: many(shift),
	// Notifications
	notifications: many(notification),
	notificationPreferences: many(notificationPreference),
	// Enterprise features
	domains: many(organizationDomain),
	branding: one(organizationBranding),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
	organization: one(organization, {
		fields: [team.organizationId],
		references: [organization.id],
	}),
	employees: many(employee),
	holidayPresetAssignments: many(holidayPresetAssignment),
	holidayAssignments: many(holidayAssignment),
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	workScheduleAssignments: many(workScheduleAssignment),
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
	// Multiple managers support
	managers: many(employeeManagers, {
		relationName: "employee_managers",
	}),
	managedEmployees: many(employeeManagers, {
		relationName: "manager_employees",
	}),
	// Team permissions
	teamPermissions: many(teamPermissions),
	// Time tracking
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
	// Holiday assignments
	holidayPresetAssignments: many(holidayPresetAssignment),
	holidayAssignments: many(holidayAssignment),
	// Vacation policy assignments
	vacationPolicyAssignments: many(vacationPolicyAssignment),
	// Work schedule assignments
	workScheduleAssignments: many(workScheduleAssignment),
	// Shift scheduling
	shifts: many(shift),
	shiftRequestsAsRequester: many(shiftRequest, {
		relationName: "shift_request_requester",
	}),
	shiftRequestsAsTarget: many(shiftRequest, {
		relationName: "shift_request_target",
	}),
	shiftRequestsAsApprover: many(shiftRequest, {
		relationName: "shift_request_approver",
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
	presetHolidays: many(holidayPresetHoliday),
}));

export const holidayRelations = relations(holiday, ({ one, many }) => ({
	organization: one(organization, {
		fields: [holiday.organizationId],
		references: [organization.id],
	}),
	category: one(holidayCategory, {
		fields: [holiday.categoryId],
		references: [holidayCategory.id],
	}),
	assignments: many(holidayAssignment),
	creator: one(user, {
		fields: [holiday.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [holiday.updatedBy],
		references: [user.id],
	}),
}));

// Holiday preset relations
export const holidayPresetRelations = relations(holidayPreset, ({ one, many }) => ({
	organization: one(organization, {
		fields: [holidayPreset.organizationId],
		references: [organization.id],
	}),
	holidays: many(holidayPresetHoliday),
	assignments: many(holidayPresetAssignment),
	creator: one(user, {
		fields: [holidayPreset.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [holidayPreset.updatedBy],
		references: [user.id],
	}),
}));

export const holidayPresetHolidayRelations = relations(holidayPresetHoliday, ({ one }) => ({
	preset: one(holidayPreset, {
		fields: [holidayPresetHoliday.presetId],
		references: [holidayPreset.id],
	}),
	category: one(holidayCategory, {
		fields: [holidayPresetHoliday.categoryId],
		references: [holidayCategory.id],
	}),
}));

export const holidayPresetAssignmentRelations = relations(holidayPresetAssignment, ({ one }) => ({
	preset: one(holidayPreset, {
		fields: [holidayPresetAssignment.presetId],
		references: [holidayPreset.id],
	}),
	organization: one(organization, {
		fields: [holidayPresetAssignment.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [holidayPresetAssignment.teamId],
		references: [team.id],
	}),
	employee: one(employee, {
		fields: [holidayPresetAssignment.employeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [holidayPresetAssignment.createdBy],
		references: [user.id],
	}),
}));

export const holidayAssignmentRelations = relations(holidayAssignment, ({ one }) => ({
	holiday: one(holiday, {
		fields: [holidayAssignment.holidayId],
		references: [holiday.id],
	}),
	organization: one(organization, {
		fields: [holidayAssignment.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [holidayAssignment.teamId],
		references: [team.id],
	}),
	employee: one(employee, {
		fields: [holidayAssignment.employeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [holidayAssignment.createdBy],
		references: [user.id],
	}),
}));

// Vacation allowance relations
export const vacationAllowanceRelations = relations(vacationAllowance, ({ one, many }) => ({
	organization: one(organization, {
		fields: [vacationAllowance.organizationId],
		references: [organization.id],
	}),
	creator: one(user, {
		fields: [vacationAllowance.createdBy],
		references: [user.id],
	}),
	assignments: many(vacationPolicyAssignment),
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

// Vacation policy assignment relations
export const vacationPolicyAssignmentRelations = relations(vacationPolicyAssignment, ({ one }) => ({
	policy: one(vacationAllowance, {
		fields: [vacationPolicyAssignment.policyId],
		references: [vacationAllowance.id],
	}),
	organization: one(organization, {
		fields: [vacationPolicyAssignment.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [vacationPolicyAssignment.teamId],
		references: [team.id],
	}),
	employee: one(employee, {
		fields: [vacationPolicyAssignment.employeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [vacationPolicyAssignment.createdBy],
		references: [user.id],
	}),
}));

// Employee managers relations
export const employeeManagersRelations = relations(employeeManagers, ({ one }) => ({
	employee: one(employee, {
		fields: [employeeManagers.employeeId],
		references: [employee.id],
		relationName: "employee_managers",
	}),
	manager: one(employee, {
		fields: [employeeManagers.managerId],
		references: [employee.id],
		relationName: "manager_employees",
	}),
	assigner: one(user, {
		fields: [employeeManagers.assignedBy],
		references: [user.id],
	}),
}));

// Team permissions relations
export const teamPermissionsRelations = relations(teamPermissions, ({ one }) => ({
	employee: one(employee, {
		fields: [teamPermissions.employeeId],
		references: [employee.id],
	}),
	organization: one(organization, {
		fields: [teamPermissions.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [teamPermissions.teamId],
		references: [team.id],
	}),
	grantor: one(employee, {
		fields: [teamPermissions.grantedBy],
		references: [employee.id],
	}),
}));

// Work schedule template relations
export const workScheduleTemplateRelations = relations(workScheduleTemplate, ({ one, many }) => ({
	organization: one(organization, {
		fields: [workScheduleTemplate.organizationId],
		references: [organization.id],
	}),
	days: many(workScheduleTemplateDays),
	assignments: many(workScheduleAssignment),
	creator: one(user, {
		fields: [workScheduleTemplate.createdBy],
		references: [user.id],
	}),
	updater: one(user, {
		fields: [workScheduleTemplate.updatedBy],
		references: [user.id],
	}),
}));

export const workScheduleTemplateDaysRelations = relations(workScheduleTemplateDays, ({ one }) => ({
	template: one(workScheduleTemplate, {
		fields: [workScheduleTemplateDays.templateId],
		references: [workScheduleTemplate.id],
	}),
}));

export const workScheduleAssignmentRelations = relations(workScheduleAssignment, ({ one }) => ({
	template: one(workScheduleTemplate, {
		fields: [workScheduleAssignment.templateId],
		references: [workScheduleTemplate.id],
	}),
	organization: one(organization, {
		fields: [workScheduleAssignment.organizationId],
		references: [organization.id],
	}),
	team: one(team, {
		fields: [workScheduleAssignment.teamId],
		references: [team.id],
	}),
	employee: one(employee, {
		fields: [workScheduleAssignment.employeeId],
		references: [employee.id],
	}),
	creator: one(user, {
		fields: [workScheduleAssignment.createdBy],
		references: [user.id],
	}),
}));

// Shift scheduling relations
export const shiftTemplateRelations = relations(shiftTemplate, ({ one, many }) => ({
	organization: one(organization, {
		fields: [shiftTemplate.organizationId],
		references: [organization.id],
	}),
	shifts: many(shift),
	creator: one(user, {
		fields: [shiftTemplate.createdBy],
		references: [user.id],
	}),
}));

export const shiftRelations = relations(shift, ({ one, many }) => ({
	organization: one(organization, {
		fields: [shift.organizationId],
		references: [organization.id],
	}),
	employee: one(employee, {
		fields: [shift.employeeId],
		references: [employee.id],
	}),
	template: one(shiftTemplate, {
		fields: [shift.templateId],
		references: [shiftTemplate.id],
	}),
	requests: many(shiftRequest),
	creator: one(user, {
		fields: [shift.createdBy],
		references: [user.id],
	}),
	publisher: one(user, {
		fields: [shift.publishedBy],
		references: [user.id],
	}),
}));

export const shiftRequestRelations = relations(shiftRequest, ({ one }) => ({
	shift: one(shift, {
		fields: [shiftRequest.shiftId],
		references: [shift.id],
	}),
	requester: one(employee, {
		fields: [shiftRequest.requesterId],
		references: [employee.id],
		relationName: "shift_request_requester",
	}),
	targetEmployee: one(employee, {
		fields: [shiftRequest.targetEmployeeId],
		references: [employee.id],
		relationName: "shift_request_target",
	}),
	approver: one(employee, {
		fields: [shiftRequest.approverId],
		references: [employee.id],
		relationName: "shift_request_approver",
	}),
}));

// Notification relations
export const notificationRelations = relations(notification, ({ one }) => ({
	user: one(user, {
		fields: [notification.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [notification.organizationId],
		references: [organization.id],
	}),
}));

export const notificationPreferenceRelations = relations(notificationPreference, ({ one }) => ({
	user: one(user, {
		fields: [notificationPreference.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [notificationPreference.organizationId],
		references: [organization.id],
	}),
}));

export const pushSubscriptionRelations = relations(pushSubscription, ({ one }) => ({
	user: one(user, {
		fields: [pushSubscription.userId],
		references: [user.id],
	}),
}));

// ============================================
// ENTERPRISE: CUSTOM DOMAINS
// ============================================

// Auth method configuration type for custom domains
export type AuthConfig = {
	emailPasswordEnabled: boolean;
	socialProvidersEnabled: string[]; // ["google", "github", "linkedin", "apple"]
	ssoEnabled: boolean;
	ssoProviderId?: string; // Reference to ssoProvider.providerId
	passkeyEnabled: boolean;
};

// Custom domain configuration per organization
export const organizationDomain = pgTable(
	"organization_domain",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Custom domain configuration
		domain: text("domain").notNull().unique(), // e.g., "login.acme.com"
		domainVerified: boolean("domain_verified").default(false).notNull(),
		verificationToken: text("verification_token"),
		verificationTokenExpiresAt: timestamp("verification_token_expires_at"),

		// Auth method configuration for this domain (JSON)
		authConfig: text("auth_config")
			.$type<AuthConfig>()
			.default(
				JSON.stringify({
					emailPasswordEnabled: true,
					socialProvidersEnabled: [],
					ssoEnabled: false,
					passkeyEnabled: true,
				}),
			),

		isPrimary: boolean("is_primary").default(false).notNull(), // Primary domain for org

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("organizationDomain_organizationId_idx").on(table.organizationId),
		index("organizationDomain_domain_idx").on(table.domain),
		index("organizationDomain_domainVerified_idx").on(table.domainVerified),
		// Enforce only one domain per organization
		uniqueIndex("organizationDomain_org_single_idx").on(table.organizationId),
	],
);

// ============================================
// ENTERPRISE: ORGANIZATION BRANDING
// ============================================

// Custom quote type
export type CustomQuote = {
	quote: string;
	author: string;
};

// Custom branding for organization login pages
export const organizationBranding = pgTable(
	"organization_branding",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Login page branding
		logoUrl: text("logo_url"),
		backgroundImageUrl: text("background_image_url"),
		appName: text("app_name"), // Override "z8" branding

		// Theme customization
		primaryColor: text("primary_color"), // e.g., "#3b82f6" or "oklch(0.6 0.2 250)"
		accentColor: text("accent_color"), // Optional secondary color

		// Quote settings
		quotesEnabled: boolean("quotes_enabled").default(true).notNull(),
		customQuotes: text("custom_quotes").$type<CustomQuote[]>(), // JSON array of quotes

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("organizationBranding_organizationId_idx").on(table.organizationId)],
);

// Enterprise relations
export const organizationDomainRelations = relations(organizationDomain, ({ one }) => ({
	organization: one(organization, {
		fields: [organizationDomain.organizationId],
		references: [organization.id],
	}),
}));

export const organizationBrandingRelations = relations(organizationBranding, ({ one }) => ({
	organization: one(organization, {
		fields: [organizationBranding.organizationId],
		references: [organization.id],
	}),
}));
