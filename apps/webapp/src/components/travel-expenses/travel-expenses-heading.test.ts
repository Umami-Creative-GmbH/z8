import { describe, expect, it } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";

describe("R165 heading adoption", () => {
	it("hands only the personal workspace heading to the page", () => {
		expect(appPageOwnsHeading("/en/travel-expenses")).toBe(true);
		expect(appPageOwnsHeading("/de/travel-expenses/")).toBe(true);
		for (const path of [
			"/travel-expenses/finance",
			"/travel-expenses/reports/report",
		]) {
			expect(appPageOwnsHeading(path)).toBe(false);
		}
	});
});
