import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { user } from "../auth-schema";
import { waterIntakeSourceEnum } from "./enums";

// ============================================
// WELLNESS / HYDRATION TRACKING
// ============================================

// Individual water intake logs
export const waterIntakeLog = pgTable(
	"water_intake_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		loggedAt: timestamp("logged_at").defaultNow().notNull(),
		amount: integer("amount").default(1).notNull(), // number of glasses
		source: waterIntakeSourceEnum("source").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("water_intake_log_userId_idx").on(table.userId),
		index("water_intake_log_loggedAt_idx").on(table.loggedAt),
	],
);

// Hydration stats - user-level, global across all organizations
export const hydrationStats = pgTable(
	"hydration_stats",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.unique(),
		currentStreak: integer("current_streak").default(0).notNull(),
		longestStreak: integer("longest_streak").default(0).notNull(),
		lastGoalMetDate: date("last_goal_met_date"), // last date user met daily goal
		totalIntakeAllTime: integer("total_intake_all_time").default(0).notNull(),
		snoozedUntil: timestamp("snoozed_until"), // for "snooze for today"
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("hydration_stats_userId_idx").on(table.userId)],
);
