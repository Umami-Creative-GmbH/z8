import { boolean, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization } from "../auth-schema";
import { absenceTypeEnum, approvalStatusEnum, dayPeriodEnum } from "./enums";
import { employee } from "./organization";

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

		// Logical calendar dates (YYYY-MM-DD) - timezone-independent
		startDate: date("start_date").notNull(),
		startPeriod: dayPeriodEnum("start_period").default("full_day").notNull(),
		endDate: date("end_date").notNull(),
		endPeriod: dayPeriodEnum("end_period").default("full_day").notNull(),

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
