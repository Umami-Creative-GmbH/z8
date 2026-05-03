import { describe, expect, it } from "vitest";
import {
	filterSettingsByFeatureFlags,
	getResolvedSettingsVisibility,
	getVisibleGroups,
	getVisibleGroupsForFeatureFlags,
	getVisibleSettings,
	SETTINGS_ENTRIES,
} from "@/components/settings/settings-config";
import { resolveSettingsAccessTier } from "@/lib/settings-access";

describe("settings visibility tiers", () => {
	it("shows only member entries for the member tier", () => {
		const entries = getVisibleSettings("member", false);

		expect(entries.map((entry) => entry.id)).toEqual([
			"profile",
			"security",
			"notifications",
			"wellness",
		]);
	});

	it("shows teams but not organization management for managers", () => {
		const entries = getVisibleSettings("manager", true);

		expect(entries.some((entry) => entry.id === "teams")).toBe(true);
		expect(entries.some((entry) => entry.id === "organizations")).toBe(false);
		expect(entries.some((entry) => entry.id === "statistics")).toBe(true);
		expect(entries.some((entry) => entry.id === "calendar")).toBe(true);
		expect(entries.some((entry) => entry.id === "change-policies")).toBe(true);
		expect(entries.some((entry) => entry.id === "employees")).toBe(true);
		expect(entries.some((entry) => entry.id === "holidays")).toBe(true);
		expect(entries.some((entry) => entry.id === "locations")).toBe(true);
		expect(entries.some((entry) => entry.id === "skills")).toBe(true);
		expect(entries.some((entry) => entry.id === "vacation")).toBe(true);
		expect(entries.some((entry) => entry.id === "work-categories")).toBe(true);
		expect(entries.some((entry) => entry.id === "work-policies")).toBe(true);
		expect(entries.some((entry) => entry.id === "shift-templates")).toBe(true);
		expect(entries.some((entry) => entry.id === "coverage-rules")).toBe(true);
		expect(entries.some((entry) => entry.id === "projects")).toBe(true);
		expect(entries.some((entry) => entry.id === "customers")).toBe(true);
		expect(entries.some((entry) => entry.id === "surcharges")).toBe(true);
		expect(entries.some((entry) => entry.id === "billing")).toBe(false);
	});

	it("shows organization and teams entries for org admins", () => {
		const entries = getVisibleSettings("orgAdmin", true);

		expect(entries.find((entry) => entry.id === "organizations")).toMatchObject({
			titleDefault: "Organization",
			href: "/settings/organizations",
			minimumTier: "orgAdmin",
		});
		expect(entries.find((entry) => entry.id === "teams")).toMatchObject({
			titleDefault: "Teams",
			href: "/settings/teams",
			minimumTier: "manager",
		});
	});

	it("shows email templates only for org admins", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("manager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.some((entry) => entry.id === "email-templates")).toBe(true);
		expect(managerEntries.some((entry) => entry.id === "email-templates")).toBe(false);
		expect(memberEntries.some((entry) => entry.id === "email-templates")).toBe(false);
	});

	it("shows legal entities to organization admins only", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const entityAdminEntries = getVisibleSettings("entityAdmin", true);

		expect(orgAdminEntries.some((entry) => entry.id === "legal-entities")).toBe(true);
		expect(entityAdminEntries.some((entry) => entry.id === "legal-entities")).toBe(false);
	});

	it("shows scoped payroll settings to entity admins", () => {
		const entityAdminEntries = getVisibleSettings("entityAdmin", true);

		expect(entityAdminEntries.find((entry) => entry.id === "payroll-export")).toMatchObject({
			minimumTier: "entityAdmin",
			href: "/settings/payroll-export",
		});
		expect(entityAdminEntries.find((entry) => entry.id === "payroll-readiness")).toMatchObject({
			minimumTier: "entityAdmin",
			href: "/settings/payroll-readiness",
		});
	});

	it("does not let entity admins inherit every manager settings entry", () => {
		const entityAdminEntryIds = getVisibleSettings("entityAdmin", true).map((entry) => entry.id);

		expect(entityAdminEntryIds).toEqual(
		expect.arrayContaining([
			"profile",
			"security",
			"notifications",
			"wellness",
			"employees",
			"holidays",
			"vacation",
			"work-policies",
			"change-policies",
			"payroll-export",
			"payroll-readiness",
		]),
		);
		expect(entityAdminEntryIds).not.toEqual(
			expect.arrayContaining(["locations", "work-categories", "statistics", "calendar"]),
		);
	});

	it("groups notification preferences and channel configuration together", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		const notificationEntries = entries.filter((entry) => entry.group === "notifications");

		expect(notificationEntries.map((entry) => entry.id)).toEqual([
			"notifications",
			"telegram",
			"slack",
			"discord",
			"teams-notifications",
		]);
		expect(notificationEntries.find((entry) => entry.id === "notifications")).toMatchObject({
			minimumTier: "member",
			href: "/settings/notifications",
		});
		expect(notificationEntries.find((entry) => entry.id === "telegram")).toMatchObject({
			minimumTier: "orgAdmin",
			href: "/settings/telegram",
		});
	});

	it("derives visible groups from the remaining visible entries", () => {
		const entries = getVisibleSettings("manager", false);
		const groups = getVisibleGroups(entries);

		expect(groups.map((group) => group.id)).toEqual([
			"account",
			"notifications",
			"organization",
			"administration",
			"enterprise",
			"data",
		]);
	});

	it("applies billing filtering after tier filtering", () => {
		const entries = getVisibleSettings("orgAdmin", false);

		expect(entries.some((entry) => entry.id === "billing")).toBe(false);
		expect(entries.some((entry) => entry.id === "avv")).toBe(false);
		expect(entries.some((entry) => entry.id === "organizations")).toBe(true);
	});

	it("shows billing entries for org admins when billing is enabled", () => {
		const entries = getVisibleSettings("orgAdmin", true);

		expect(entries.some((entry) => entry.id === "billing")).toBe(true);
		expect(entries.some((entry) => entry.id === "avv")).toBe(true);
	});

	it("shows export operations for org admins with the expected href", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		const exportOperationsEntry = entries.find((entry) => entry.id === "export-operations");

		expect(exportOperationsEntry).toMatchObject({
			id: "export-operations",
			href: "/settings/export-operations",
		});
	});

	it("filters feature-flagged entries before deriving visible groups", () => {
		const featureOnlyAdministrationEntries = SETTINGS_ENTRIES.filter(
			(entry) => entry.group === "administration" && entry.requiredFeature,
		);
		const entries = filterSettingsByFeatureFlags(featureOnlyAdministrationEntries, {
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: false,
		});

		expect(entries).toHaveLength(0);
		expect(getVisibleGroups(entries)).toEqual([]);
	});

	it("derives groups from feature-filtered visible entries in one step", () => {
		const featureOnlyAdministrationEntries = SETTINGS_ENTRIES.filter(
			(entry) => entry.group === "administration" && entry.requiredFeature,
		);

		expect(
			getVisibleGroupsForFeatureFlags(featureOnlyAdministrationEntries, {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: false,
			}),
		).toEqual([]);
	});

	it("resolves settings visibility with unfiltered groups when feature flags are unavailable", () => {
		const visibility = getResolvedSettingsVisibility({
			accessTier: "orgAdmin",
			billingEnabled: true,
		});

		expect(visibility.visibleSettings).toEqual(getVisibleSettings("orgAdmin", true));
		expect(visibility.visibleGroups).toEqual(
			getVisibleGroups(getVisibleSettings("orgAdmin", true)),
		);
	});

	it("resolves settings visibility with feature-filtered groups when feature flags are available", () => {
		const featureFlags = {
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
		};
		const expectedVisibleSettings = filterSettingsByFeatureFlags(
			getVisibleSettings("orgAdmin", true),
			featureFlags,
		);
		const visibility = getResolvedSettingsVisibility({
			accessTier: "orgAdmin",
			billingEnabled: true,
			featureFlags,
		});

		expect(visibility.visibleSettings).toEqual(expectedVisibleSettings);
		expect(visibility.visibleGroups).toEqual(getVisibleGroups(expectedVisibleSettings));
	});

	it("excludes demo data from resolved visible settings when the demo data feature is disabled", () => {
		const visibility = getResolvedSettingsVisibility({
			accessTier: "orgAdmin",
			billingEnabled: true,
			featureFlags: {
				shiftsEnabled: true,
				projectsEnabled: true,
				surchargesEnabled: true,
				demoDataEnabled: false,
			},
		});

		expect(visibility.visibleSettings.some((entry) => entry.id === "demo-data")).toBe(false);
	});

	it("gives owner and admin memberships the same org admin menu", () => {
		const ownerEntries = getVisibleSettings(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "owner",
				employeeRole: null,
			}),
			true,
		);
		const adminEntries = getVisibleSettings(
			resolveSettingsAccessTier({
				activeOrganizationId: "org-a",
				membershipRole: "admin",
				employeeRole: null,
			}),
			true,
		);

		expect(ownerEntries.map((entry) => entry.id)).toEqual(adminEntries.map((entry) => entry.id));
	});

	it("hides demo data when the demo data feature is disabled", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: false,
		});

		expect(entries.some((entry) => entry.id === "demo-data")).toBe(false);
	});

	it("shows demo data when the demo data feature is enabled", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
		});

		expect(entries.some((entry) => entry.id === "demo-data")).toBe(true);
	});

	it("keeps demo data visible when partial feature flags omit the new flag", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
		});

		expect(entries.some((entry) => entry.id === "demo-data")).toBe(true);
	});
});
