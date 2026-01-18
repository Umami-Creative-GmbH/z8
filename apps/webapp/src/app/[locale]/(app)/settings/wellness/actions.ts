"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { userSettings } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	waterReminderSettingsSchema,
	type WaterReminderSettings,
	type WaterReminderSettingsFormValues,
} from "@/lib/validations/wellness";
import { getPresetInterval, type WaterReminderPreset } from "@/lib/wellness/water-presets";

/**
 * Get water reminder settings for settings page
 */
export async function getWellnessSettings(): Promise<ServerActionResult<WaterReminderSettings>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const settings = yield* _(
			dbService.query("getWaterReminderSettings", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			}),
		);

		return {
			enabled: settings?.waterReminderEnabled ?? false,
			preset: (settings?.waterReminderPreset ?? "moderate") as WaterReminderPreset,
			intervalMinutes: settings?.waterReminderIntervalMinutes ?? 45,
			dailyGoal: settings?.waterReminderDailyGoal ?? 8,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update water reminder settings
 */
export async function updateWellnessSettings(
	data: WaterReminderSettingsFormValues,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Validate input
		const result = waterReminderSettingsSchema.safeParse(data);
		if (!result.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: result.error.issues[0]?.message || "Invalid settings",
						field: "settings",
					}),
				),
			);
		}

		const { enabled, preset, intervalMinutes, dailyGoal } = result.data;

		// If preset is not custom, use preset interval
		const actualInterval =
			preset === "custom" ? intervalMinutes : getPresetInterval(preset as WaterReminderPreset);

		// Upsert userSettings with water reminder settings
		yield* _(
			dbService.query("updateWaterReminderSettings", async () => {
				await dbService.db
					.insert(userSettings)
					.values({
						userId: session.user.id,
						waterReminderEnabled: enabled,
						waterReminderPreset: preset,
						waterReminderIntervalMinutes: actualInterval,
						waterReminderDailyGoal: dailyGoal,
					})
					.onConflictDoUpdate({
						target: userSettings.userId,
						set: {
							waterReminderEnabled: enabled,
							waterReminderPreset: preset,
							waterReminderIntervalMinutes: actualInterval,
							waterReminderDailyGoal: dailyGoal,
						},
					});
			}),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
