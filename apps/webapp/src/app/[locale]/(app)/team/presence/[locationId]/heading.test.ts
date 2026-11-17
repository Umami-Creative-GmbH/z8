import { expect, it } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";

it("owns the selected-location heading and retains adopted selector and team headings", () => {
	expect(appPageOwnsHeading("/en/team/presence/location-1")).toBe(true);
	expect(appPageOwnsHeading("/team/presence")).toBe(true);
	expect(appPageOwnsHeading("/en/team/presence/location-1/history")).toBe(false);
	expect(appPageOwnsHeading("/team")).toBe(true);
});
