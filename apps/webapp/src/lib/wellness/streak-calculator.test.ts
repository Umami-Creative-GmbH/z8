import { describe, expect, it } from "vitest";
import {
	calculateStreakOnIntake,
	shouldResetStreak,
	type WorkdayRequirementByDate,
} from "./streak-calculator";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("hydration streak workday awareness", () => {
	it("increments across a weekend with no required workdays", () => {
		const result = calculateStreakOnIntake(
			{
				currentStreak: 5,
				longestStreak: 5,
				lastGoalMetDate: date("2026-05-22"),
				today: date("2026-05-25"),
				todayIntake: 7,
				dailyGoal: 8,
				workdayRequirements: {},
			},
			1,
		);

		expect(result).toMatchObject({
			newCurrentStreak: 6,
			newLongestStreak: 6,
			goalJustMet: true,
			streakBroken: false,
		});
		expect(result.newLastGoalMetDate?.toISOString().slice(0, 10)).toBe("2026-05-25");
	});

	it("resets when a required workday was missed", () => {
		const workdayRequirements: WorkdayRequirementByDate = {
			"2026-05-23": 480,
		};

		const result = calculateStreakOnIntake(
			{
				currentStreak: 5,
				longestStreak: 7,
				lastGoalMetDate: date("2026-05-22"),
				today: date("2026-05-25"),
				todayIntake: 7,
				dailyGoal: 8,
				workdayRequirements,
			},
			1,
		);

		expect(result).toMatchObject({
			newCurrentStreak: 1,
			newLongestStreak: 7,
			goalJustMet: true,
			streakBroken: true,
		});
	});

	it("preserves streak across holiday and absence dates with zero requirements", () => {
		const workdayRequirements: WorkdayRequirementByDate = {
			"2026-05-23": 0,
			"2026-05-24": 0,
		};

		const result = calculateStreakOnIntake(
			{
				currentStreak: 2,
				longestStreak: 4,
				lastGoalMetDate: date("2026-05-22"),
				today: date("2026-05-25"),
				todayIntake: 7,
				dailyGoal: 8,
				workdayRequirements,
			},
			1,
		);

		expect(result).toMatchObject({
			newCurrentStreak: 3,
			newLongestStreak: 4,
			goalJustMet: true,
			streakBroken: false,
		});
	});

	it("does not reset on stats load when only non-workdays were skipped", () => {
		expect(
			shouldResetStreak(date("2026-05-22"), 3, {
				today: date("2026-05-25"),
				workdayRequirements: {},
			}),
		).toBe(false);
	});

	it("resets on stats load when a required workday was skipped", () => {
		expect(
			shouldResetStreak(date("2026-05-22"), 3, {
				today: date("2026-05-25"),
				workdayRequirements: { "2026-05-23": 480 },
			}),
		).toBe(true);
	});
});
