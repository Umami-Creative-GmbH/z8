import { IconGauge, IconLicense, IconReportMoney, IconSteeringWheel } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";
import { buildPersonalNav, buildSecondaryNav, buildTeamNav } from "@/components/app-sidebar-nav";
import { buildStaticAppSearchResults } from "@/lib/app-search/static-results";
import {
	APP_NAVIGATION_MANIFEST,
	getNavigationIconForHref,
	type NavigationCapabilities,
} from "./navigation-manifest";
import { appPageOwnsHeading, resolveAppRouteMetadata } from "./route-metadata";

const t = (_key: string, defaultValue: string) => defaultValue;

const ALL_CAPABILITIES: NavigationCapabilities = {
	scheduling: true,
	compliance: true,
	payroll: true,
	finance: true,
	worksCouncil: true,
	myDocuments: true,
	myEquipment: true,
	equipment: true,
	personnelFiles: true,
	periodSubmissions: true,
	teamPresence: true,
	myDrivingLicence: true,
	teamDrivingLicence: true,
	analytics: true,
	projectReports: true,
	platformAdmin: true,
};

const NO_CAPABILITIES: NavigationCapabilities = {
	scheduling: false,
	compliance: false,
	payroll: false,
	finance: false,
	worksCouncil: false,
	myDocuments: false,
	myEquipment: false,
	equipment: false,
	personnelFiles: false,
	periodSubmissions: false,
	teamPresence: false,
	myDrivingLicence: false,
	teamDrivingLicence: false,
	analytics: false,
	projectReports: false,
	platformAdmin: false,
};

