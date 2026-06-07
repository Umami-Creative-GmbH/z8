import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_TAGS } from "@/lib/cache/tags";
import {
	buildGetHydrationStatsEffect,
	buildLogWaterIntakeEffect,
	revalidateHydrationStreaksCache,
} from "./actions/effects";

const mocks = vi.hoisted(() => ({
	revalidateTag: vi.fn(),
	getUserWaterReminderSettings: vi.fn(),
	ensureHydrationStatsRecord: vi.fn(),
	getTodayWaterIntake: vi.fn(),
	getActiveEmployeeForHydration: vi.fn(),
	getHydrationStreakWorkdayRequirements: vi.fn(),
	createWaterIntakeLog: vi.fn(),
	updateHydrationStatsAfterIntake: vi.fn(),
	resetHydrationStreak: vi.fn(),
	calculateStreakOnIntake: vi.fn(),
	shouldResetStreak: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidateTag: mocks.revalidateTag,
	unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/wellness/streak-calculator", () => ({
	calculateStreakOnIntake: mocks.calculateStreakOnIntake,
	shouldResetStreak: mocks.shouldResetStreak,
}));

vi.mock("./actions/queries", async () => {
	const { Effect } = await import("effect");

	return {
		getUserWaterReminderSettings: (...args: unknown[]) =>
			Effect.sync(() => mocks.getUserWaterReminderSettings(...args)),
		ensureHydrationStatsRecord: (...args: unknown[]) =>
			Effect.sync(() => mocks.ensureHydrationStatsRecord(...args)),
		getTodayWaterIntake: (...args: unknown[]) =>
			Effect.sync(() => mocks.getTodayWaterIntake(...args)),
		getActiveEmployeeForHydration: (...args: unknown[]) =>
			Effect.sync(() => mocks.getActiveEmployeeForHydration(...args)),
		getHydrationStreakWorkdayRequirements: (...args: unknown[]) =>
			Effect.sync(() => mocks.getHydrationStreakWorkdayRequirements(...args)),
		getHydrationStatsRecord: vi.fn(),
		getLastWaterIntakeToday: vi.fn(),
	};
});

vi.mock("./actions/mutations", async () => {
	const { Effect } = await import("effect");

	return {
		createWaterIntakeLog: (...args: unknown[]) =>
			Effect.sync(() => mocks.createWaterIntakeLog(...args)),
		updateHydrationStatsAfterIntake: (...args: unknown[]) =>
			Effect.sync(() => mocks.updateHydrationStatsAfterIntake(...args)),
		resetHydrationStreak: (...args: unknown[]) =>
			Effect.sync(() => mocks.resetHydrationStreak(...args)),
		snoozeWaterReminderForToday: vi.fn(),
		upsertWaterReminderSettings: vi.fn(),
	};
});

function seedHydrationActionMocks() {
	mocks.getUserWaterReminderSettings.mockReturnValue({ waterReminderDailyGoal: 8 });
	mocks.ensureHydrationStatsRecord.mockReturnValue({
		currentStreak: 3,
		longestStreak: 5,
		lastGoalMetDate: new Date("2024-01-01T00:00:00.000Z"),
		totalIntakeAllTime: 20,
		snoozedUntil: null,
	});
	mocks.getTodayWaterIntake.mockReturnValue(7);
	mocks.getActiveEmployeeForHydration.mockReturnValue({ id: "employee-1" });
	mocks.getHydrationStreakWorkdayRequirements.mockReturnValue([]);
	mocks.calculateStreakOnIntake.mockReturnValue({
		newCurrentStreak: 4,
		newLongestStreak: 5,
		newLastGoalMetDate: new Date("2024-01-02T00:00:00.000Z"),
		goalJustMet: true,
	});
	mocks.shouldResetStreak.mockReturnValue(true);
}

describe("wellness action cache invalidation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seedHydrationActionMocks();
	});

	it("revalidates hydration streak leaders for the active organization", () => {
		revalidateHydrationStreaksCache("org-1");

		expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith(
			CACHE_TAGS.HYDRATION_STREAKS("org-1"),
			"max",
		);
	});

	it.each([null, undefined, ""])("does not revalidate without an organization id", (orgId) => {
		revalidateHydrationStreaksCache(orgId);

		expect(mocks.revalidateTag).not.toHaveBeenCalled();
	});

	it("revalidates after water intake stats update when an active organization is present", async () => {
		await Effect.runPromise(
			buildLogWaterIntakeEffect(
				{ userId: "user-1", activeOrganizationId: "org-1" },
				{ amount: 2, source: "manual" },
			),
		);

		expect(mocks.updateHydrationStatsAfterIntake).toHaveBeenCalledOnce();
		expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith(
			CACHE_TAGS.HYDRATION_STREAKS("org-1"),
			"max",
		);
		expect(mocks.revalidateTag.mock.invocationCallOrder[0]).toBeGreaterThan(
			mocks.updateHydrationStatsAfterIntake.mock.invocationCallOrder[0],
		);
	});

	it("revalidates after lazy streak reset when an active organization is present", async () => {
		await Effect.runPromise(
			buildGetHydrationStatsEffect({ userId: "user-1", activeOrganizationId: "org-1" }),
		);

		expect(mocks.resetHydrationStreak).toHaveBeenCalledOnce();
		expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith(
			CACHE_TAGS.HYDRATION_STREAKS("org-1"),
			"max",
		);
		expect(mocks.revalidateTag.mock.invocationCallOrder[0]).toBeGreaterThan(
			mocks.resetHydrationStreak.mock.invocationCallOrder[0],
		);
	});

	it("does not revalidate action paths when the active organization is missing", async () => {
		await Effect.runPromise(
			buildLogWaterIntakeEffect(
				{ userId: "user-1", activeOrganizationId: null },
				{ amount: 2, source: "manual" },
			),
		);
		await Effect.runPromise(
			buildGetHydrationStatsEffect({ userId: "user-1", activeOrganizationId: null }),
		);

		expect(mocks.updateHydrationStatsAfterIntake).toHaveBeenCalledOnce();
		expect(mocks.resetHydrationStreak).toHaveBeenCalledOnce();
		expect(mocks.revalidateTag).not.toHaveBeenCalled();
	});
});
