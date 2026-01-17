import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { user } from "../auth-schema";
import type { DashboardWidgetOrder } from "./types";

// ============================================
// USER SETTINGS (Dashboard preferences, etc.)
// ============================================

// User-level settings (per-user, not per-organization)
export const userSettings = pgTable(
	"user_settings",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),

		// Dashboard preferences
		dashboardWidgetOrder: text("dashboard_widget_order").$type<DashboardWidgetOrder>(),

		// Onboarding state
		onboardingComplete: boolean("onboarding_complete").default(false).notNull(),
		onboardingStep: text("onboarding_step"),
		onboardingStartedAt: timestamp("onboarding_started_at"),
		onboardingCompletedAt: timestamp("onboarding_completed_at"),

		// Water reminder / hydration tracking settings
		waterReminderEnabled: boolean("water_reminder_enabled").default(false).notNull(),
		waterReminderPreset: text("water_reminder_preset").default("moderate").notNull(), // light|moderate|active|custom
		waterReminderIntervalMinutes: integer("water_reminder_interval_minutes").default(45).notNull(),
		waterReminderDailyGoal: integer("water_reminder_daily_goal").default(8).notNull(), // glasses per day

		// User preferences
		timezone: text("timezone").default("UTC").notNull(), // e.g., "UTC", "America/New_York"

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("userSettings_userId_idx").on(table.userId)],
);
