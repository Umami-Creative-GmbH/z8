import { describe, expect, it } from "vitest";
import { buildTeamStreakLeaders, collectUniqueTeamIds } from "./hydration-team-streak-leaders";

describe("collectUniqueTeamIds", () => {
	it("combines primary and membership team ids without duplicates", () => {
		expect(
			collectUniqueTeamIds("team-a", [
				{ teamId: "team-a" },
				{ teamId: "team-b" },
				{ teamId: "team-b" },
			]),
		).toEqual(["team-a", "team-b"]);
	});

	it("ignores null primary team ids", () => {
		expect(collectUniqueTeamIds(null, [{ teamId: "team-b" }])).toEqual(["team-b"]);
	});
});

describe("buildTeamStreakLeaders", () => {
	it("deduplicates employees shared through multiple teams before limiting to the top three", () => {
		const leaders = buildTeamStreakLeaders(
			[
				{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 4 },
				{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 4 },
				{ employeeId: "emp-2", userId: "user-2", displayName: "Blair", currentStreak: 8 },
				{ employeeId: "emp-3", userId: "user-3", displayName: "Casey", currentStreak: 6 },
				{ employeeId: "emp-4", userId: "user-4", displayName: "Devon", currentStreak: 2 },
			],
			"user-1",
		);

		expect(leaders).toEqual([
			{ employeeId: "emp-2", displayName: "Blair", currentStreak: 8, isCurrentUser: false },
			{ employeeId: "emp-3", displayName: "Casey", currentStreak: 6, isCurrentUser: false },
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 4, isCurrentUser: true },
		]);
	});

	it("treats missing hydration stats as a zero streak", () => {
		expect(
			buildTeamStreakLeaders(
				[{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: null }],
				"user-2",
			),
		).toEqual([
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 0, isCurrentUser: false },
		]);
	});

	it("sorts ties by display name for stable output", () => {
		expect(
			buildTeamStreakLeaders(
				[
					{ employeeId: "emp-2", userId: "user-2", displayName: "Blair", currentStreak: 3 },
					{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 3 },
				],
				"user-1",
			),
		).toEqual([
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 3, isCurrentUser: true },
			{ employeeId: "emp-2", displayName: "Blair", currentStreak: 3, isCurrentUser: false },
		]);
	});

	it("uses a configurable limit after sorting leaders", () => {
		const leaders = buildTeamStreakLeaders(
			[
				{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 4 },
				{ employeeId: "emp-2", userId: "user-2", displayName: "Blair", currentStreak: 9 },
				{ employeeId: "emp-3", userId: "user-3", displayName: "Casey", currentStreak: 6 },
				{ employeeId: "emp-4", userId: "user-4", displayName: "Devon", currentStreak: 2 },
				{ employeeId: "emp-5", userId: "user-5", displayName: "Emery", currentStreak: 7 },
				{ employeeId: "emp-6", userId: "user-6", displayName: "Finley", currentStreak: 5 },
			],
			"user-1",
			{ limit: 5, minimumParticipants: 2 },
		);

		expect(leaders).toEqual([
			{ employeeId: "emp-2", displayName: "Blair", currentStreak: 9, isCurrentUser: false },
			{ employeeId: "emp-5", displayName: "Emery", currentStreak: 7, isCurrentUser: false },
			{ employeeId: "emp-3", displayName: "Casey", currentStreak: 6, isCurrentUser: false },
			{ employeeId: "emp-6", displayName: "Finley", currentStreak: 5, isCurrentUser: false },
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 4, isCurrentUser: true },
		]);
	});

	it("returns no leaders when unique candidates are below the minimum participants", () => {
		expect(
			buildTeamStreakLeaders(
				[{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 4 }],
				"user-1",
				{ limit: 5, minimumParticipants: 2 },
			),
		).toEqual([]);
	});
});
