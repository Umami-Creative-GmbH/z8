import { describe, expect, it } from "vitest";
import { shortTermMonitorQueryKey, shortTermReviewsQueryKey } from "./short-term-query-keys";

describe("short-term monitor cache (#1990)", () => {
	it("never shares a cached monitor between organizations", () => {
		expect(shortTermMonitorQueryKey("org-a", "employee-1", 2026)).not.toEqual(
			shortTermMonitorQueryKey("org-b", "employee-1", 2026),
		);
		expect(shortTermMonitorQueryKey("org-a", "employee-1", null)).not.toEqual(
			shortTermMonitorQueryKey("org-b", "employee-1", null),
		);
	});

	it("invalidates every year of one employee in one organization with its prefix", () => {
		const prefix = shortTermMonitorQueryKey("org-a", "employee-1");
		for (const year of [null, 2025, 2026]) {
			expect(shortTermMonitorQueryKey("org-a", "employee-1", year).slice(0, prefix.length)).toEqual(
				prefix,
			);
		}
		expect(prefix).toContain("org-a");
		expect(
			shortTermMonitorQueryKey("org-b", "employee-1", 2026).slice(0, prefix.length),
		).not.toEqual(prefix);
	});
});

describe("short-term Berufsmäßigkeit reviews cache (#1990)", () => {
	it("never shares cached EUR reviews between organizations", () => {
		expect(shortTermReviewsQueryKey("org-a", false)).not.toEqual(
			shortTermReviewsQueryKey("org-b", false),
		);
	});

	it("invalidates both views of one organization with its prefix", () => {
		const prefix = shortTermReviewsQueryKey("org-a");
		for (const includeResolved of [false, true]) {
			expect(shortTermReviewsQueryKey("org-a", includeResolved).slice(0, prefix.length)).toEqual(
				prefix,
			);
		}
		expect(prefix).toContain("org-a");
	});
});
