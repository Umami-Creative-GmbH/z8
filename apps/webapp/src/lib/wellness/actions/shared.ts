import { DateTime } from "luxon";
import type { hydrationStats, userSettings } from "@/db/schema";
import type {
	HydrationStats as HydrationStatsValue,
	WaterReminderSettings,
} from "@/lib/validations/wellness";
import type { WaterReminderPreset } from "@/lib/wellness/water-presets";

export const DEFAULT_WATER_REMINDER_ENABLED = false;
export const DEFAULT_WATER_REMINDER_INTERVAL_MINUTES = 45;
export const DEFAULT_WATER_DAILY_GOAL = 8;
export const DEFAULT_WATER_REMINDER_PRESET: WaterReminderPreset = "moderate";

export type HydrationStatsRecord = typeof hydrationStats.$inferSelect;
export type UserSettingsRecord = typeof userSettings.$inferSelect;

export function getTodayRange(now = DateTime.now()) {
	return {
		start: now.startOf("day").toJSDate(),
		end: now.endOf("day").toJSDate(),
	};
}

export function createDefaultHydrationStats(userId: string) {
	return {
		userId,
		currentStreak: 0,
		longestStreak: 0,
		totalIntakeAllTime: 0,
	};
}

export function calculateGoalProgress(todayIntake: number, dailyGoal: number) {
	if (dailyGoal <= 0) {
		return 0;
	}

	return Math.min(100, Math.round((todayIntake / dailyGoal) * 100));
}

export function toWaterReminderSettings(
	settings: UserSettingsRecord | null | undefined,
): WaterReminderSettings {
	return {
		enabled: settings?.waterReminderEnabled ?? DEFAULT_WATER_REMINDER_ENABLED,
		preset: (settings?.waterReminderPreset ?? DEFAULT_WATER_REMINDER_PRESET) as WaterReminderPreset,
		intervalMinutes:
			settings?.waterReminderIntervalMinutes ?? DEFAULT_WATER_REMINDER_INTERVAL_MINUTES,
		dailyGoal: settings?.waterReminderDailyGoal ?? DEFAULT_WATER_DAILY_GOAL,
	};
}

export function toHydrationStatsValue(params: {
	stats: HydrationStatsRecord;
	currentStreak: number;
	todayIntake: number;
	dailyGoal: number;
}): HydrationStatsValue {
	const { stats, currentStreak, todayIntake, dailyGoal } = params;

	return {
		currentStreak,
		longestStreak: stats.longestStreak,
		lastGoalMetDate: stats.lastGoalMetDate ? new Date(stats.lastGoalMetDate) : null,
		totalIntakeAllTime: stats.totalIntakeAllTime,
		snoozedUntil: stats.snoozedUntil ?? null,
		todayIntake,
		dailyGoal,
		goalProgress: calculateGoalProgress(todayIntake, dailyGoal),
	};
}

export function toDateOnlyString(date: Date | null) {
	return date?.toISOString().split("T")[0] ?? null;
}
