"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import type { DatabaseService } from "@/lib/effect/services/database.service";
import type {
	HydrationStats,
	LogWaterIntakeFormValues,
	WaterReminderSettings,
	WaterReminderSettingsFormValues,
} from "@/lib/validations/wellness";
import { calculateStreakOnIntake, shouldResetStreak } from "@/lib/wellness/streak-calculator";
import { getPresetInterval, type WaterReminderPreset } from "@/lib/wellness/water-presets";
import {
	createWaterIntakeLog,
	resetHydrationStreak,
	snoozeWaterReminderForToday,
	updateHydrationStatsAfterIntake,
	upsertWaterReminderSettings,
} from "./actions/mutations";
import {
	ensureHydrationStatsRecord,
	getHydrationStatsRecord,
	getLastWaterIntakeToday,
	getTodayWaterIntake,
	getUserWaterReminderSettings,
} from "./actions/queries";
import { toHydrationStatsValue, toWaterReminderSettings } from "./actions/shared";
import { validateLogWaterIntake, validateWaterReminderSettings } from "./actions/validation";

function buildWellnessActionEffect<T, E>(
	operation: (userId: string) => Effect.Effect<T, E, DatabaseService>,
) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		return yield* _(operation(session.user.id));
	}).pipe(Effect.provide(AppLayer));
}

/**
 * Get water reminder status for the current user
 */
export async function getWaterReminderStatus(): Promise<
	ServerActionResult<{
		enabled: boolean;
		intervalMinutes: number;
		dailyGoal: number;
		snoozedUntil: Date | null;
		lastIntakeTime: Date | null;
	}>
> {
	const effect = buildWellnessActionEffect((userId) =>
		Effect.gen(function* (_) {
			const [settings, stats, lastIntake] = yield* _(
				Effect.all([
					getUserWaterReminderSettings(userId),
					getHydrationStatsRecord(userId),
					getLastWaterIntakeToday(userId),
				]),
			);

			const reminderSettings = toWaterReminderSettings(settings);

			return {
				enabled: reminderSettings.enabled,
				intervalMinutes: reminderSettings.intervalMinutes,
				dailyGoal: reminderSettings.dailyGoal,
				snoozedUntil: stats?.snoozedUntil ?? null,
				lastIntakeTime: lastIntake?.loggedAt ?? null,
			};
		}),
	);

	return runServerActionSafe(effect);
}

/**
 * Get hydration stats for the current user
 */
export async function getHydrationStats(): Promise<ServerActionResult<HydrationStats>> {
	const effect = buildWellnessActionEffect((userId) =>
		Effect.gen(function* (_) {
			const [settings, statsRecord, todayIntake] = yield* _(
				Effect.all([
					getUserWaterReminderSettings(userId),
					ensureHydrationStatsRecord(userId),
					getTodayWaterIntake(userId),
				]),
			);

			let currentStreak = statsRecord.currentStreak;
			if (
				statsRecord.lastGoalMetDate &&
				shouldResetStreak(new Date(statsRecord.lastGoalMetDate), currentStreak)
			) {
				yield* _(resetHydrationStreak(userId));
				currentStreak = 0;
			}

			return toHydrationStatsValue({
				stats: statsRecord,
				currentStreak,
				todayIntake,
				dailyGoal: toWaterReminderSettings(settings).dailyGoal,
			});
		}),
	);

	return runServerActionSafe(effect);
}

/**
 * Log water intake
 */
export async function logWaterIntake(data: LogWaterIntakeFormValues): Promise<
	ServerActionResult<{
		todayIntake: number;
		goalProgress: number;
		currentStreak: number;
		longestStreak: number;
		goalJustMet: boolean;
	}>
> {
	const effect = buildWellnessActionEffect((userId) =>
		Effect.gen(function* (_) {
			const { amount, source } = yield* _(validateLogWaterIntake(data));
			const [settings, statsRecord, currentTodayIntake] = yield* _(
				Effect.all([
					getUserWaterReminderSettings(userId),
					ensureHydrationStatsRecord(userId),
					getTodayWaterIntake(userId),
				]),
			);

			const dailyGoal = toWaterReminderSettings(settings).dailyGoal;
			yield* _(createWaterIntakeLog({ userId, amount, source }));

			const streakResult = calculateStreakOnIntake(
				{
					currentStreak: statsRecord.currentStreak,
					longestStreak: statsRecord.longestStreak,
					lastGoalMetDate: statsRecord.lastGoalMetDate
						? new Date(statsRecord.lastGoalMetDate)
						: null,
					todayIntake: currentTodayIntake,
					dailyGoal,
				},
				amount,
			);

			yield* _(
				updateHydrationStatsAfterIntake({
					userId,
					amount,
					currentStreak: streakResult.newCurrentStreak,
					longestStreak: streakResult.newLongestStreak,
					lastGoalMetDate: streakResult.newLastGoalMetDate,
				}),
			);

			const newTodayIntake = currentTodayIntake + amount;

			return {
				todayIntake: newTodayIntake,
				goalProgress: toHydrationStatsValue({
					stats: statsRecord,
					currentStreak: streakResult.newCurrentStreak,
					todayIntake: newTodayIntake,
					dailyGoal,
				}).goalProgress,
				currentStreak: streakResult.newCurrentStreak,
				longestStreak: streakResult.newLongestStreak,
				goalJustMet: streakResult.goalJustMet,
			};
		}),
	);

	return runServerActionSafe(effect);
}

/**
 * Snooze water reminder for today
 */
export async function snoozeWaterReminder(): Promise<
	ServerActionResult<{
		snoozedUntil: Date;
	}>
> {
	const effect = buildWellnessActionEffect((userId) =>
		Effect.gen(function* (_) {
			const snoozedUntil = yield* _(snoozeWaterReminderForToday(userId));
			return { snoozedUntil };
		}),
	);

	return runServerActionSafe(effect);
}

/**
 * Update water reminder settings
 */
export async function updateWaterReminderSettings(
	data: WaterReminderSettingsFormValues,
): Promise<ServerActionResult<void>> {
	const effect = buildWellnessActionEffect((userId) =>
		Effect.gen(function* (_) {
			const { enabled, preset, intervalMinutes, dailyGoal } = yield* _(
				validateWaterReminderSettings(data),
			);

			yield* _(
				upsertWaterReminderSettings({
					userId,
					enabled,
					preset,
					intervalMinutes:
						preset === "custom"
							? intervalMinutes
							: getPresetInterval(preset as WaterReminderPreset),
					dailyGoal,
				}),
			);
		}),
	);

	return runServerActionSafe(effect);
}

/**
 * Get water reminder settings for the current user
 */
export async function getWaterReminderSettings(): Promise<
	ServerActionResult<WaterReminderSettings>
> {
	const effect = buildWellnessActionEffect((userId) =>
		Effect.gen(function* (_) {
			const settings = yield* _(getUserWaterReminderSettings(userId));
			return toWaterReminderSettings(settings);
		}),
	);

	return runServerActionSafe(effect);
}
