import { describe, expect, it } from "vitest";
import {
	canReachFeatureSwitches,
	FEATURE_SWITCH_HREFS,
	type FeatureFlagState,
	filterSettingsByFeatureFlags,
	getResolvedSettingsVisibility,
	getVisibleGroups,
	getVisibleGroupsForFeatureFlags,
	getVisibleSettings,
	isSettingFeatureBypassed,
	SETTINGS_ENTRIES,
} from "@/components/settings/settings-config";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { SettingsCapabilities } from "@/lib/settings/capabilities";
import settingsGenericEn from "../../../messages/settings/generic/en.json";
import settingsPeopleEn from "../../../messages/settings/people/en.json";

const ALL_ACCESS_LEVELS: ReadonlyArray<SettingsAccess | null> = [
	null,
	"member",
	"scopedManager",
	"orgAdmin",
	"owner",
];

describe("feature switch locations", () => {
	it("points every feature-gated setting at its switch on the Organization page", () => {
		for (const entry of SETTINGS_ENTRIES) {
			if (!entry.requiredFeature) continue;
			expect(FEATURE_SWITCH_HREFS[entry.requiredFeature], entry.id).toMatch(
				/^\/settings\/organization#[a-z-]+-toggle$/,
			);
		}
		expect(FEATURE_SWITCH_HREFS.shiftsEnabled).toBe("/settings/organization#shifts-toggle");
	});

	it("offers the switch link only to access levels that reach Organization settings", () => {
		expect(canReachFeatureSwitches("owner")).toBe(true);
		expect(canReachFeatureSwitches("orgAdmin")).toBe(true);
		expect(canReachFeatureSwitches("scopedManager")).toBe(false);
		expect(canReachFeatureSwitches("member")).toBe(false);
		expect(canReachFeatureSwitches(null)).toBe(false);
	});
});

