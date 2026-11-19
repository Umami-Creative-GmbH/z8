import { describe, expect, it } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";

describe("R165 heading adoption", () => {
	it("hands only the personal workspace heading to the page", () => {
		expect(appPageOwnsHeading("/en/travel-expenses")).toBe(true);
		expect(appPageOwnsHeading("/de/travel-expenses/")).toBe(true);
		expect(appPageOwnsHeading("/travel-expenses/finance")).toBe(true);
		for (const path of ["/travel-expenses/reports/report", "/travel-expenses/finance/extra", "/travel-expenses/not-a-claim"]) {
			expect(appPageOwnsHeading(path)).toBe(false);
		}
	});
});
