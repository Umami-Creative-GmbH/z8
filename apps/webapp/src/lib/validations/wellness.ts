import { z } from "zod";
import {
	CUSTOM_INTERVAL_RANGE,
	DAILY_GOAL_RANGE,
	type WaterReminderPreset,
} from "@/lib/wellness/water-presets";

/**
 * Schema for water reminder settings form
 */
export const waterReminderSettingsSchema = z
	.object({
		enabled: z.boolean().default(false),
		preset: z.enum(["light", "moderate", "active", "custom"] as const).default("moderate"),
		intervalMinutes: z
			.number()
			.min(CUSTOM_INTERVAL_RANGE.min, `Minimum interval is ${CUSTOM_INTERVAL_RANGE.min} minutes`)
			.max(CUSTOM_INTERVAL_RANGE.max, `Maximum interval is ${CUSTOM_INTERVAL_RANGE.max} minutes`)
			.default(45),
		dailyGoal: z
			.number()
			.min(DAILY_GOAL_RANGE.min, `Minimum goal is ${DAILY_GOAL_RANGE.min} glass`)
			.max(DAILY_GOAL_RANGE.max, `Maximum goal is ${DAILY_GOAL_RANGE.max} glasses`)
			.default(DAILY_GOAL_RANGE.default),
	})
	.refine(
		(data) => {
			// When preset is not custom, interval should match preset interval
			if (data.preset !== "custom") {
				return true; // interval is derived from preset on the server
			}
			return (
				data.intervalMinutes >= CUSTOM_INTERVAL_RANGE.min &&
				data.intervalMinutes <= CUSTOM_INTERVAL_RANGE.max
			);
		},
		{
			message: `Custom interval must be between ${CUSTOM_INTERVAL_RANGE.min} and ${CUSTOM_INTERVAL_RANGE.max} minutes`,
			path: ["intervalMinutes"],
		},
	);

export type WaterReminderSettingsFormValues = z.infer<typeof waterReminderSettingsSchema>;

/**
 * Schema for onboarding wellness step
 */
export const onboardingWellnessSchema = z.object({
	enableWaterReminder: z.boolean().default(false),
	waterReminderPreset: z
		.enum(["light", "moderate", "active", "custom"] as const)
		.default("moderate"),
	waterReminderIntervalMinutes: z
		.number()
		.min(CUSTOM_INTERVAL_RANGE.min)
		.max(CUSTOM_INTERVAL_RANGE.max)
		.default(45),
	waterReminderDailyGoal: z
		.number()
		.min(DAILY_GOAL_RANGE.min)
		.max(DAILY_GOAL_RANGE.max)
		.default(DAILY_GOAL_RANGE.default),
});

export type OnboardingWellnessFormValues = z.infer<typeof onboardingWellnessSchema>;

/**
 * Schema for logging water intake
 */
export const logWaterIntakeSchema = z.object({
	amount: z.number().min(1).max(10).default(1),
	source: z.enum(["reminder_action", "manual", "widget"] as const),
});

export type LogWaterIntakeFormValues = z.infer<typeof logWaterIntakeSchema>;

/**
 * Type for hydration stats returned from the server
 */
export interface HydrationStats {
	currentStreak: number;
	longestStreak: number;
	lastGoalMetDate: Date | null;
	totalIntakeAllTime: number;
	snoozedUntil: Date | null;
	todayIntake: number;
	dailyGoal: number;
	goalProgress: number; // percentage 0-100
}

/**
 * Type for water reminder settings from user record
 */
export interface WaterReminderSettings {
	enabled: boolean;
	preset: WaterReminderPreset;
	intervalMinutes: number;
	dailyGoal: number;
}
