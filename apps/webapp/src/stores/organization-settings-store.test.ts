import { describe, expect, it } from "vitest";
import { useOrganizationSettings } from "./organization-settings-store";

describe("organization settings store", () => {
	it("defaults fiscal year start month to January", () => {
		useOrganizationSettings.getState().reset();

		expect(useOrganizationSettings.getState().fiscalYearStartMonth).toBe(1);
	});

	it("hydrates fiscal year start month", () => {
		useOrganizationSettings.getState().hydrate({
			organizationId: "org_1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone: "UTC",
			fiscalYearStartMonth: 4,
			deletedAt: null,
		});

		expect(useOrganizationSettings.getState().fiscalYearStartMonth).toBe(4);
		expect(useOrganizationSettings.getState().isHydrated).toBe(true);
	});
});
