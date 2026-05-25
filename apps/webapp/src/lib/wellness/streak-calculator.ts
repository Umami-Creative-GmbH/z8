import { DateTime } from "luxon";

/**
 * Streak calculation logic for hydration tracking
 *
 * A streak increments when a user meets their daily water intake goal.
 * The streak resets if the user misses a day.
 */

function differenceInCalendarDays(laterDate: Date, earlierDate: Date): number {
	const later = DateTime.fromJSDate(laterDate, { zone: "utc" }).startOf("day");
	const earlier = DateTime.fromJSDate(earlierDate, { zone: "utc" }).startOf("day");
	return Math.floor(later.diff(earlier, "days").days);
}

function startOfDay(date: Date): Date {
	return DateTime.fromJSDate(date, { zone: "utc" }).startOf("day").toJSDate();
}

function toUtcDateKey(date: DateTime): string {
	return date.toFormat("yyyy-MM-dd");
}

function hasMissedRequiredGapDate(
	lastGoalMetDate: Date,
	today: Date,
	workdayRequirements?: WorkdayRequirementByDate,
): boolean {
	const daysSinceLastGoal = differenceInCalendarDays(today, lastGoalMetDate);

	if (workdayRequirements === undefined) {
		return daysSinceLastGoal > 1;
	}

	let gapDate = DateTime.fromJSDate(lastGoalMetDate, { zone: "utc" })
		.startOf("day")
		.plus({ days: 1 });
	const todayDate = DateTime.fromJSDate(today, { zone: "utc" }).startOf("day");

	while (gapDate < todayDate) {
		if ((workdayRequirements[toUtcDateKey(gapDate)] ?? 0) > 0) {
			return true;
		}
		gapDate = gapDate.plus({ days: 1 });
	}

	return false;
}

export type WorkdayRequirementByDate = Record<string, number>;

export interface WorkdayAwareStreakOptions {
	today?: Date;
	workdayRequirements?: WorkdayRequirementByDate;
}

export interface StreakCalculationInput extends WorkdayAwareStreakOptions {
	currentStreak: number;
	longestStreak: number;
	lastGoalMetDate: Date | null;
	todayIntake: number;
	dailyGoal: number;
}

export interface StreakCalculationResult {
	newCurrentStreak: number;
	newLongestStreak: number;
	newLastGoalMetDate: Date | null;
	goalJustMet: boolean; // true if this action caused the goal to be met
	streakBroken: boolean; // true if streak was reset
}

/**
 * Calculate updated streak values when water is logged
 *
 * @param input Current streak state and intake data
 * @param newAmount Amount of water being logged (glasses)
 * @returns Updated streak values
 */
export function calculateStreakOnIntake(
	input: StreakCalculationInput,
	newAmount: number,
): StreakCalculationResult {
	const { currentStreak, longestStreak, lastGoalMetDate, todayIntake, dailyGoal } = input;
	const today = startOfDay(input.today ?? new Date());

	// Check if goal was already met today
	const goalAlreadyMet = todayIntake >= dailyGoal;
	const newTotalToday = todayIntake + newAmount;
	const goalNowMet = newTotalToday >= dailyGoal;

	// If goal isn't met (yet), no streak update
	if (!goalNowMet) {
		return {
			newCurrentStreak: currentStreak,
			newLongestStreak: longestStreak,
			newLastGoalMetDate: lastGoalMetDate,
			goalJustMet: false,
			streakBroken: false,
		};
	}

	// Goal already met today - no changes needed
	if (goalAlreadyMet) {
		return {
			newCurrentStreak: currentStreak,
			newLongestStreak: longestStreak,
			newLastGoalMetDate: lastGoalMetDate,
			goalJustMet: false,
			streakBroken: false,
		};
	}

	// Goal just met! Calculate new streak
	let newStreak: number;
	let streakBroken = false;

	if (!lastGoalMetDate) {
		// First time meeting goal
		newStreak = 1;
	} else if (differenceInCalendarDays(today, lastGoalMetDate) === 0) {
		// Already counted today (shouldn't happen but handle gracefully)
		newStreak = currentStreak;
	} else if (!hasMissedRequiredGapDate(lastGoalMetDate, today, input.workdayRequirements)) {
		// Consecutive day - increment streak
		newStreak = currentStreak + 1;
	} else {
		// Streak broken - start fresh
		newStreak = 1;
		streakBroken = currentStreak > 0;
	}

	return {
		newCurrentStreak: newStreak,
		newLongestStreak: Math.max(longestStreak, newStreak),
		newLastGoalMetDate: today,
		goalJustMet: true,
		streakBroken,
	};
}

/**
 * Check if streak should be reset at the start of a new day
 * Call this when user clocks in or when loading hydration stats
 *
 * @param lastGoalMetDate Last date the user met their goal
 * @param currentStreak Current streak count
 * @returns Whether streak should be reset
 */
export function shouldResetStreak(
	lastGoalMetDate: Date | null,
	currentStreak: number,
	options: WorkdayAwareStreakOptions = {},
): boolean {
	if (!lastGoalMetDate || currentStreak === 0) {
		return false;
	}

	const today = startOfDay(options.today ?? new Date());

	return hasMissedRequiredGapDate(lastGoalMetDate, today, options.workdayRequirements);
}

/**
 * Format streak for display
 */
export function formatStreak(streak: number): string {
	if (streak === 0) {
		return "No streak yet";
	}
	if (streak === 1) {
		return "1 day";
	}
	return `${streak} days`;
}

/**
 * Get streak milestone message
 */
export function getStreakMilestone(streak: number): string | null {
	const milestones: Record<number, string> = {
		3: "3 days! Great start!",
		7: "1 week streak! Keep it up!",
		14: "2 weeks! You're doing amazing!",
		21: "3 weeks! Habit forming!",
		30: "1 month! Incredible dedication!",
		60: "2 months! Hydration champion!",
		90: "3 months! Wellness master!",
		100: "100 days! Legendary!",
		365: "1 year! Absolute legend!",
	};

	return milestones[streak] ?? null;
}
