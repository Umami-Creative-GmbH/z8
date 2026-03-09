import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createDefaultHydrationStats, toDateOnlyString } from "./shared";

export function resetHydrationStreak(userId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		yield* _(
			dbService.query("resetStreak", async () => {
				await dbService.db
					.update(hydrationStats)
					.set({ currentStreak: 0 })
					.where(eq(hydrationStats.userId, userId));
			}),
		);
	});
}

export function createWaterIntakeLog(params: {
	userId: string;
	amount: number;
	source: typeof waterIntakeLog.$inferInsert.source;
}) {
	const { userId, amount, source } = params;

	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		yield* _(
			dbService.query("logWaterIntake", async () => {
				await dbService.db.insert(waterIntakeLog).values({
					userId,
					amount,
					source,
					loggedAt: new Date(),
				});
			}),
		);
	});
}

export function updateHydrationStatsAfterIntake(params: {
	userId: string;
	amount: number;
	currentStreak: number;
	longestStreak: number;
	lastGoalMetDate: Date | null;
}) {
	const { userId, amount, currentStreak, longestStreak, lastGoalMetDate } = params;

	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		yield* _(
			dbService.query("updateHydrationStats", async () => {
				await dbService.db
					.update(hydrationStats)
					.set({
						currentStreak,
						longestStreak,
						lastGoalMetDate: toDateOnlyString(lastGoalMetDate),
						totalIntakeAllTime: sql`${hydrationStats.totalIntakeAllTime} + ${amount}`,
					})
					.where(eq(hydrationStats.userId, userId));
			}),
		);
	});
}

export function snoozeWaterReminderForToday(userId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const snoozedUntil = DateTime.now().endOf("day").toJSDate();

		yield* _(
			dbService.query("snoozeReminder", async () => {
				await dbService.db
					.insert(hydrationStats)
					.values({
						...createDefaultHydrationStats(userId),
						snoozedUntil,
					})
					.onConflictDoUpdate({
						target: hydrationStats.userId,
						set: { snoozedUntil },
					});
			}),
		);

		return snoozedUntil;
	});
}

export function upsertWaterReminderSettings(params: {
	userId: string;
	enabled: boolean;
	preset: typeof userSettings.$inferInsert.waterReminderPreset;
	intervalMinutes: number;
	dailyGoal: number;
}) {
	const { userId, enabled, preset, intervalMinutes, dailyGoal } = params;

	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		yield* _(
			dbService.query("updateWaterReminderSettings", async () => {
				await dbService.db
					.insert(userSettings)
					.values({
						userId,
						waterReminderEnabled: enabled,
						waterReminderPreset: preset,
						waterReminderIntervalMinutes: intervalMinutes,
						waterReminderDailyGoal: dailyGoal,
					})
					.onConflictDoUpdate({
						target: userSettings.userId,
						set: {
							waterReminderEnabled: enabled,
							waterReminderPreset: preset,
							waterReminderIntervalMinutes: intervalMinutes,
							waterReminderDailyGoal: dailyGoal,
						},
					});
			}),
		);
	});
}
