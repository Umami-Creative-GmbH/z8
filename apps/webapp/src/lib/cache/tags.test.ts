import { describe, expect, it } from "vitest";
import { CACHE_TAGS } from "./tags";

describe("CACHE_TAGS", () => {
	it("scopes hydration streak leaderboard data by organization", () => {
		expect(CACHE_TAGS.HYDRATION_STREAKS("org-1")).toBe("hydration-streaks:org-1");
	});
});
