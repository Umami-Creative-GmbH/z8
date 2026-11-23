import { IconGauge, IconLicense, IconReportMoney, IconSteeringWheel } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";
import {
	buildOrganizationNav,
	buildPersonalNav,
	buildSecondaryNav,
	buildTeamNav,
} from "@/components/app-sidebar-nav";
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
	billableHandOff: true,
	worksCouncil: true,
	myDocuments: true,
	myEquipment: true,
	equipment: true,
	personnelFiles: true,
	periodSubmissions: true,
	teamPresence: true,
	myDrivingLicence: true,
	teamDrivingLicence: true,
	missingVehicleLogs: true,
	analytics: true,
	projectReports: true,
	platformAdmin: true,
};

const NO_CAPABILITIES: NavigationCapabilities = {
	scheduling: false,
	compliance: false,
	payroll: false,
	finance: false,
	billableHandOff: false,
	worksCouncil: false,
	myDocuments: false,
	myEquipment: false,
	equipment: false,
	personnelFiles: false,
	periodSubmissions: false,
	teamPresence: false,
	myDrivingLicence: false,
	teamDrivingLicence: false,
	missingVehicleLogs: false,
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
		const navOptions = {
			settingsAccess: "orgAdmin" as const,
			featureFlags: { shiftsEnabled: true, projectsEnabled: true },
			settingsCapabilities: { canManageProjects: false },
		};
		const personalNav = buildPersonalNav(t, ALL_CAPABILITIES, "admin", navOptions);
		const organizationNav = buildOrganizationNav(t, ALL_CAPABILITIES, "admin", navOptions);
		const searchResults = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccess: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			showPayrollNav: true,
			navigationCapabilities: ALL_CAPABILITIES,
			featureFlags: { shiftsEnabled: true, projectsEnabled: true },
		});

		const findPage = (href: string) =>
			searchResults.find((r) => r.type === "page" && r.href === href);

		// Driving licences: "My driving licence" (Workplace) and "Driving licences" (Organization)
		expect(personalNav.find((item) => item.url === "/driving-licence")?.title).toBe(
			"My driving licence",
		);
		expect(findPage("/driving-licence")?.title).toBe("My driving licence");
		expect(resolveAppRouteMetadata("/en/driving-licence").titleDefault).toBe("My driving licence");
		expect(getNavigationIconForHref("/driving-licence")).toBe(IconSteeringWheel);

		expect(organizationNav.find((item) => item.url === "/team/driving-licence")?.title).toBe(
			"Driving licences",
		);
		expect(findPage("/team/driving-licence")?.title).toBe("Driving licences");
		expect(resolveAppRouteMetadata("/en/team/driving-licence").titleDefault).toBe(
			"Driving licences",
		);
		expect(getNavigationIconForHref("/team/driving-licence")).toBe(IconLicense);

		// Expense Finance (Organization)
		expect(organizationNav.find((item) => item.url === "/travel-expenses/finance")?.title).toBe(
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

	it("organizes the four bounded sidebar sections and split-pair personal/staff routes (#1953)", () => {
		const navOptions = {
			settingsAccess: "orgAdmin" as const,
			featureFlags: { shiftsEnabled: true, projectsEnabled: true },
			settingsCapabilities: { canManageProjects: false },
		};

		expect(
			buildPersonalNav(t, ALL_CAPABILITIES, "employee", navOptions).map((item) => item.url),
		).toEqual([
			"/",
			"/time-tracking",
			"/calendar",
			"/scheduling",
			"/absences",
			"/travel-expenses",
			"/my-requests",
			"/my-documents",
			"/driving-licence",
			"/my-equipment",
			"/reports",
			"/organization",
		]);

		expect(
			buildTeamNav(t, ALL_CAPABILITIES, "manager", navOptions).map((item) => item.url),
		).toEqual([
			"/today",
			"/team",
			"/team/absences",
			"/team/presence",
			"/team/period-submissions",
			"/scheduling",
			"/approvals/inbox",
			"/analytics",
		]);

		// Org admin without an employee record sees Analytics in Team (#1955)
		expect(
			buildTeamNav(
				t,
				{ ...NO_CAPABILITIES, analytics: undefined },
				null,
				{ settingsAccess: "orgAdmin" },
			).map((item) => item.url),
		).toEqual(["/analytics"]);

		expect(
			buildOrganizationNav(t, ALL_CAPABILITIES, "admin", navOptions).map((item) => item.url),
		).toEqual([
			"/payroll",
			"/travel-expenses/finance",
			"/billable-time/hand-off",
			"/personnel-files",
			"/equipment",
			"/team/driving-licence",
			"/compliance",
			"/works-council",
		]);

		expect(buildSecondaryNav(t, ALL_CAPABILITIES, navOptions).map((item) => item.url)).toEqual([
			"/settings",
			"https://docs.z8-time.app/docs",
			"https://github.com/Umami-Creative-GmbH/z8/issues",
			"/platform-admin",
		]);
	});

	it("indexes all previously omitted active routes in Cmd+K only when authorized", () => {
		const authorizedPages = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccess: "orgAdmin",
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
			settingsAccess: "member",
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

	it("exposes Missing vehicle logs by server capability or tier fallback", () => {
		const orgAdminNoEmployee = buildStaticAppSearchResults({
			t,
			employeeRole: null,
			settingsAccess: "orgAdmin",
			billingEnabled: false,
			showComplianceNav: true,
		});
		expect(orgAdminNoEmployee.some((r) => r.href === "/team/driving")).toBe(true);
		expect(orgAdminNoEmployee.some((r) => r.type === "page" && r.href === "/analytics")).toBe(true);
		expect(orgAdminNoEmployee.some((r) => r.href === "/settings/statistics")).toBe(false);

		const serverDeniedOverride = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccess: "orgAdmin",
			billingEnabled: false,
			showComplianceNav: true,
			navigationCapabilities: { ...ALL_CAPABILITIES, missingVehicleLogs: false },
		});
		expect(serverDeniedOverride.some((r) => r.href === "/team/driving")).toBe(false);

		const managerWithoutEmployee = buildStaticAppSearchResults({
			t,
			employeeRole: null,
			settingsAccess: "scopedManager",
			billingEnabled: false,
			showComplianceNav: false,
		});
		expect(managerWithoutEmployee.some((r) => r.href === "/team/driving")).toBe(false);

		const managerWithEmployee = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccess: "scopedManager",
			billingEnabled: false,
			showComplianceNav: false,
		});
		expect(managerWithEmployee.some((r) => r.href === "/team/driving")).toBe(true);
	});

	it("exposes Billable Hand-off in Organization and Cmd+K only to org admins when Projects and Billable Time are enabled (#1956)", () => {
		const orgAdminBothFlags = {
			settingsAccess: "orgAdmin" as const,
			featureFlags: { projectsEnabled: true, billableTimeEnabled: true },
		};
		expect(
			buildOrganizationNav(
				t,
				{ ...NO_CAPABILITIES, billableHandOff: undefined },
				null,
				orgAdminBothFlags,
			).map((item) => item.url),
		).toEqual(["/billable-time/hand-off"]);

		const orgAdminCmdK = buildStaticAppSearchResults({
			t,
			employeeRole: null,
			settingsAccess: "orgAdmin",
			billingEnabled: false,
			showComplianceNav: false,
			featureFlags: { projectsEnabled: true, billableTimeEnabled: true },
		});
		expect(
			orgAdminCmdK.some((r) => r.type === "page" && r.href === "/billable-time/hand-off"),
		).toBe(true);

		// Missing either flag hides Billable Hand-off even for org admins
		for (const flags of [
			{ projectsEnabled: true, billableTimeEnabled: false },
			{ projectsEnabled: false, billableTimeEnabled: true },
		]) {
			expect(
				buildOrganizationNav(
					t,
					{ ...NO_CAPABILITIES, billableHandOff: undefined },
					"admin",
					{ settingsAccess: "orgAdmin", featureFlags: flags },
				).map((item) => item.url),
			).not.toContain("/billable-time/hand-off");
		}

		// Expense officer without org-admin access sees Expense Finance but never Billable Hand-off
		const expenseOfficerNav = buildOrganizationNav(
			t,
			{ ...NO_CAPABILITIES, finance: true, billableHandOff: undefined },
			"employee",
			{
				settingsAccess: "member",
				featureFlags: { projectsEnabled: true, billableTimeEnabled: true },
			},
		).map((item) => item.url);
		expect(expenseOfficerNav).toEqual(["/travel-expenses/finance"]);

		const expenseOfficerCmdK = buildStaticAppSearchResults({
			t,
			employeeRole: "employee",
			settingsAccess: "member",
			billingEnabled: false,
			showComplianceNav: false,
			navigationCapabilities: { ...NO_CAPABILITIES, finance: true, billableHandOff: undefined },
			featureFlags: { projectsEnabled: true, billableTimeEnabled: true },
		});
		expect(expenseOfficerCmdK.some((r) => r.href === "/travel-expenses/finance")).toBe(true);
		expect(expenseOfficerCmdK.some((r) => r.href === "/billable-time/hand-off")).toBe(false);
	});

	it("keeps sidebar items aligned with manifest titles, hrefs, and icons", () => {
		const navOptions = {
			settingsAccess: "orgAdmin" as const,
			featureFlags: { shiftsEnabled: true, projectsEnabled: true },
			settingsCapabilities: { canManageProjects: true },
		};
		const sidebarItems = [
			...buildPersonalNav(t, ALL_CAPABILITIES, "employee", navOptions),
			...buildTeamNav(t, ALL_CAPABILITIES, "manager", navOptions),
			...buildOrganizationNav(t, ALL_CAPABILITIES, "admin", navOptions),
			...buildSecondaryNav(t, ALL_CAPABILITIES, navOptions),
		];
		for (const item of sidebarItems) {
			if ("external" in item && item.external) continue;
			expect(getNavigationIconForHref(item.url)).toBeDefined();
			expect(item.icon).toBeDefined();
		}
	});

	it("derives page heading ownership for manifest routes without adopting descendants or shell-titled pages", () => {
		for (const path of [
			"/en",
			"/en/travel-expenses/finance",
			"/en/team/driving",
			"/en/driving-licence",
			"/en/team/driving-licence",
			"/en/notifications",
			"/en/reports/projects",
			"/en/reports/vehicles",
			"/en/today",
			"/en/analytics",
			"/en/equipment",
			"/en/my-equipment",
		]) {
			expect(appPageOwnsHeading(path), `expected ${path} to own heading`).toBe(true);
		}
		for (const path of [
			"/en/platform-admin",
			"/en/team/driving/detail",
			"/en/notifications/detail",
		]) {
			expect(appPageOwnsHeading(path), `expected ${path} to keep shell heading`).toBe(false);
		}
	});
});
