"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { userSettings } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { writeUserSettings } from "@/lib/user-preferences/user-settings-mutation";
import {
	type WaterReminderSettings,
	waterReminderSettingsSchema,
} from "@/lib/validations/wellness";
import { getPresetInterval, type WaterReminderPreset } from "@/lib/wellness/water-presets";

/** The signed-in user's water reminder settings, for the settings page. */
export const getWellnessSettings = organizationAction(
	{ name: "wellness.getSettings", requires: "member", schema: noInput },
	({ actor }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const settings = yield* dbService.query("getWaterReminderSettings", () =>
				dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, actor.userId),
				}),
			);

			return {
				enabled: settings?.waterReminderEnabled ?? false,
				preset: (settings?.waterReminderPreset ?? "moderate") as WaterReminderPreset,
				intervalMinutes: settings?.waterReminderIntervalMinutes ?? 45,
				dailyGoal: settings?.waterReminderDailyGoal ?? 8,
			} satisfies WaterReminderSettings;
		}),
);

/** Updates the signed-in user's water reminder settings; a preset sets its own interval. */
export const updateWellnessSettings = organizationAction(
	{ name: "wellness.updateSettings", requires: "member", schema: waterReminderSettingsSchema },
	({ actor, input }) =>
		Effect.gen(function* () {
			const { enabled, preset, intervalMinutes, dailyGoal } = input;
			const actualInterval = preset === "custom" ? intervalMinutes : getPresetInterval(preset);

			const dbService = yield* DatabaseService;
			yield* dbService.query("updateWaterReminderSettings", () =>
				writeUserSettings(dbService.db, actor.userId, {
					waterReminderEnabled: enabled,
					waterReminderPreset: preset,
					waterReminderIntervalMinutes: actualInterval,
					waterReminderDailyGoal: dailyGoal,
				}),
			);
		}),
);
