/**
 * Water reminder presets configuration
 *
 * Provides predefined interval settings for hydration reminders.
 * Users can choose from these presets or set a custom interval.
 */

export type WaterReminderPreset = "light" | "moderate" | "active" | "custom";

export interface WaterPresetConfig {
	id: WaterReminderPreset;
	intervalMinutes: number;
	label: string;
	description: string;
	recommended?: boolean;
}

/**
 * Preset definitions for water reminder intervals
 *
 * | Preset   | Interval | Use Case                            |
 * |----------|----------|-------------------------------------|
 * | Light    | 60 min   | Low activity, sedentary work        |
 * | Moderate | 45 min   | Recommended for most office workers |
 * | Active   | 30 min   | High activity, hot environments     |
 * | Custom   | variable | User-defined (15-120 min range)     |
 */
export const WATER_PRESETS: Record<WaterReminderPreset, WaterPresetConfig> = {
	light: {
		id: "light",
		intervalMinutes: 60,
		label: "Light",
		description: "Every 60 minutes - for low activity",
	},
	moderate: {
		id: "moderate",
		intervalMinutes: 45,
		label: "Moderate",
		description: "Every 45 minutes - recommended for most people",
		recommended: true,
	},
	active: {
		id: "active",
		intervalMinutes: 30,
		label: "Active",
		description: "Every 30 minutes - for high activity or hot environments",
	},
	custom: {
		id: "custom",
		intervalMinutes: 45, // Default when switching to custom
		label: "Custom",
		description: "Set your own interval (15-120 minutes)",
	},
};

/**
 * Get the interval for a preset
 */
export function getPresetInterval(preset: WaterReminderPreset): number {
	return WATER_PRESETS[preset].intervalMinutes;
}

/**
 * Get all presets as an array (for select dropdowns)
 */
export function getPresetOptions(): WaterPresetConfig[] {
	return Object.values(WATER_PRESETS);
}

/**
 * Validate custom interval range
 */
export const CUSTOM_INTERVAL_RANGE = {
	min: 15,
	max: 120,
} as const;

/**
 * Daily goal range
 */
export const DAILY_GOAL_RANGE = {
	min: 1,
	max: 20,
	default: 8,
} as const;

/**
 * Default water reminder settings
 */
export const DEFAULT_WATER_REMINDER_SETTINGS = {
	enabled: false,
	preset: "moderate" as WaterReminderPreset,
	intervalMinutes: WATER_PRESETS.moderate.intervalMinutes,
	dailyGoal: DAILY_GOAL_RANGE.default,
} as const;