describe("navigation manifest", () => {
	it("has unique manifest IDs", () => {
		const ids = APP_NAVIGATION_MANIFEST.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("unifies driving-licence, Expense Finance, and Missing vehicle logs across sidebar, Cmd+K, and route metadata", () => {
		const personalNav = buildPersonalNav(t, ALL_CAPABILITIES, "admin");
		const teamNav = buildTeamNav(t, ALL_CAPABILITIES, "admin");
		const searchResults = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			showPayrollNav: true,
			navigationCapabilities: ALL_CAPABILITIES,
			featureFlags: { shiftsEnabled: true, projectsEnabled: true },
		});

		const findPage = (href: string) =>
			searchResults.find((r) => r.type === "page" && r.href === href);

		// Driving licences: "My driving licence" and "Driving licences"
		expect(personalNav.find((item) => item.url === "/driving-licence")?.title).toBe(
			"My driving licence",
		);
		expect(findPage("/driving-licence")?.title).toBe("My driving licence");
		expect(resolveAppRouteMetadata("/en/driving-licence").titleDefault).toBe("My driving licence");
		expect(getNavigationIconForHref("/driving-licence")).toBe(IconSteeringWheel);

		expect(teamNav.find((item) => item.url === "/team/driving-licence")?.title).toBe(
			"Driving licences",
		);
		expect(findPage("/team/driving-licence")?.title).toBe("Driving licences");
		expect(resolveAppRouteMetadata("/en/team/driving-licence").titleDefault).toBe(
			"Driving licences",
		);
		expect(getNavigationIconForHref("/team/driving-licence")).toBe(IconLicense);

		// Expense Finance
		expect(personalNav.find((item) => item.url === "/travel-expenses/finance")?.title).toBe(
			"Expense Finance",
		);
		expect(findPage("/travel-expenses/finance")?.title).toBe("Expense Finance");
		expect(resolveAppRouteMetadata("/en/travel-expenses/finance").titleDefault).toBe(
			"Expense Finance",
		);
		expect(getNavigationIconForHref("/travel-expenses/finance")).toBe(IconReportMoney);

		// Missing vehicle logs with distinct odometer icon (not steering wheel)
		expect(findPage("/team/driving")?.title).toBe("Missing vehicle logs");
		expect(resolveAppRouteMetadata("/en/team/driving").titleDefault).toBe("Missing vehicle logs");
		const missingVehicleLogsIcon = getNavigationIconForHref("/team/driving");
		expect(missingVehicleLogsIcon).toBe(IconGauge);
		expect(missingVehicleLogsIcon).not.toBe(IconSteeringWheel);
	});

	it("indexes all previously omitted active routes in Cmd+K only when authorized", () => {
		const authorizedPages = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccessTier: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			showPayrollNav: true,
			navigationCapabilities: ALL_CAPABILITIES,
			featureFlags: { shiftsEnabled: true, projectsEnabled: true },
		})
			.filter((result) => result.type === "page")
			.map((result) => result.href);

		for (const href of [
			"/today",
			"/team/presence",
			"/team/period-submissions",
			"/team/driving",
			"/travel-expenses/finance",
			"/my-documents",
			"/personnel-files",
			"/my-equipment",
			"/equipment",
			"/works-council",
			"/notifications",
			"/analytics",
			"/reports/projects",
			"/reports/vehicles",
		]) {
			expect(authorizedPages, `expected ${href} for authorized user`).toContain(href);
			expect(getNavigationIconForHref(href), `expected manifest icon for ${href}`).toBeDefined();
		}

		const employeePages = buildStaticAppSearchResults({
			t,
			employeeRole: "employee",
			settingsAccessTier: "member",
			billingEnabled: false,
			showComplianceNav: false,
			showPayrollNav: false,
			navigationCapabilities: NO_CAPABILITIES,
			featureFlags: { shiftsEnabled: false, projectsEnabled: false },
		})
			.filter((result) => result.type === "page")
			.map((result) => result.href);

		// Always-visible pages remain accessible to plain employees
		expect(employeePages).toContain("/notifications");
		expect(employeePages).toContain("/reports/vehicles");

		// Restricted/capability-gated routes stay hidden
		for (const href of [
			"/today",
			"/team/presence",
			"/team/period-submissions",
			"/team/driving",
			"/travel-expenses/finance",
			"/my-documents",
			"/personnel-files",
			"/my-equipment",
			"/equipment",
			"/works-council",
			"/analytics",
			"/reports/projects",
		]) {
			expect(employeePages, `expected ${href} hidden for plain employee`).not.toContain(href);
		}
	});

	it("exposes Missing vehicle logs to org admins even without an employee record and to managers with an employee record", () => {
		const orgAdminNoEmployee = buildStaticAppSearchResults({
			t,
			employeeRole: null,
			settingsAccessTier: "orgAdmin",
			billingEnabled: false,
			showComplianceNav: true,
		});
		expect(orgAdminNoEmployee.some((r) => r.href === "/team/driving")).toBe(true);

		const managerWithoutEmployee = buildStaticAppSearchResults({
			t,
			employeeRole: null,
			settingsAccessTier: "manager",
			billingEnabled: false,
			showComplianceNav: false,
		});
		expect(managerWithoutEmployee.some((r) => r.href === "/team/driving")).toBe(false);

		const managerWithEmployee = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccessTier: "manager",
			billingEnabled: false,
			showComplianceNav: false,
		});
		expect(managerWithEmployee.some((r) => r.href === "/team/driving")).toBe(true);
	});

	it("keeps sidebar items aligned with manifest titles, hrefs, and icons", () => {
		const sidebarItems = [
			...buildPersonalNav(t, ALL_CAPABILITIES, "employee"),
			...buildTeamNav(t, ALL_CAPABILITIES, "manager"),
			...buildSecondaryNav(t, ALL_CAPABILITIES),
		];
		for (const item of sidebarItems) {
			if ("external" in item && item.external) continue;
			expect(getNavigationIconForHref(item.url)).toBeDefined();
			expect(item.icon).toBeDefined();
		}
	});

	it("preserves heading ownership flags from the manifest", () => {
		for (const entry of APP_NAVIGATION_MANIFEST) {
			if (entry.external) continue;
			expect(appPageOwnsHeading(`/en${entry.href === "/" ? "" : entry.href}`)).toBe(
				entry.ownsHeading,
			);
		}
	});
});
