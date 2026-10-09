import { describe, expect, it } from "vitest";
import {
	isOrganizationFeature,
	organizationFeatureUpdate,
	requiresDedicatedSwitch,
} from "./organization-features";

describe("organization features", () => {
	it("lists the Billable Time module switch as an organization feature", () => {
		expect(isOrganizationFeature("billableTimeEnabled")).toBe(true);
	});

	it("switches Billable Time off together with projects", () => {
		expect(organizationFeatureUpdate("projectsEnabled", false)).toEqual({
			projectsEnabled: false,
			billableTimeEnabled: false,
		});
	});

	it("leaves Billable Time alone when projects are switched on", () => {
		expect(organizationFeatureUpdate("projectsEnabled", true)).toEqual({ projectsEnabled: true });
	});

	it("changes only the named flag for other features", () => {
		expect(organizationFeatureUpdate("surchargesEnabled", false)).toEqual({
			surchargesEnabled: false,
		});
	});

	it("keeps Billable Time out of the generic toggle, which cannot ask for a currency", () => {
		expect(requiresDedicatedSwitch("billableTimeEnabled")).toBe(true);
		expect(requiresDedicatedSwitch("projectsEnabled")).toBe(false);
	});
});
