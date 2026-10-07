"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { userSettings } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { writeUserSettings } from "@/lib/user-preferences/user-settings-mutation";
import {
	type WaterReminderSettings,
	type WaterReminderSettingsFormValues,
	waterReminderSettingsSchema,
} from "@/lib/validations/wellness";
import { getPresetInterval, type WaterReminderPreset } from "@/lib/wellness/water-presets";

/**
 * Get water reminder settings for settings page
 */
export async function getWellnessSettings(): Promise<ServerActionResult<WaterReminderSettings>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		const settings = yield* dbService.query("getWaterReminderSettings", async () => {
			return dbService.db.query.userSettings.findFirst({
				where: eq(userSettings.userId, session.user.id),
			});
		});

		return {
			enabled: settings?.waterReminderEnabled ?? false,
			preset: (settings?.waterReminderPreset ?? "moderate") as WaterReminderPreset,
			intervalMinutes: settings?.waterReminderIntervalMinutes ?? 45,
			dailyGoal: settings?.waterReminderDailyGoal ?? 8,
		};
	});

	return runServerActionSafe(effect);
}

/**
 * Update water reminder settings
 */
export async function updateWellnessSettings(
	data: WaterReminderSettingsFormValues,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Validate input
		const result = waterReminderSettingsSchema.safeParse(data);
		if (!result.success) {
			return yield* Effect.fail(
				new ValidationError({
					message: result.error.issues[0]?.message || "Invalid settings",
					field: "settings",
				}),
			);
		}

		const { enabled, preset, intervalMinutes, dailyGoal } = result.data;

		// If preset is not custom, use preset interval
		const actualInterval =
			preset === "custom" ? intervalMinutes : getPresetInterval(preset as WaterReminderPreset);

		// Upsert userSettings with water reminder settings
		yield* dbService.query("updateWaterReminderSettings", () =>
			writeUserSettings(dbService.db, session.user.id, {
				waterReminderEnabled: enabled,
				waterReminderPreset: preset,
				waterReminderIntervalMinutes: actualInterval,
				waterReminderDailyGoal: dailyGoal,
			}),
		);
	});

	return runServerActionSafe(effect);
}
