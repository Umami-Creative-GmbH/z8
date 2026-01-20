import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { approvalStatusEnum, shiftRecurrenceTypeEnum, shiftRequestTypeEnum, shiftStatusEnum } from "./enums";
import { employee, locationSubarea } from "./organization";

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

		// Default subarea for shifts created from this template (optional)
		subareaId: uuid("subarea_id").references(() => locationSubarea.id, {
			onDelete: "set null",
		}),

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
		index("shiftTemplate_subareaId_idx").on(table.subareaId),
		uniqueIndex("shiftTemplate_org_name_idx").on(table.organizationId, table.name),
	],
);

// Recurring shift patterns (for automated shift generation)
export const shiftRecurrence = pgTable(
	"shift_recurrence",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Source template (optional - for inheriting default values)
		templateId: uuid("template_id").references(() => shiftTemplate.id, {
			onDelete: "set null",
		}),

		// Subarea assignment (required)
		subareaId: uuid("subarea_id")
			.notNull()
			.references(() => locationSubarea.id, { onDelete: "cascade" }),

		// Recurrence pattern
		recurrenceType: shiftRecurrenceTypeEnum("recurrence_type").notNull(),

		// Shift timing (override template if not using one)
		startTime: text("start_time").notNull(), // "09:00"
		endTime: text("end_time").notNull(), // "17:00"
		color: text("color"),

		// Date range for recurrence
		startDate: timestamp("start_date", { mode: "date" }).notNull(),
		endDate: timestamp("end_date", { mode: "date" }), // null = indefinite

		// Weekly recurrence: which days (stored as JSON array of day numbers: 0=Sunday, 6=Saturday)
		weeklyDays: text("weekly_days"), // JSON: [1, 2, 3, 4, 5] for Mon-Fri

		// Biweekly: which week to apply (1 or 2)
		biweeklyWeek: integer("biweekly_week"),

		// Monthly: day of month
		monthlyDayOfMonth: integer("monthly_day_of_month"),

		// Custom interval (every N days/weeks)
		customInterval: integer("custom_interval"),
		customIntervalUnit: text("custom_interval_unit"), // "days" | "weeks"

		// Generation tracking
		lastGeneratedDate: timestamp("last_generated_date", { mode: "date" }),
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
		index("shiftRecurrence_organizationId_idx").on(table.organizationId),
		index("shiftRecurrence_templateId_idx").on(table.templateId),
		index("shiftRecurrence_subareaId_idx").on(table.subareaId),
		index("shiftRecurrence_isActive_idx").on(table.isActive),
		index("shiftRecurrence_org_active_idx").on(table.organizationId, table.isActive),
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
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "set null",
		}), // nullable = Open Shift
		templateId: uuid("template_id").references(() => shiftTemplate.id, {
			onDelete: "set null",
		}),

		// Subarea assignment (required - every shift must be assigned to a subarea)
		subareaId: uuid("subarea_id")
			.notNull()
			.references(() => locationSubarea.id, { onDelete: "cascade" }),

		// Recurrence reference (if generated from a recurring pattern)
		recurrenceId: uuid("recurrence_id").references(() => shiftRecurrence.id, {
			onDelete: "set null",
		}),

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
		index("shift_subareaId_idx").on(table.subareaId),
		index("shift_recurrenceId_idx").on(table.recurrenceId),
		index("shift_date_idx").on(table.date),
		index("shift_status_idx").on(table.status),
		index("shift_org_date_status_idx").on(table.organizationId, table.date, table.status),
		index("shift_org_employee_date_idx").on(table.organizationId, table.employeeId, table.date),
		index("shift_org_subarea_date_idx").on(table.organizationId, table.subareaId, table.date),
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
