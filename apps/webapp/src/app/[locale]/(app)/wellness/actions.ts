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
import { getPresetInterval, type WaterReminderPreset } from "@/lib/wellness/water-presets";
import {
	buildGetHydrationStatsEffect,
	buildLogWaterIntakeEffect,
	type WellnessActionContext,
} from "./actions/effects";
import { snoozeWaterReminderForToday, upsertWaterReminderSettings } from "./actions/mutations";
import {
	getHydrationStatsRecord,
	getLastWaterIntakeToday,
	getUserWaterReminderSettings,
} from "./actions/queries";
import { toWaterReminderSettings } from "./actions/shared";
import { validateWaterReminderSettings } from "./actions/validation";

function buildWellnessActionEffect<T, E>(
	operation: (context: WellnessActionContext) => Effect.Effect<T, E, DatabaseService>,
) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();

		return yield* operation({
			userId: session.user.id,
			activeOrganizationId: session.session?.activeOrganizationId ?? null,
		});
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
	const effect = buildWellnessActionEffect(({ userId }) =>
		Effect.gen(function* () {
			const [settings, stats, lastIntake] = yield* Effect.all([
				getUserWaterReminderSettings(userId),
				getHydrationStatsRecord(userId),
				getLastWaterIntakeToday(userId),
			]);

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
	const effect = buildWellnessActionEffect(buildGetHydrationStatsEffect);

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
	const effect = buildWellnessActionEffect((context) => buildLogWaterIntakeEffect(context, data));

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
	const effect = buildWellnessActionEffect(({ userId }) =>
		Effect.gen(function* () {
			const snoozedUntil = yield* snoozeWaterReminderForToday(userId);
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
	const effect = buildWellnessActionEffect(({ userId }) =>
		Effect.gen(function* () {
			const { enabled, preset, intervalMinutes, dailyGoal } =
				yield* validateWaterReminderSettings(data);

			yield* upsertWaterReminderSettings({
				userId,
				enabled,
				preset,
				intervalMinutes:
					preset === "custom" ? intervalMinutes : getPresetInterval(preset as WaterReminderPreset),
				dailyGoal,
			});
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
	const effect = buildWellnessActionEffect(({ userId }) =>
		Effect.gen(function* () {
			const settings = yield* getUserWaterReminderSettings(userId);
			return toWaterReminderSettings(settings);
		}),
	);

	return runServerActionSafe(effect);
}
