import { describe, expect, it } from "vitest";
import type { StaticAppCommandInput } from "./static-commands";
import { buildStaticAppCommands } from "./static-commands";

const translatedT = (key: string, defaultValue: string) => `${key}:${defaultValue}`;

const enabledFeatures = {
	shiftsEnabled: true,
	projectsEnabled: true,
	surchargesEnabled: true,
	demoDataEnabled: true,
};

function buildCommands(input: Partial<StaticAppCommandInput> = {}) {
	return buildStaticAppCommands({
		t: translatedT,
		employeeRole: "employee",
		settingsAccess: "member",
		billingEnabled: true,
		showComplianceNav: true,
		featureFlags: enabledFeatures,
		...input,
	});
}

describe("buildStaticAppCommands", () => {
	it("shows employee action commands", () => {
		const results = buildCommands();

		expect(results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "action",
					id: "action:add-manual-time-entry",
					title: "appSearch.commands.addManualTimeEntry.title:Add manual time entry",
					href: "/time-tracking",
				}),
				expect.objectContaining({
					type: "action",
					id: "action:request-absence",
					title: "appSearch.commands.requestAbsence.title:Request absence",
					href: "/absences",
				}),
				expect.objectContaining({
					type: "action",
					id: "action:submit-travel-expense",
					title: "appSearch.commands.submitTravelExpense.title:Submit travel expense",
					href: "/travel-expenses",
				}),
				expect.objectContaining({
					type: "action",
					id: "action:open-settings",
					title: "appSearch.commands.openSettings.title:Open settings",
					href: "/settings",
				}),
			]),
		);
	});

	it("uses translations for titles, subtitles, and keywords", () => {
		const addManualTimeEntry = buildCommands().find(
			(result) => result.id === "action:add-manual-time-entry",
		);

		expect(addManualTimeEntry).toMatchObject({
			title: "appSearch.commands.addManualTimeEntry.title:Add manual time entry",
			subtitle:
				"appSearch.commands.addManualTimeEntry.subtitle:Record hours for a past shift or correction",
			keywords: [
				"appSearch.commands.addManualTimeEntry.keywords.time:time",
				"appSearch.commands.addManualTimeEntry.keywords.hours:hours",
				"appSearch.commands.addManualTimeEntry.keywords.manual:manual",
				"appSearch.commands.addManualTimeEntry.keywords.entry:entry",
			],
		});
	});

	it("hides manager-only commands from employees and shows them to managers", () => {
		expect(buildCommands().map((result) => result.id)).not.toEqual(
			expect.arrayContaining(["action:open-approvals-inbox"]),
		);

		expect(
			buildCommands({ employeeRole: "manager", settingsAccess: "scopedManager" }).map(
				(result) => result.id,
			),
		).toEqual(expect.arrayContaining(["action:open-approvals-inbox"]));
	});

	it("shows org-admin-only commands for orgAdmin and owner and hides them for null, member, and scopedManager", () => {
		for (const settingsAccess of [null, "member", "scopedManager"] as const) {
			expect(
				buildCommands({
					employeeRole: settingsAccess === "scopedManager" ? "manager" : "employee",
					settingsAccess,
				}).map((result) => result.id),
			).not.toEqual(
				expect.arrayContaining([
					"action:create-project",
					"action:invite-teammate",
					"action:open-payroll-readiness",
				]),
			);
		}

		for (const settingsAccess of ["orgAdmin", "owner"] as const) {
			const orgAdminCommands = buildCommands({
				employeeRole: "admin",
				settingsAccess,
			});

			expect(orgAdminCommands.map((result) => result.id)).toEqual(
				expect.arrayContaining([
					"action:create-project",
					"action:invite-teammate",
					"action:open-payroll-readiness",
				]),
			);
			expect(
				orgAdminCommands.find((result) => result.id === "action:invite-teammate"),
			).toMatchObject({
				href: "/settings/employees",
			});
			expect(
				orgAdminCommands.find((result) => result.id === "action:open-payroll-readiness"),
			).toMatchObject({
				href: "/payroll",
			});
		}

		expect(
			buildCommands({
				employeeRole: "admin",
				settingsAccess: "orgAdmin",
				featureFlags: { ...enabledFeatures, projectsEnabled: false },
			}).map((result) => result.id),
		).not.toContain("action:create-project");
	});

	it("returns globally unique result ids", () => {
		const ids = buildCommands({ employeeRole: "admin", settingsAccess: "owner" }).map(
			(result) => result.id,
		);

		expect(new Set(ids).size).toBe(ids.length);
	});
});
