"use server";

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	logWaterIntakeSchema,
	waterReminderSettingsSchema,
	type HydrationStats,
	type LogWaterIntakeFormValues,
	type WaterReminderSettings,
	type WaterReminderSettingsFormValues,
} from "@/lib/validations/wellness";
import { getPresetInterval, type WaterReminderPreset } from "@/lib/wellness/water-presets";
import { calculateStreakOnIntake, shouldResetStreak } from "@/lib/wellness/streak-calculator";

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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get user's water reminder settings from userSettings
		const settings = yield* _(
			dbService.query("getWaterReminderSettings", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			}),
		);

		// Get hydration stats for snooze state
		const stats = yield* _(
			dbService.query("getHydrationStats", async () => {
				return dbService.db.query.hydrationStats.findFirst({
					where: eq(hydrationStats.userId, session.user.id),
				});
			}),
		);

		// Get last intake time for today
		const todayStart = DateTime.now().startOf("day").toJSDate();
		const lastIntake = yield* _(
			dbService.query("getLastIntake", async () => {
				return dbService.db.query.waterIntakeLog.findFirst({
					where: and(
						eq(waterIntakeLog.userId, session.user.id),
						gte(waterIntakeLog.loggedAt, todayStart),
					),
					orderBy: (log, { desc }) => desc(log.loggedAt),
				});
			}),
		);

		return {
			enabled: settings?.waterReminderEnabled ?? false,
			intervalMinutes: settings?.waterReminderIntervalMinutes ?? 45,
			dailyGoal: settings?.waterReminderDailyGoal ?? 8,
			snoozedUntil: stats?.snoozedUntil ?? null,
			lastIntakeTime: lastIntake?.loggedAt ?? null,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get hydration stats for the current user
 */
export async function getHydrationStats(): Promise<ServerActionResult<HydrationStats>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get user's daily goal from userSettings
		const settings = yield* _(
			dbService.query("getUserDailyGoal", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			}),
		);
		const dailyGoal = settings?.waterReminderDailyGoal ?? 8;

		// Get or create hydration stats
		let stats = yield* _(
			dbService.query("getHydrationStats", async () => {
				return dbService.db.query.hydrationStats.findFirst({
					where: eq(hydrationStats.userId, session.user.id),
				});
			}),
		);

		// Create stats record if it doesn't exist
		if (!stats) {
			const [newStats] = yield* _(
				dbService.query("createHydrationStats", async () => {
					return dbService.db
						.insert(hydrationStats)
						.values({
							userId: session.user.id,
							currentStreak: 0,
							longestStreak: 0,
							totalIntakeAllTime: 0,
						})
						.returning();
				}),
			);
			stats = newStats;
		}

		// Check if streak should be reset (missed a day)
		let currentStreak = stats?.currentStreak ?? 0;
		if (
			stats?.lastGoalMetDate &&
			shouldResetStreak(new Date(stats.lastGoalMetDate), currentStreak)
		) {
			// Reset streak in database
			yield* _(
				dbService.query("resetStreak", async () => {
					await dbService.db
						.update(hydrationStats)
						.set({ currentStreak: 0 })
						.where(eq(hydrationStats.userId, session.user.id));
				}),
			);
			currentStreak = 0;
		}

		// Get today's intake
		const now = DateTime.now();
		const todayStart = now.startOf("day").toJSDate();
		const todayEnd = now.endOf("day").toJSDate();
		const todayIntakeResult = yield* _(
			dbService.query("getTodayIntake", async () => {
				return dbService.db
					.select({
						total: sql<number>`COALESCE(SUM(${waterIntakeLog.amount}), 0)::int`,
					})
					.from(waterIntakeLog)
					.where(
						and(
							eq(waterIntakeLog.userId, session.user.id),
							gte(waterIntakeLog.loggedAt, todayStart),
							lte(waterIntakeLog.loggedAt, todayEnd),
						),
					);
			}),
		);
		const todayIntake = todayIntakeResult[0]?.total ?? 0;
		const goalProgress = Math.min(100, Math.round((todayIntake / dailyGoal) * 100));

		return {
			currentStreak,
			longestStreak: stats?.longestStreak ?? 0,
			lastGoalMetDate: stats?.lastGoalMetDate ? new Date(stats.lastGoalMetDate) : null,
			totalIntakeAllTime: stats?.totalIntakeAllTime ?? 0,
			snoozedUntil: stats?.snoozedUntil ?? null,
			todayIntake,
			dailyGoal,
			goalProgress,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Log water intake
 */
export async function logWaterIntake(
	data: LogWaterIntakeFormValues,
): Promise<
	ServerActionResult<{
		todayIntake: number;
		goalProgress: number;
		currentStreak: number;
		longestStreak: number;
		goalJustMet: boolean;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Validate input
		const result = logWaterIntakeSchema.safeParse(data);
		if (!result.success) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: result.error.issues[0]?.message || "Invalid input",
						field: "amount",
					}),
				),
			);
		}

		const { amount, source } = result.data;

		// Get user's daily goal from userSettings
		const settings = yield* _(
			dbService.query("getUserDailyGoal", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			}),
		);
		const dailyGoal = settings?.waterReminderDailyGoal ?? 8;

		// Get current stats
		let stats = yield* _(
			dbService.query("getHydrationStats", async () => {
				return dbService.db.query.hydrationStats.findFirst({
					where: eq(hydrationStats.userId, session.user.id),
				});
			}),
		);

		// Create stats record if it doesn't exist
		if (!stats) {
			const [newStats] = yield* _(
				dbService.query("createHydrationStats", async () => {
					return dbService.db
						.insert(hydrationStats)
						.values({
							userId: session.user.id,
							currentStreak: 0,
							longestStreak: 0,
							totalIntakeAllTime: 0,
						})
						.returning();
				}),
			);
			stats = newStats;
		}

		// Get today's current intake
		const now = DateTime.now();
		const todayStart = now.startOf("day").toJSDate();
		const todayEnd = now.endOf("day").toJSDate();
		const todayIntakeResult = yield* _(
			dbService.query("getTodayIntake", async () => {
				return dbService.db
					.select({
						total: sql<number>`COALESCE(SUM(${waterIntakeLog.amount}), 0)::int`,
					})
					.from(waterIntakeLog)
					.where(
						and(
							eq(waterIntakeLog.userId, session.user.id),
							gte(waterIntakeLog.loggedAt, todayStart),
							lte(waterIntakeLog.loggedAt, todayEnd),
						),
					);
			}),
		);
		const currentTodayIntake = todayIntakeResult[0]?.total ?? 0;

		// Log the intake
		yield* _(
			dbService.query("logWaterIntake", async () => {
				await dbService.db.insert(waterIntakeLog).values({
					userId: session.user.id,
					amount,
					source,
					loggedAt: new Date(),
				});
			}),
		);

		// Calculate new streak
		const streakResult = calculateStreakOnIntake(
			{
				currentStreak: stats?.currentStreak ?? 0,
				longestStreak: stats?.longestStreak ?? 0,
				lastGoalMetDate: stats?.lastGoalMetDate ? new Date(stats.lastGoalMetDate) : null,
				todayIntake: currentTodayIntake,
				dailyGoal,
			},
			amount,
		);

		// Update stats
		yield* _(
			dbService.query("updateHydrationStats", async () => {
				await dbService.db
					.update(hydrationStats)
					.set({
						currentStreak: streakResult.newCurrentStreak,
						longestStreak: streakResult.newLongestStreak,
						lastGoalMetDate: streakResult.newLastGoalMetDate?.toISOString().split("T")[0] ?? null,
						totalIntakeAllTime: sql`${hydrationStats.totalIntakeAllTime} + ${amount}`,
					})
					.where(eq(hydrationStats.userId, session.user.id));
			}),
		);

		const newTodayIntake = currentTodayIntake + amount;
		const goalProgress = Math.min(100, Math.round((newTodayIntake / dailyGoal) * 100));

		return {
			todayIntake: newTodayIntake,
			goalProgress,
			currentStreak: streakResult.newCurrentStreak,
			longestStreak: streakResult.newLongestStreak,
			goalJustMet: streakResult.goalJustMet,
		};
	}).pipe(Effect.provide(AppLayer));

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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Snooze until end of today
		const snoozedUntil = DateTime.now().endOf("day").toJSDate();

		// Upsert hydration stats with snooze
		yield* _(
			dbService.query("snoozeReminder", async () => {
				await dbService.db
					.insert(hydrationStats)
					.values({
						userId: session.user.id,
						currentStreak: 0,
						longestStreak: 0,
						totalIntakeAllTime: 0,
						snoozedUntil,
					})
					.onConflictDoUpdate({
						target: hydrationStats.userId,
						set: { snoozedUntil },
					});
			}),
		);

		return { snoozedUntil };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update water reminder settings
 */
export async function updateWaterReminderSettings(
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

/**
 * Get water reminder settings for the current user
 */
export async function getWaterReminderSettings(): Promise<ServerActionResult<WaterReminderSettings>> {
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