describe("settings visibility and minimumAccess (ADR 0003)", () => {
	it("declares null minimumAccess for account-only settings and member for org self-service settings", () => {
		const accountOnlyIds = ["profile", "security", "notifications", "wellness"];
		const orgSelfServiceIds = ["position-stamps", "my-data"];

		for (const id of accountOnlyIds) {
			expect(SETTINGS_ENTRIES.find((entry) => entry.id === id)?.minimumAccess, id).toBeNull();
		}
		for (const id of orgSelfServiceIds) {
			expect(SETTINGS_ENTRIES.find((entry) => entry.id === id)?.minimumAccess, id).toBe("member");
		}
		for (const entry of SETTINGS_ENTRIES) {
			if (accountOnlyIds.includes(entry.id) || orgSelfServiceIds.includes(entry.id)) continue;
			expect(["scopedManager", "orgAdmin"], entry.id).toContain(entry.minimumAccess);
		}
	});

	it("shows only account-only settings when settingsAccess is null (former employee or unapproved/missing membership)", () => {
		const entries = getVisibleSettings(null, true);

		expect(entries.map((entry) => entry.id)).toEqual([
			"profile",
			"security",
			"notifications",
			"wellness",
		]);
		expect(getVisibleGroups(entries).map((group) => group.id)).toEqual(["account"]);
	});

	it("never exposes organization settings when settingsAccess is null, even if capabilities are set", () => {
		const allCapabilities: SettingsCapabilities = {
			canAccessClosedMonths: true,
			canManageApprovalEscalation: true,
			canManageProjects: true,
			canManageDrivingLicence: true,
			hasActiveReportShareLinks: true,
		};
		const { visibleSettings, visibleGroups } = getResolvedSettingsVisibility({
			settingsAccess: null,
			billingEnabled: true,
			featureFlags: {
				shiftsEnabled: true,
				projectsEnabled: true,
				surchargesEnabled: true,
				demoDataEnabled: true,
				worksCouncilEnabled: true,
				billableTimeEnabled: true,
				personnelFilesEnabled: true,
				equipmentEnabled: true,
			},
			settingsCapabilities: allCapabilities,
		});

		expect(visibleSettings.map((entry) => entry.id)).toEqual([
			"profile",
			"security",
			"notifications",
			"wellness",
		]);
		expect(visibleGroups.map((group) => group.id)).toEqual(["account"]);
	});

	it("offers equipment setup only to organization administrators and owners", () => {
		for (const access of ALL_ACCESS_LEVELS) {
			const expected = access === "orgAdmin" || access === "owner";
			expect(
				getVisibleSettings(access, true).some((entry) => entry.href === "/settings/equipment"),
				String(access),
			).toBe(expected);
		}
	});

	it("shows account-only and org self-service entries for members", () => {
		const entries = getVisibleSettings("member", false);

		expect(entries.map((entry) => entry.id)).toEqual([
			"profile",
			"security",
			"notifications",
			"wellness",
			"position-stamps",
			"my-data",
		]);
	});

	it("shows teams and manager settings but not organization management for scoped managers", () => {
		const entries = getVisibleSettings("scopedManager", true);

		expect(entries.some((entry) => entry.id === "teams")).toBe(true);
		expect(entries.some((entry) => entry.id === "organizations")).toBe(false);
		expect(entries.some((entry) => entry.id === "statistics")).toBe(false);
		expect(entries.some((entry) => entry.id === "calendar")).toBe(true);
		expect(entries.some((entry) => entry.id === "change-policies")).toBe(false);
		expect(entries.some((entry) => entry.id === "employees")).toBe(true);
		expect(entries.some((entry) => entry.id === "holidays")).toBe(false);
		expect(entries.some((entry) => entry.id === "locations")).toBe(true);
		expect(entries.some((entry) => entry.id === "skills")).toBe(true);
		expect(entries.some((entry) => entry.id === "absences")).toBe(true);
		expect(entries.some((entry) => entry.id === "work-categories")).toBe(true);
		expect(entries.some((entry) => entry.id === "work-policies")).toBe(true);
		expect(entries.some((entry) => entry.id === "shift-planning")).toBe(true);
		expect(entries.some((entry) => entry.id === "coverage-rules")).toBe(false);
		expect(entries.some((entry) => entry.id === "projects")).toBe(true);
		expect(entries.some((entry) => entry.id === "customers")).toBe(true);
		expect(entries.some((entry) => entry.id === "surcharges")).toBe(true);
		expect(entries.some((entry) => entry.id === "billing")).toBe(false);
		expect(entries.some((entry) => entry.id === "closed-months")).toBe(false);
		expect(entries.some((entry) => entry.id === "approval")).toBe(false);
	});

	it("shows organization and teams entries for org admins and owners", () => {
		for (const access of ["orgAdmin", "owner"] as const) {
			const entries = getVisibleSettings(access, true);

			expect(entries.find((entry) => entry.id === "organizations")).toMatchObject({
				titleDefault: "Organization",
				href: "/settings/organization",
				minimumAccess: "orgAdmin",
			});
			expect(entries.find((entry) => entry.id === "teams")).toMatchObject({
				titleDefault: "Teams",
				href: "/settings/teams",
				minimumAccess: "scopedManager",
			});
		}
	});

	it("gives owner and orgAdmin the same visible settings menu", () => {
		const ownerEntries = getVisibleSettings("owner", true);
		const adminEntries = getVisibleSettings("orgAdmin", true);

		expect(ownerEntries.map((entry) => entry.id)).toEqual(adminEntries.map((entry) => entry.id));
	});

	it("uses people-management copy for employees and configuration copy for organization", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		const organizationEntry = entries.find((entry) => entry.id === "organizations");
		const employeesEntry = entries.find((entry) => entry.id === "employees");

		expect(organizationEntry).toMatchObject({
			descriptionDefault: "Manage organization details and configuration",
		});
		expect(organizationEntry?.descriptionDefault).not.toMatch(/member|invitation|invite/i);
		expect(employeesEntry).toMatchObject({
			descriptionDefault: "Manage employees, members, and invites",
		});
	});

	it("keeps English settings translations aligned with people-management defaults", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		const organizationEntry = entries.find((entry) => entry.id === "organizations");
		const employeesEntry = entries.find((entry) => entry.id === "employees");

		expect(settingsGenericEn.settings.organizations.description).toBe(
			organizationEntry?.descriptionDefault,
		);
		expect(settingsPeopleEn.settings.employees.description).toBe(
			employeesEntry?.descriptionDefault,
		);
	});

	it("orders organization setup from members and teams to configuration", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		const organizationEntries = entries.filter((entry) => entry.group === "organization");

		expect(organizationEntries.map((entry) => entry.id)).toEqual([
			"organizations",
			"employees",
			"teams",
			"roles",
			"identity-access",
			"custom-domains",
			"locations",
			"vehicles",
			"equipment",
			"personnel-files",
			"custom-fields",
			"implementation-checklist",
			"billing",
		]);
	});

	it("shows combined email settings only for org admins and owners", () => {
		expect(getVisibleSettings("owner", true).some((entry) => entry.id === "email")).toBe(true);
		expect(getVisibleSettings("orgAdmin", true).some((entry) => entry.id === "email")).toBe(true);
		expect(getVisibleSettings("scopedManager", true).some((entry) => entry.id === "email")).toBe(
			false,
		);
		expect(getVisibleSettings("member", true).some((entry) => entry.id === "email")).toBe(false);
		expect(getVisibleSettings(null, true).some((entry) => entry.id === "email")).toBe(false);
	});

	it("shows implementation checklist only for org admins and owners", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("scopedManager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.find((entry) => entry.id === "implementation-checklist")).toMatchObject({
			titleDefault: "Implementation Checklist",
			href: "/settings/implementation-checklist",
			minimumAccess: "orgAdmin",
			group: "organization",
		});
		expect(managerEntries.some((entry) => entry.id === "implementation-checklist")).toBe(false);
		expect(memberEntries.some((entry) => entry.id === "implementation-checklist")).toBe(false);
	});

	it("shows payroll officer settings in payroll for org admins", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("scopedManager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.find((entry) => entry.id === "payroll-access")).toMatchObject({
			titleDefault: "Payroll Officers",
			href: "/settings/payroll-access",
			icon: "user-dollar",
			minimumAccess: "orgAdmin",
			group: "payroll",
		});
		expect(managerEntries.some((entry) => entry.id === "payroll-access")).toBe(false);
		expect(memberEntries.some((entry) => entry.id === "payroll-access")).toBe(false);
	});

	it("shows position capture to org admins and every member's own position stamps", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("scopedManager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.find((entry) => entry.id === "position-capture")).toMatchObject({
			href: "/settings/position-capture",
			minimumAccess: "orgAdmin",
			group: "time-tracking",
		});
		expect(managerEntries.some((entry) => entry.id === "position-capture")).toBe(false);
		expect(memberEntries.find((entry) => entry.id === "position-stamps")).toMatchObject({
			href: "/settings/position-stamps",
			minimumAccess: "member",
			group: "account",
		});
	});

	it("has no separate vehicle-use navigation entry", () => {
		expect(getVisibleSettings("orgAdmin", true).some((entry) => entry.id === "vehicle-use")).toBe(
			false,
		);
	});

	it("shows kiosks in time tracking to org admins only", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("scopedManager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.find((entry) => entry.id === "kiosks")).toMatchObject({
			href: "/settings/kiosks",
			icon: "device-tablet",
			minimumAccess: "orgAdmin",
			group: "time-tracking",
		});
		expect(managerEntries.some((entry) => entry.id === "kiosks")).toBe(false);
		expect(memberEntries.some((entry) => entry.id === "kiosks")).toBe(false);
	});

	it("shows the combined Vehicles entry next to organization locations", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("scopedManager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.find((entry) => entry.id === "vehicles")).toMatchObject({
			href: "/settings/vehicles",
			icon: "car",
			minimumAccess: "orgAdmin",
			group: "organization",
		});
		const organizationIds = SETTINGS_ENTRIES.filter((entry) => entry.group === "organization").map(
			(entry) => entry.id,
		);
		expect(organizationIds.indexOf("vehicles")).toBe(organizationIds.indexOf("locations") + 1);
		expect(managerEntries.some((entry) => entry.id === "vehicles")).toBe(false);
		expect(memberEntries.some((entry) => entry.id === "vehicles")).toBe(false);
	});

	it("shows custom fields to org admins after personnel files", () => {
		const orgAdminEntries = getVisibleSettings("orgAdmin", true);
		const managerEntries = getVisibleSettings("scopedManager", true);
		const memberEntries = getVisibleSettings("member", true);

		expect(orgAdminEntries.find((entry) => entry.id === "custom-fields")).toMatchObject({
			href: "/settings/custom-fields",
			icon: "forms",
			minimumAccess: "orgAdmin",
			group: "organization",
		});
		const organizationIds = SETTINGS_ENTRIES.filter((entry) => entry.group === "organization").map(
			(entry) => entry.id,
		);
		expect(organizationIds.indexOf("custom-fields")).toBe(
			organizationIds.indexOf("personnel-files") + 1,
		);
		expect(
			filterSettingsByFeatureFlags(orgAdminEntries, { projectsEnabled: false }).some(
				(entry) => entry.id === "custom-fields",
			),
		).toBe(true);
		expect(managerEntries.some((entry) => entry.id === "custom-fields")).toBe(false);
		expect(memberEntries.some((entry) => entry.id === "custom-fields")).toBe(false);
	});

	it("groups all policy settings around one Approval entry", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		expect(entries.filter((entry) => entry.group === "policies").map((entry) => entry.id)).toEqual([
			"contracts",
			"work-policies",
			"absences",
			"employee-allowances",
			"travel-expenses",
			"approval",
		]);
		expect(entries.find((entry) => entry.id === "approval")).toMatchObject({
			// A dedicated navigation title, not the escalation fact label.
			titleKey: "settings.navigation.approval.title",
			titleDefault: "Approval",
			href: "/settings/approval-policies",
			minimumAccess: "orgAdmin",
		});
		expect(entries.some((entry) => entry.href === "/settings/approval-escalation")).toBe(false);
	});

	it("uses one Work Policies entry for work and change rules", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		expect(entries.find((entry) => entry.id === "work-policies")).toMatchObject({
			group: "policies",
			minimumAccess: "scopedManager",
			href: "/settings/work-policies",
		});
		expect(entries.some((entry) => entry.id === "change-policies")).toBe(false);
	});

	it("combines holidays and vacation in one Absences entry under Policies", () => {
		const entries = getVisibleSettings("scopedManager", false);
		expect(entries.find((entry) => entry.id === "absences")).toMatchObject({
			group: "policies",
			titleDefault: "Absences",
			href: "/settings/vacation",
			minimumAccess: "scopedManager",
		});
		expect(entries.some((entry) => entry.id === "holidays" || entry.id === "vacation")).toBe(false);
	});

	it("separates personal notification preferences from organization delivery settings", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		expect(
			entries.filter((entry) => entry.group === "integrations-channels").map((entry) => entry.id),
		).toEqual(["email", "chat-integrations", "calendar", "developer-access"]);
		expect(entries.find((entry) => entry.id === "notifications")).toMatchObject({
			group: "account",
			minimumAccess: null,
			href: "/settings/notifications",
		});
		for (const access of [null, "member", "scopedManager"] as const) {
			expect(
				getVisibleSettings(access, true).some(
					(entry) => entry.id === "email" || entry.id === "chat-integrations",
				),
			).toBe(false);
		}
	});

	it("keeps identity, branding and personnel files with organization setup", () => {
		const entries = getVisibleSettings("orgAdmin", true);
		expect(entries.find((entry) => entry.id === "identity-access")).toMatchObject({
			group: "organization",
			minimumAccess: "orgAdmin",
		});
		expect(entries.find((entry) => entry.id === "custom-domains")?.group).toBe("organization");
		expect(
			entries.filter((entry) => entry.group === "integrations-channels").map((entry) => entry.id),
		).toEqual(["email", "chat-integrations", "calendar", "developer-access"]);
		const personnel = entries.find((entry) => entry.id === "personnel-files");
		expect(personnel).toMatchObject({
			group: "organization",
			minimumAccess: "orgAdmin",
			requiredFeature: "personnelFilesEnabled",
		});
		expect(filterSettingsByFeatureFlags(entries, { personnelFilesEnabled: false })).not.toContain(
			personnel,
		);
		expect(filterSettingsByFeatureFlags(entries, { personnelFilesEnabled: true })).toContain(
			personnel,
		);
		const equipment = entries.find((entry) => entry.id === "equipment");
		expect(equipment).toMatchObject({
			group: "organization",
			minimumAccess: "orgAdmin",
			requiredFeature: "equipmentEnabled",
		});
		expect(filterSettingsByFeatureFlags(entries, { equipmentEnabled: false })).not.toContain(
			equipment,
		);
		expect(filterSettingsByFeatureFlags(entries, { equipmentEnabled: true })).toContain(equipment);
		expect(entries.find((entry) => entry.id === "scheduled-exports")).toMatchObject({
			group: "data",
			minimumAccess: "orgAdmin",
		});
		expect(entries.find((entry) => entry.id === "clocking")).toMatchObject({
			group: "time-tracking",
			minimumAccess: "orgAdmin",
		});
		expect(
			entries.some((entry) =>
				[
					"email-templates",
					"email-config",
					"slack",
					"discord",
					"telegram",
					"teams-notifications",
					"webhooks",
					"audit-log",
					"coverage-rules",
				].includes(entry.id),
			),
		).toBe(false);
	});

	it("derives visible groups from the remaining visible entries", () => {
		const entries = getVisibleSettings("scopedManager", false);
		const groups = getVisibleGroups(entries);

		expect(groups.map((group) => group.id)).toEqual([
			"account",
			"organization",
			"policies",
			"time-tracking",
			"scheduling",
			"projects",
			"payroll",
			"integrations-channels",
		]);
	});

	it("applies billing filtering after access filtering", () => {
		const entries = getVisibleSettings("orgAdmin", false);

		expect(entries.some((entry) => entry.id === "billing")).toBe(false);
		expect(entries.some((entry) => entry.id === "avv")).toBe(false);
		expect(entries.some((entry) => entry.id === "organizations")).toBe(true);
	});

	it("shows billing entries for org admins and owners when billing is enabled", () => {
		for (const access of ["orgAdmin", "owner"] as const) {
			const entries = getVisibleSettings(access, true);

			expect(entries.some((entry) => entry.id === "billing")).toBe(true);
			expect(entries.some((entry) => entry.id === "avv")).toBe(true);
		}
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
		const featureOnlySchedulingEntries = SETTINGS_ENTRIES.filter(
			(entry) => entry.group === "scheduling" && entry.requiredFeature,
		);
		const entries = filterSettingsByFeatureFlags(featureOnlySchedulingEntries, {
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: false,
		});

		expect(entries).toHaveLength(0);
		expect(getVisibleGroups(entries)).toEqual([]);
	});

	it("derives groups from feature-filtered visible entries in one step", () => {
		const featureOnlySchedulingEntries = SETTINGS_ENTRIES.filter(
			(entry) => entry.group === "scheduling" && entry.requiredFeature,
		);

		expect(
			getVisibleGroupsForFeatureFlags(featureOnlySchedulingEntries, {
				shiftsEnabled: false,
				projectsEnabled: false,
				surchargesEnabled: false,
				demoDataEnabled: false,
			}),
		).toEqual([]);
	});

	it("resolves settings visibility with unfiltered groups when feature flags are unavailable", () => {
		const visibility = getResolvedSettingsVisibility({
			settingsAccess: "orgAdmin",
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
			settingsAccess: "orgAdmin",
			billingEnabled: true,
			featureFlags,
		});

		expect(visibility.visibleSettings).toEqual(expectedVisibleSettings);
		expect(visibility.visibleGroups).toEqual(getVisibleGroups(expectedVisibleSettings));
	});

	it("excludes demo data from resolved visible settings when the demo data feature is disabled", () => {
		const visibility = getResolvedSettingsVisibility({
			settingsAccess: "orgAdmin",
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

	it("hides works council settings when the works council feature is disabled", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
			worksCouncilEnabled: false,
		});

		expect(entries.some((entry) => entry.id === "works-council")).toBe(false);
	});

	it("shows works council settings when the works council feature is enabled", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
			demoDataEnabled: true,
			worksCouncilEnabled: true,
		});

		expect(entries.some((entry) => entry.id === "works-council")).toBe(true);
	});

	it("keeps demo data visible when partial feature flags omit the new flag", () => {
		const entries = filterSettingsByFeatureFlags(SETTINGS_ENTRIES, {
			shiftsEnabled: true,
			projectsEnabled: true,
			surchargesEnabled: true,
		});

		expect(entries.some((entry) => entry.id === "demo-data")).toBe(true);
	});

	describe("Closed months moved out of Settings (#1957)", () => {
		it("never exposes a Settings entry for closed-months even when canAccessClosedMonths is true", () => {
			for (const access of [null, "member", "scopedManager", "orgAdmin", "owner"] as const) {
				const visibility = getResolvedSettingsVisibility({
					settingsAccess: access,
					settingsCapabilities: { canAccessClosedMonths: true },
				});
				expect(visibility.visibleSettings.some((e) => e.id === "closed-months")).toBe(false);
			}
		});
	});

	describe("Approval escalation capability (canManageApprovalEscalation)", () => {
		it("shows Approval to a member or scopedManager with canManageApprovalEscalation", () => {
			for (const access of ["member", "scopedManager"] as const) {
				const withoutCapability = getResolvedSettingsVisibility({
					settingsAccess: access,
					settingsCapabilities: { canManageApprovalEscalation: false },
				});
				const withCapability = getResolvedSettingsVisibility({
					settingsAccess: access,
					settingsCapabilities: { canManageApprovalEscalation: true },
				});

				expect(withoutCapability.visibleSettings.some((e) => e.id === "approval")).toBe(false);
				expect(withCapability.visibleSettings.some((e) => e.id === "approval")).toBe(true);
				expect(withCapability.visibleGroups.map((g) => g.id)).toContain("policies");
				expect(
					withCapability.visibleSettings.filter((e) => e.id !== "approval").map((e) => e.id),
				).toEqual(withoutCapability.visibleSettings.map((e) => e.id));
			}
		});

		it("still hides Approval when settingsAccess is null", () => {
			const visibility = getResolvedSettingsVisibility({
				settingsAccess: null,
				settingsCapabilities: { canManageApprovalEscalation: true },
			});
			expect(visibility.visibleSettings.some((e) => e.id === "approval")).toBe(false);
		});
	});

	describe("Projects entry for project managers below scopedManager (canManageProjects)", () => {
		const projectsOn: FeatureFlagState = { projectsEnabled: true };
		const visibleIds = (
			settingsAccess: SettingsAccess | null,
			canManageProjects: boolean,
			featureFlags = projectsOn,
		) =>
			getResolvedSettingsVisibility({
				settingsAccess,
				billingEnabled: true,
				featureFlags,
				settingsCapabilities: { canManageProjects },
			}).visibleSettings.map((entry) => entry.id);

		it("shows a member who manages a project the Projects entry and nothing else new", () => {
			expect(visibleIds("member", true)).toContain("projects");
			expect(visibleIds("member", true).filter((id) => id !== "projects")).toEqual(
				visibleIds("member", false),
			);
			expect(
				getResolvedSettingsVisibility({
					settingsAccess: "member",
					featureFlags: projectsOn,
					settingsCapabilities: { canManageProjects: true },
				}).visibleGroups.map((group) => group.id),
			).toContain("projects");
		});

		it("shows a member who manages no project no Projects entry", () => {
			expect(visibleIds("member", false)).not.toContain("projects");
		});

		it("keeps the Projects entry hidden while projects are off or settingsAccess is null", () => {
			expect(visibleIds("member", true, { projectsEnabled: false })).not.toContain("projects");
			expect(visibleIds(null, true, projectsOn)).not.toContain("projects");
		});

		it("changes nothing for scoped managers, org admins, and owners", () => {
			expect(visibleIds("scopedManager", true)).toEqual(visibleIds("scopedManager", false));
			expect(visibleIds("orgAdmin", true)).toEqual(visibleIds("orgAdmin", false));
			expect(visibleIds("owner", true)).toEqual(visibleIds("owner", false));
		});
	});

	describe("Report Share Links capability (hasActiveReportShareLinks)", () => {
		const reportShareEntry = SETTINGS_ENTRIES.find((entry) => entry.id === "report-share-links")!;

		it("keeps Report Share Links visible to org admins and owners when Projects is off and active links exist", () => {
			for (const access of ["orgAdmin", "owner"] as const) {
				const withLinks = getResolvedSettingsVisibility({
					settingsAccess: access,
					featureFlags: { projectsEnabled: false },
					settingsCapabilities: { hasActiveReportShareLinks: true },
				});
				const withoutLinks = getResolvedSettingsVisibility({
					settingsAccess: access,
					featureFlags: { projectsEnabled: false },
					settingsCapabilities: { hasActiveReportShareLinks: false },
				});

				expect(withLinks.visibleSettings.some((e) => e.id === "report-share-links")).toBe(true);
				expect(withLinks.visibleGroups.map((g) => g.id)).toContain("projects");
				expect(withoutLinks.visibleSettings.some((e) => e.id === "report-share-links")).toBe(false);
			}
			expect(isSettingFeatureBypassed(reportShareEntry, { hasActiveReportShareLinks: true })).toBe(
				true,
			);
			expect(isSettingFeatureBypassed(reportShareEntry, { hasActiveReportShareLinks: false })).toBe(
				false,
			);
		});

		it("never exposes Report Share Links below orgAdmin even when active links exist", () => {
			for (const access of [null, "member", "scopedManager"] as const) {
				const visibility = getResolvedSettingsVisibility({
					settingsAccess: access,
					featureFlags: { projectsEnabled: false },
					settingsCapabilities: { hasActiveReportShareLinks: true },
				});
				expect(visibility.visibleSettings.some((e) => e.id === "report-share-links")).toBe(false);
			}
		});
	});

	describe("Billable Time settings area", () => {
		const billableTimeOn = {
			projectsEnabled: true,
			billableTimeEnabled: true,
		};
		const isVisible = (
			settingsAccess: SettingsAccess | null,
			featureFlags: Parameters<typeof getResolvedSettingsVisibility>[0]["featureFlags"],
		) =>
			getResolvedSettingsVisibility({
				settingsAccess,
				featureFlags,
			}).visibleSettings.some((entry) => entry.id === "billable-time");

		it("shows the area to org admins and owners while the module is on", () => {
			expect(isVisible("orgAdmin", billableTimeOn)).toBe(true);
			expect(isVisible("owner", billableTimeOn)).toBe(true);
			expect(
				getVisibleSettings("orgAdmin").find((entry) => entry.id === "billable-time"),
			).toMatchObject({ href: "/settings/billable-time" });
		});

		it("hides the area below orgAdmin even while the module is on", () => {
			expect(isVisible("scopedManager", billableTimeOn)).toBe(false);
			expect(isVisible("member", billableTimeOn)).toBe(false);
			expect(isVisible(null, billableTimeOn)).toBe(false);
		});

		it("hides the area from everyone while the module is off", () => {
			expect(
				isVisible("orgAdmin", {
					projectsEnabled: true,
					billableTimeEnabled: false,
				}),
			).toBe(false);
			expect(isVisible("orgAdmin", { projectsEnabled: true })).toBe(false);
		});

		it("hides the area while projects are off, even if the module flag is still set", () => {
			expect(
				isVisible("orgAdmin", {
					projectsEnabled: false,
					billableTimeEnabled: true,
				}),
			).toBe(false);
		});

		it("guards the area's entry as org admin only", () => {
			expect(SETTINGS_ENTRIES.find((entry) => entry.id === "billable-time")?.minimumAccess).toBe(
				"orgAdmin",
			);
		});
	});

	describe("Driving licence control entries (canManageDrivingLicence)", () => {
		const visibleIds = (settingsAccess: SettingsAccess | null, canManageDrivingLicence?: boolean) =>
			getResolvedSettingsVisibility({
				settingsAccess,
				billingEnabled: true,
				featureFlags: {},
				settingsCapabilities:
					canManageDrivingLicence === undefined ? undefined : { canManageDrivingLicence },
			}).visibleSettings.map((entry) => entry.id);

		it("no longer lists My driving authorization in Settings", () => {
			expect(SETTINGS_ENTRIES.some((entry) => entry.href === "/driving-licence")).toBe(false);
			expect(visibleIds("member", true)).not.toContain("my-driving-licence");
		});

		it("shows the admin entry in the compliance group only when the capability allows it", () => {
			expect(visibleIds("orgAdmin", true)).toContain("driving-licence");
			expect(visibleIds("owner", true)).toContain("driving-licence");
			expect(visibleIds("orgAdmin", false)).not.toContain("driving-licence");
			expect(visibleIds("orgAdmin")).not.toContain("driving-licence");
			expect(
				getResolvedSettingsVisibility({
					settingsAccess: "orgAdmin",
					settingsCapabilities: { canManageDrivingLicence: true },
				}).visibleSettings.find((entry) => entry.id === "driving-licence"),
			).toMatchObject({
				group: "compliance",
				href: "/settings/driving-licence",
			});
		});

		it("never shows the admin entry below orgAdmin", () => {
			expect(visibleIds("scopedManager", true)).not.toContain("driving-licence");
			expect(visibleIds("member", true)).not.toContain("driving-licence");
			expect(visibleIds(null, true)).not.toContain("driving-licence");
		});
	});

	describe("Settings group consolidation & Payroll Connectors rename (#1957, #1958)", () => {
		it("merges Notifications and Integrations into Integrations & Channels for 10 groups total", async () => {
			const { SETTINGS_GROUPS } = await import("@/components/settings/settings-config");
			expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual([
				"account",
				"organization",
				"policies",
				"time-tracking",
				"scheduling",
				"projects",
				"payroll",
				"integrations-channels",
				"compliance",
				"data",
			]);
			expect(SETTINGS_GROUPS).toHaveLength(10);
			expect(SETTINGS_GROUPS.find((group) => group.id === "integrations-channels")).toMatchObject({
				labelKey: "settings.group.integrationsChannels",
				labelDefault: "Integrations & Channels",
			});

			const mergedEntries = SETTINGS_ENTRIES.filter(
				(entry) => entry.group === "integrations-channels",
			);
			expect(mergedEntries.map((entry) => entry.id)).toEqual([
				"email",
				"chat-integrations",
				"calendar",
				"developer-access",
			]);
		});

		it("re-titles /settings/payroll-export to Payroll Connectors & Wage Types and keeps core settings entries", () => {
			const payrollExport = SETTINGS_ENTRIES.find((entry) => entry.id === "payroll-export");
			expect(payrollExport).toMatchObject({
				titleKey: "settings.payrollExport.connectorsTitle",
				titleDefault: "Payroll Connectors & Wage Types",
				href: "/settings/payroll-export",
				group: "payroll",
				minimumAccess: "orgAdmin",
			});

			expect(SETTINGS_ENTRIES.some((entry) => entry.id === "payroll-readiness")).toBe(false);
			expect(SETTINGS_ENTRIES.some((entry) => entry.id === "closed-months")).toBe(false);
			expect(SETTINGS_ENTRIES.some((entry) => entry.id === "employees")).toBe(true);
			expect(SETTINGS_ENTRIES.some((entry) => entry.id === "work-diagnostics")).toBe(true);
			expect(SETTINGS_ENTRIES.some((entry) => entry.id === "export-operations")).toBe(true);
		});
	});
});
