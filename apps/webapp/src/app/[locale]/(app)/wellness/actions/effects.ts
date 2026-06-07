import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import type { LogWaterIntakeFormValues } from "@/lib/validations/wellness";
import { calculateStreakOnIntake, shouldResetStreak } from "@/lib/wellness/streak-calculator";
import { createWaterIntakeLog, resetHydrationStreak, updateHydrationStatsAfterIntake } from "./mutations";
import {
	ensureHydrationStatsRecord,
	getActiveEmployeeForHydration,
	getHydrationStreakWorkdayRequirements,
	getTodayWaterIntake,
	getUserWaterReminderSettings,
} from "./queries";
import { toHydrationStatsValue, toWaterReminderSettings } from "./shared";
import { validateLogWaterIntake } from "./validation";

export type WellnessActionContext = {
	userId: string;
	activeOrganizationId: string | null;
};

export function revalidateHydrationStreaksCache(activeOrganizationId: string | null | undefined) {
	if (activeOrganizationId) {
		revalidateTag(CACHE_TAGS.HYDRATION_STREAKS(activeOrganizationId), "max");
	}
}

export function buildGetHydrationStatsEffect({
	userId,
	activeOrganizationId,
}: WellnessActionContext) {
	return Effect.gen(function* (_) {
		const [settings, statsRecord, todayIntake, activeEmployee] = yield* _(
			Effect.all([
				getUserWaterReminderSettings(userId),
				ensureHydrationStatsRecord(userId),
				getTodayWaterIntake(userId),
				getActiveEmployeeForHydration(userId, activeOrganizationId),
			]),
		);

		const lastGoalMetDate = statsRecord.lastGoalMetDate
			? new Date(statsRecord.lastGoalMetDate)
			: null;
		const workdayRequirements = yield* _(
			getHydrationStreakWorkdayRequirements({
				organizationId: activeOrganizationId,
				employeeId: activeEmployee?.id ?? null,
				lastGoalMetDate,
			}),
		);

		let currentStreak = statsRecord.currentStreak;
		if (
			lastGoalMetDate &&
			shouldResetStreak(lastGoalMetDate, currentStreak, { workdayRequirements })
		) {
			yield* _(resetHydrationStreak(userId));
			revalidateHydrationStreaksCache(activeOrganizationId);
			currentStreak = 0;
		}

		return toHydrationStatsValue({
			stats: statsRecord,
			currentStreak,
			todayIntake,
			dailyGoal: toWaterReminderSettings(settings).dailyGoal,
		});
	});
}

export function buildLogWaterIntakeEffect(
	{ userId, activeOrganizationId }: WellnessActionContext,
	data: LogWaterIntakeFormValues,
) {
	return Effect.gen(function* (_) {
		const { amount, source } = yield* _(validateLogWaterIntake(data));
		const [settings, statsRecord, currentTodayIntake, activeEmployee] = yield* _(
			Effect.all([
				getUserWaterReminderSettings(userId),
				ensureHydrationStatsRecord(userId),
				getTodayWaterIntake(userId),
				getActiveEmployeeForHydration(userId, activeOrganizationId),
			]),
		);

		const lastGoalMetDate = statsRecord.lastGoalMetDate
			? new Date(statsRecord.lastGoalMetDate)
			: null;
		const workdayRequirements = yield* _(
			getHydrationStreakWorkdayRequirements({
				organizationId: activeOrganizationId,
				employeeId: activeEmployee?.id ?? null,
				lastGoalMetDate,
			}),
		);

		const dailyGoal = toWaterReminderSettings(settings).dailyGoal;
		yield* _(createWaterIntakeLog({ userId, amount, source }));

		const streakResult = calculateStreakOnIntake(
			{
				currentStreak: statsRecord.currentStreak,
				longestStreak: statsRecord.longestStreak,
				lastGoalMetDate,
				workdayRequirements,
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

		revalidateHydrationStreaksCache(activeOrganizationId);

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
	});
}
