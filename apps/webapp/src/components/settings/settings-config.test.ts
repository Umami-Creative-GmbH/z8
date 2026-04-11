import { describe, expect, it } from "vitest";
import {
	filterSettingsByFeatureFlags,
	getResolvedSettingsVisibility,
	getVisibleGroupsForFeatureFlags,
	getVisibleGroups,
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

	it("shows the scoped organization and teams entry for managers without exposing billing", () => {
		const entries = getVisibleSettings("manager", true);

		expect(entries.some((entry) => entry.id === "statistics")).toBe(true);
		expect(entries.some((entry) => entry.id === "calendar")).toBe(true);
		expect(entries.some((entry) => entry.id === "organizations")).toBe(true);
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

	it("derives visible groups from the remaining visible entries", () => {
		const entries = getVisibleSettings("manager", false);
		const groups = getVisibleGroups(entries);

		expect(groups.map((group) => group.id)).toEqual([
			"account",
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
		const expectedVisibleSettings = getVisibleSettings("orgAdmin", true);
		const visibility = getResolvedSettingsVisibility({
			accessTier: "orgAdmin",
			billingEnabled: true,
			featureFlags: {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
			},
		});

		expect(visibility.visibleSettings).toEqual(expectedVisibleSettings);
		expect(visibility.visibleGroups).toEqual(
			getVisibleGroupsForFeatureFlags(expectedVisibleSettings, {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
			}),
		);
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

		expect(ownerEntries.map((entry) => entry.id)).toEqual(
			adminEntries.map((entry) => entry.id),
		);
	});
});
