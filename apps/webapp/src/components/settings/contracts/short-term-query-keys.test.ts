import { describe, expect, it } from "vitest";
import { shortTermReviewsQueryKey } from "./short-term-query-keys";

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
