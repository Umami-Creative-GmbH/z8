import { describe, expect, it } from "vitest";
import { useOrganizationSettings } from "./organization-settings-store";

describe("organization settings store", () => {
	it("defaults organization settings", () => {
		useOrganizationSettings.getState().reset();

		expect(useOrganizationSettings.getState().worksCouncilEnabled).toBe(false);
		expect(useOrganizationSettings.getState().timezone).toBe("UTC");
		expect(useOrganizationSettings.getState().isHydrated).toBe(false);
	});

	it("hydrates organization settings", () => {
		useOrganizationSettings.getState().hydrate({
			organizationId: "org_1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
			timezone: "UTC",
			deletedAt: null,
		});

		expect(useOrganizationSettings.getState().worksCouncilEnabled).toBe(true);
		expect(useOrganizationSettings.getState().timezone).toBe("UTC");
		expect(useOrganizationSettings.getState().isHydrated).toBe(true);
	});
});
