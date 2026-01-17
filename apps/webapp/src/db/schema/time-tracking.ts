import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { user } from "../auth-schema";
import { timeEntryTypeEnum } from "./enums";
import { employee } from "./organization";
import { project } from "./project";
import type { WorkPeriodAutoAdjustmentReason } from "./types";

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

		// Project assignment (optional)
		projectId: uuid("project_id").references(() => project.id, {
			onDelete: "set null",
		}),

		startTime: timestamp("start_time").notNull(),
		endTime: timestamp("end_time"),
		durationMinutes: integer("duration_minutes"), // Calculated when clocked out

		isActive: boolean("is_active").default(true).notNull(), // False when clocked out

		// Auto-adjustment tracking for break enforcement
		wasAutoAdjusted: boolean("was_auto_adjusted").default(false).notNull(),
		autoAdjustmentReason: text("auto_adjustment_reason").$type<WorkPeriodAutoAdjustmentReason>(),
		autoAdjustedAt: timestamp("auto_adjusted_at", { withTimezone: true }),
		originalEndTime: timestamp("original_end_time", { withTimezone: true }), // Audit trail
		originalDurationMinutes: integer("original_duration_minutes"),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("workPeriod_employeeId_idx").on(table.employeeId),
		index("workPeriod_startTime_idx").on(table.startTime),
		index("workPeriod_projectId_idx").on(table.projectId),
	],
);
