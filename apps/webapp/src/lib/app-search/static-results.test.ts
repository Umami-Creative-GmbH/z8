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
	it("shows personal pages and member settings for org members", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "employee",
			settingsAccess: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(results.map((result) => result.href)).toEqual(
			expect.arrayContaining([
				"/",
				"/time-tracking",
				"/settings/profile",
				"/settings/security",
				"/settings/position-stamps",
				"/settings/my-data",
			]),
		);
		expect(results.some((result) => result.href === "/settings/employees")).toBe(false);
		expect(results.some((result) => result.href === "/settings/organization")).toBe(false);
		expect(results.some((result) => result.href === "/settings/closed-months")).toBe(false);
		expect(results.some((result) => result.href === "/settings/approval-policies")).toBe(false);
		expect(results.some((result) => result.href === "/team")).toBe(false);
		expect(results.some((result) => result.href === "/team/absences")).toBe(false);
		const settingsResult = results.find((result) => result.href === "/settings/profile");
		expect(settingsResult).toMatchObject({ type: "setting", title: "Profile" });
	});

	it("shows only account-only settings when settingsAccess is null (former employee or unapproved/missing membership)", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: null,
			settingsAccess: null,
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
			settingsCapabilities: {
				canAccessClosedMonths: true,
				canManageApprovalEscalation: true,
				canManageProjects: true,
				canManageDrivingLicence: true,
				hasActiveReportShareLinks: true,
			},
		});

		const settingHrefs = results
			.filter((result) => result.type === "setting")
			.map((result) => result.href);
		expect(settingHrefs).toEqual([
			"/settings/profile",
			"/settings/security",
			"/settings/notifications",
			"/settings/wellness",
		]);
	});

	it("shows Closed months in app search for an org member with canAccessClosedMonths", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "employee",
			settingsAccess: "member",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
			settingsCapabilities: { canAccessClosedMonths: true },
		});

		expect(results.find((result) => result.href === "/settings/closed-months")).toMatchObject({
			type: "setting",
			title: "Closed months",
		});
		expect(results.some((result) => result.href === "/settings/organization")).toBe(false);
	});

	it("shows Approval in app search for a member or scopedManager with canManageApprovalEscalation", () => {
		for (const settingsAccess of ["member", "scopedManager"] as const) {
			const results = buildStaticAppSearchResults({
				t,
				employeeRole: settingsAccess === "member" ? "employee" : "manager",
				settingsAccess,
				billingEnabled: true,
				showComplianceNav: false,
				featureFlags: enabledFeatures,
				settingsCapabilities: { canManageApprovalEscalation: true },
			});

			expect(results.find((result) => result.href === "/settings/approval-policies")).toMatchObject(
				{
					type: "setting",
					title: "Approval",
				},
			);
			expect(results.some((result) => result.href === "/settings/organization")).toBe(false);
		}
	});

	it("finds the employee's own schedule only while shifts are on (#977)", () => {
		const input = {
			t,
			employeeRole: "employee" as const,
			settingsAccess: "member" as const,
			billingEnabled: true,
			showComplianceNav: false,
		};

		expect(
			buildStaticAppSearchResults({ ...input, featureFlags: enabledFeatures }).find(
				(result) => result.href === "/scheduling",
			),
		).toMatchObject({ type: "page", id: "page:my-schedule", title: "My Schedule" });
		expect(
			buildStaticAppSearchResults({
				...input,
				featureFlags: { ...enabledFeatures, shiftsEnabled: false },
			}).some((result) => result.href === "/scheduling"),
		).toBe(false);
	});

	it("finds the Projects setting for an employee who manages a project (canManageProjects)", () => {
		const input = {
			t,
			employeeRole: "employee" as const,
			settingsAccess: "member" as const,
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		};
		const settingHrefs = (canManageProjects: boolean) =>
			buildStaticAppSearchResults({
				...input,
				settingsCapabilities: { canManageProjects },
			})
				.filter((result) => result.type === "setting")
				.map((result) => result.href);

		expect(settingHrefs(true)).toEqual([...settingHrefs(false), "/settings/projects"]);
	});

	it("shows manager navigation and scopedManager settings without org-admin settings", () => {
		const results = buildStaticAppSearchResults({
			t: (key, defaultValue) =>
				key === "appSearch.teamAbsences.description"
					? "Translated team absence search description"
					: key === "appSearch.teamAbsences.keywords.absence"
						? "abwesenheit"
						: t(key, defaultValue),
			employeeRole: "manager",
			settingsAccess: "scopedManager",
			billingEnabled: true,
			showComplianceNav: false,
			featureFlags: enabledFeatures,
		});

		expect(results.some((result) => result.href === "/team")).toBe(true);
		expect(results.find((result) => result.href === "/team/absences")).toMatchObject({
			type: "page",
			id: "page:team-absences",
			title: "Team Absences",
			subtitle: "Translated team absence search description",
			keywords: ["team", "abwesenheit", "sick", "vacation", "manager"],
		});
		expect(results.some((result) => result.href === "/approvals/inbox")).toBe(true);
		expect(results.some((result) => result.href === "/settings/employees")).toBe(true);
		expect(results.some((result) => result.href === "/settings/teams")).toBe(true);
		expect(results.some((result) => result.href === "/settings/billing")).toBe(false);
		expect(results.some((result) => result.href === "/compliance")).toBe(false);
	});

	it("shows org-admin-only destinations for both orgAdmin and owner", () => {
		for (const settingsAccess of ["orgAdmin", "owner"] as const) {
			const results = buildStaticAppSearchResults({
				t,
				employeeRole: "admin",
				settingsAccess,
				billingEnabled: true,
				showComplianceNav: true,
				featureFlags: enabledFeatures,
			});

			expect(results.some((result) => result.href === "/compliance")).toBe(true);
			expect(results.some((result) => result.href === "/settings/organization")).toBe(true);
			expect(results.some((result) => result.href === "/settings/billing")).toBe(true);
			expect(results.some((result) => result.href === "/settings/roles")).toBe(true);
		}
	});

	it("keeps Report Share Links searchable when Projects is off and active share links exist", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccess: "owner",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: { ...enabledFeatures, projectsEnabled: false },
			settingsCapabilities: { hasActiveReportShareLinks: true },
		});

		expect(results.some((result) => result.href === "/settings/report-share-links")).toBe(true);
		expect(results.some((result) => result.href === "/settings/projects")).toBe(false);
	});

	it("honors billing and feature flags", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "manager",
			settingsAccess: "scopedManager",
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
			settingsAccess: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		const keys = results.map((result) => `${result.type}:${result.href}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("finds Driving licence pages only where the visibility reader and capabilities show them", () => {
		const input = {
			t,
			employeeRole: "employee" as const,
			settingsAccess: "orgAdmin" as const,
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		};
		const results = (extra: {
			showMyDrivingLicenceNav?: boolean;
			showTeamDrivingLicenceNav?: boolean;
			canManageDrivingLicence?: boolean;
		}) =>
			buildStaticAppSearchResults({
				...input,
				showMyDrivingLicenceNav: extra.showMyDrivingLicenceNav,
				showTeamDrivingLicenceNav: extra.showTeamDrivingLicenceNav,
				settingsCapabilities:
					extra.canManageDrivingLicence === undefined
						? undefined
						: { canManageDrivingLicence: extra.canManageDrivingLicence },
			});
		const hrefs = (extra: Parameters<typeof results>[0]) =>
			results(extra).map((result) => result.href);

		expect(hrefs({})).not.toContain("/driving-licence");
		expect(hrefs({})).not.toContain("/team/driving-licence");
		expect(hrefs({})).not.toContain("/settings/driving-licence");
		expect(
			results({ showMyDrivingLicenceNav: true }).find(
				(result) => result.href === "/driving-licence",
			),
		).toMatchObject({
			type: "page",
			id: "page:driving-licence",
			title: "My driving licence",
		});
		expect(hrefs({ showMyDrivingLicenceNav: true })).not.toContain("/team/driving-licence");
		// A verifier who is not a manager still finds the team page.
		expect(
			results({ showTeamDrivingLicenceNav: true }).find(
				(result) => result.href === "/team/driving-licence",
			),
		).toMatchObject({
			type: "page",
			id: "page:team-driving-licence",
			title: "Driving licences",
		});
		expect(hrefs({ canManageDrivingLicence: true })).toContain("/settings/driving-licence");
	});

	it("returns globally unique result ids", () => {
		const results = buildStaticAppSearchResults({
			t,
			employeeRole: "admin",
			settingsAccess: "orgAdmin",
			billingEnabled: true,
			showComplianceNav: true,
			featureFlags: enabledFeatures,
		});

		const ids = results.map((result) => result.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
