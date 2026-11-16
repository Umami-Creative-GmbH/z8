import { expect, it } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";

it("owns exactly the selected-location heading without adopting the selector or descendants", () => {
	expect(appPageOwnsHeading("/en/team/presence/location-1")).toBe(true);
	expect(appPageOwnsHeading("/team/presence")).toBe(false);
	expect(appPageOwnsHeading("/en/team/presence/location-1/history")).toBe(false);
	expect(appPageOwnsHeading("/team")).toBe(false);
});
