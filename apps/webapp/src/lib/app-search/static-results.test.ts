import { describe, expect, it } from "vitest";
import { buildStaticAppSearchResults } from "./static-results";

const t = (_key: string, defaultValue: string) => defaultValue;

const enabledFeatures = {
	shiftsEnabled: true,
	projectsEnabled: true,
	surchargesEnabled: true,
	demoDataEnabled: true,
};

describe("buildStaticAppSearchResults", () => {
	it("shows personal pages and member settings for employees", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(results.map((result) => result.href)).toEqual(
			expect.arrayContaining(["/", "/time-tracking", "/settings/profile", "/settings/security"]),
		);
		expect(results.some((result) => result.href === "/settings/employees")).toBe(false);
		expect(results.some((result) => result.href === "/settings/organizations")).toBe(false);
		expect(results.some((result) => result.href === "/team")).toBe(false);
		const settingsResult = results.find((result) => result.href === "/settings/profile");
		expect(settingsResult).toMatchObject({ type: "setting", title: "Profile" });
	});

	it("shows manager navigation and manager settings without org-admin settings", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(results.some((result) => result.href === "/team")).toBe(true);
		expect(results.some((result) => result.href === "/approvals/inbox")).toBe(true);
		expect(results.some((result) => result.href === "/settings/employees")).toBe(true);
		expect(results.some((result) => result.href === "/settings/teams")).toBe(true);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(false);
		expect(results.some((result) => result.href === "/compliance")).toBe(false);
	});

	it("shows org-admin-only destinations when allowed", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		expect(results.some((result) => result.href === "/compliance")).toBe(true);
		expect(results.some((result) => result.href === "/settings/organizations")).toBe(true);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(true);
		expect(results.some((result) => result.href === "/settings/roles")).toBe(true);
	});

	it("honors billing and feature flags", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: false,
			showComplianceNav: false,
			featureFlags: {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: false,
			},
		});

		expect(results.some((result) => result.href === "/scheduling")).toBe(false);
		expect(results.some((result) => result.href === "/settings/shifts")).toBe(false);
		expect(results.some((result) => result.href === "/settings/projects")).toBe(false);
		expect(results.some((result) => result.href === "/settings/surcharges")).toBe(false);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(false);
	});

	it("deduplicates destinations by type and href", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		const keys = results.map((result) => `${result.type}:${result.href}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("returns globally unique result ids", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		const ids = results.map((result) => result.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
