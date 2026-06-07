import { describe, expect, it } from "vitest";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { createHydrationTeamStreakLeadersCacheConfig } from "./hydration-team-streak-leaders-query";

describe("createHydrationTeamStreakLeadersCacheConfig", () => {
	it("sorts team ids in the cache key for stable cache entries", () => {
		const config = createHydrationTeamStreakLeadersCacheConfig({
			organizationId: "org-1",
			currentEmployeeId: "emp-1",
			teamIds: ["team-b", "team-a"],
		});

		expect(config.keyParts).toEqual([
			"hydration-team-streak-leaders",
			"org-1",
			"emp-1",
			"team-a",
			"team-b",
		]);
	});

	it("uses hydration, employee, and team tags scoped to the organization", () => {
		const config = createHydrationTeamStreakLeadersCacheConfig({
			organizationId: "org-1",
			currentEmployeeId: "emp-1",
			teamIds: ["team-a"],
		});

		expect(config.options).toEqual({
			revalidate: 60,
			tags: [
				CACHE_TAGS.HYDRATION_STREAKS("org-1"),
				CACHE_TAGS.EMPLOYEES("org-1"),
				CACHE_TAGS.TEAMS("org-1"),
			],
		});
	});
});
