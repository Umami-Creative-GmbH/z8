import { DateTime } from "luxon";

/**
 * Streak calculation logic for hydration tracking
 *
 * A streak increments when a user meets their daily water intake goal.
 * The streak resets if the user misses a day.
 */

// Luxon helper functions (replacing date-fns)
function isToday(date: Date): boolean {
	return DateTime.fromJSDate(date).hasSame(DateTime.now(), "day");
}

function isYesterday(date: Date): boolean {
	return DateTime.fromJSDate(date).hasSame(DateTime.now().minus({ days: 1 }), "day");
}

function differenceInCalendarDays(laterDate: Date, earlierDate: Date): number {
	const later = DateTime.fromJSDate(laterDate).startOf("day");
	const earlier = DateTime.fromJSDate(earlierDate).startOf("day");
	return Math.floor(later.diff(earlier, "days").days);
}

function startOfDay(date: Date): Date {
	return DateTime.fromJSDate(date).startOf("day").toJSDate();
}

export interface StreakCalculationInput {
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
	const now = DateTime.now();
	const today = now.startOf("day").toJSDate();

	// Check if goal was already met today
	const goalAlreadyMet = todayIntake >= dailyGoal;
	const newTotalToday = todayIntake + newAmount;
	const goalNowMet = newTotalToday >= dailyGoal;
	const goalJustMet = !goalAlreadyMet && goalNowMet;

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
	} else if (isToday(lastGoalMetDate)) {
		// Already counted today (shouldn't happen but handle gracefully)
		newStreak = currentStreak;
	} else if (isYesterday(lastGoalMetDate)) {
		// Consecutive day - increment streak
		newStreak = currentStreak + 1;
	} else {
		// Gap in days - streak resets
		const daysSinceLastGoal = differenceInCalendarDays(today, lastGoalMetDate);
		if (daysSinceLastGoal === 1) {
			newStreak = currentStreak + 1;
		} else {
			// Streak broken - start fresh
			newStreak = 1;
			streakBroken = currentStreak > 0;
		}
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
export function shouldResetStreak(lastGoalMetDate: Date | null, currentStreak: number): boolean {
	if (!lastGoalMetDate || currentStreak === 0) {
		return false;
	}

	const today = startOfDay(new Date());
	const daysSince = differenceInCalendarDays(today, lastGoalMetDate);

	// If more than 1 day has passed without meeting goal, streak should reset
	return daysSince > 1;
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
