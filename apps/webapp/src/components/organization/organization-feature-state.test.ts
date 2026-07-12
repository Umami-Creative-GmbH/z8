import { describe, expect, it } from "vitest";
import { organizationFeatureReducer } from "./organization-feature-state";

describe("organizationFeatureReducer", () => {
	it("updates only the requested optimistic feature", () => {
		const state = {
			shiftsEnabled: false,
			projectsEnabled: true,
			surchargesEnabled: false,
			demoDataEnabled: true,
			worksCouncilEnabled: false,
		};

		expect(
			organizationFeatureReducer(state, {
				type: "set",
				feature: "worksCouncilEnabled",
				enabled: true,
			}),
		).toEqual({ ...state, worksCouncilEnabled: true });
	});
});
