import { describe, expect, it } from "vitest";
import { isOrganizationFeature } from "./organization-features";

describe("organization feature allowlist", () => {
	it("allows only supported organization feature flags", () => {
		expect(isOrganizationFeature("shiftsEnabled")).toBe(true);
		expect(isOrganizationFeature("projectsEnabled")).toBe(true);
		expect(isOrganizationFeature("surchargesEnabled")).toBe(true);
		expect(isOrganizationFeature("demoDataEnabled")).toBe(true);
		expect(isOrganizationFeature("worksCouncilEnabled")).toBe(true);
		expect(isOrganizationFeature("metadata")).toBe(false);
		expect(isOrganizationFeature("deletedAt")).toBe(false);
	});
});
