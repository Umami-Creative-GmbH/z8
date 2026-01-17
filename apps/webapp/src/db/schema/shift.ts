import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { approvalStatusEnum, shiftRequestTypeEnum, shiftStatusEnum } from "./enums";
import { employee } from "./organization";

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
		employeeId: uuid("employee_id").references(() => employee.id, {
			onDelete: "set null",
		}), // nullable = Open Shift
		templateId: uuid("template_id").references(() => shiftTemplate.id, {
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
