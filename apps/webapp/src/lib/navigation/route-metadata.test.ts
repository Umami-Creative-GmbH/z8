import { describe, expect, it } from "vitest";
import { appPageOwnsHeading, normalizeAppPath, resolveAppRouteMetadata } from "./route-metadata";

it("opts only the driving queue into page-owned headings", () => {
	expect(appPageOwnsHeading("/en/team/driving")).toBe(true);
	expect(appPageOwnsHeading("/de/team/driving/")).toBe(true);
	expect(appPageOwnsHeading("/en/team/driving/detail")).toBe(false);
	expect(appPageOwnsHeading("/en/team/driving-other")).toBe(false);
});

it("adopts presence selection and selected-location headings, preserving deeper exclusions", () => {
	expect(appPageOwnsHeading("/de/team/presence")).toBe(true);
	expect(appPageOwnsHeading("/en/team/presence/berlin")).toBe(true);
	expect(appPageOwnsHeading("/en/team/presence/berlin/history")).toBe(false);
	expect(appPageOwnsHeading("/en/team")).toBe(true);
});

describe("route metadata", () => {
	it("adopts the manager Today briefing heading without descendants", () => {
		expect(appPageOwnsHeading("/en/today")).toBe(true);
		expect(appPageOwnsHeading("/de/today/")).toBe(true);
		expect(appPageOwnsHeading("/en/today/detail")).toBe(false);
	});
	it("adopts the team absence heading, retaining team ownership and independent descendants", () => {
		expect(appPageOwnsHeading("/en/team/absences")).toBe(true);
		expect(appPageOwnsHeading("/de/team/absences/")).toBe(true);
		expect(appPageOwnsHeading("/en/team/absences/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/team")).toBe(true);
		expect(appPageOwnsHeading("/en/team/driving/detail")).toBe(false);
	});
	it("adopts the team directory heading, preserving independently staged descendants", () => {
		expect(appPageOwnsHeading("/de/team")).toBe(true);
		for (const path of [
			"/en/team/presence/berlin/detail",
			"/en/team/driving/detail",
			"/en/team/period-submissions/detail",
			"/en/team/other",
			"/en/teamwork",
		]) {
			expect(appPageOwnsHeading(path)).toBe(false);
		}
	});
	it("adopts the due-for-deletion review without adopting deeper or invalid personnel routes", () => {
		expect(appPageOwnsHeading("/de/personnel-files/due-for-deletion")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/due-for-deletion/")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/due-for-deletion/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/personnel-files/requests")).toBe(false);
	});
	it("adopts the request queue without adopting its independent descendants", () => {
		expect(appPageOwnsHeading("/de/personnel-files/document-requests")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/document-requests/extra")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/personnel-files")).toBe(true);
	});
	it("adopts only the report share-link settings heading without other settings or descendants", () => {
		expect(appPageOwnsHeading("/en/settings/report-share-links")).toBe(true);
		expect(appPageOwnsHeading("/de/settings/report-share-links/")).toBe(true);
		expect(appPageOwnsHeading("/en/settings/report-share-links/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/other")).toBe(false);
	});
	it("adopts settings pages and records that render their own heading, keeping redirect-only routes on the shell title", () => {
		for (const path of [
			"/en/settings",
			"/de/settings/",
			"/en/settings/clocking",
			"/en/settings/audit-export",
			"/en/settings/notification-channels",
			"/en/settings/work-policies",
			"/en/settings/vacation",
			"/en/settings/enterprise/domains",
			"/en/settings/enterprise/identity-setup",
			"/en/settings/enterprise/email",
			"/en/settings/billable-time",
			"/en/billable-time/hand-off",
			"/en/settings/employees/employee-1",
			"/en/settings/teams/team-1",
			"/en/settings/locations/location-1",
			"/en/settings/vacation/employees/employee-1",
		]) {
			expect(appPageOwnsHeading(path)).toBe(true);
		}
		for (const path of [
			"/en/settings/webhooks",
			"/en/settings/slack",
			"/en/settings/holidays",
			"/en/settings/change-policies",
			"/en/settings/statistics",
			"/en/settings/billable-time/rates",
			"/en/settings/billable-time/hand-off",
			"/en/settings/enterprise",
			"/en/settings/permissions",
			"/en/settings/employees/employee-1/detail",
			"/en/settings-other",
		]) {
			expect(appPageOwnsHeading(path)).toBe(false);
		}
	});
	it("adopts only selected employee files, leaving other personnel workflows independently staged", () => {
		expect(appPageOwnsHeading("/de/personnel-files/af981290-0000-4000-8000-000000000001")).toBe(
			true,
		);
		expect(
			appPageOwnsHeading("/en/personnel-files/af981290-0000-4000-8000-000000000001/detail"),
		).toBe(false);
	});
	it("adopts the payslip batch start and detail headings", () => {
		expect(appPageOwnsHeading("/de/personnel-files/payslip-batches")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/payslip-batches/batch-id")).toBe(true);
	});
	it("adopts only the sick-leave overview heading, preserving independent personnel routes", () => {
		expect(appPageOwnsHeading("/de/personnel-files/sick-leave")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/sick-leave/detail")).toBe(false);
	});
	it("adopts only the scheduling page heading, preserving its descendants and settings", () => {
		expect(appPageOwnsHeading("/de/scheduling")).toBe(true);
		expect(appPageOwnsHeading("/en/scheduling/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/shifts")).toBe(true);
	});
	it("adopts payroll, the work-balance directory and selected balance without deeper descendants", () => {
		expect(appPageOwnsHeading("/de/payroll")).toBe(true);
		expect(appPageOwnsHeading("/en/payroll/work-balances")).toBe(true);
		expect(appPageOwnsHeading("/en/payroll/work-balances/employee-1")).toBe(true);
		expect(appPageOwnsHeading("/en/payroll/work-balances/employee-1/other")).toBe(false);
	});
	it("adopts only the notification timeline heading, retaining settings and descendants", () => {
		expect(appPageOwnsHeading("/de/notifications")).toBe(true);
		expect(appPageOwnsHeading("/en/notifications/other")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/notifications")).toBe(true);
	});
	it("adopts only the personal requests page heading", () => {
		expect(appPageOwnsHeading("/de/my-requests")).toBe(true);
		expect(appPageOwnsHeading("/en/my-requests/detail")).toBe(false);
	});
	it("adopts the works-council page heading without descendants", () => {
		expect(appPageOwnsHeading("/en/works-council")).toBe(true);
		expect(appPageOwnsHeading("/de/works-council/")).toBe(true);
		expect(appPageOwnsHeading("/en/works-council/detail")).toBe(false);
	});
	it("adopts the personal documents heading without officer descendants", () => {
		expect(appPageOwnsHeading("/de/my-documents")).toBe(true);
		expect(appPageOwnsHeading("/en/my-documents/extra")).toBe(false);
		expect(appPageOwnsHeading("/en/personnel-files/employee-1")).toBe(false);
	});
	it("adopts the personnel file directory and sick-leave overview while preserving descendant boundaries", () => {
		expect(appPageOwnsHeading("/de/personnel-files")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/payslip-batches/id")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/sick-leave")).toBe(true);
		for (const path of ["/en/personnel-files/id", "/en/personnel-files/sick-leave/detail"])
			expect(appPageOwnsHeading(path)).toBe(false);
	});
	it("adopts equipment overview and exact assignment headings, keeping other descendants independent", () => {
		expect(appPageOwnsHeading("/de/equipment")).toBe(true);
		expect(appPageOwnsHeading("/en/equipment/assignments/id")).toBe(true);
		expect(appPageOwnsHeading("/de/equipment/assignments/id?back=%2Fequipment")).toBe(true);
		expect(appPageOwnsHeading("/en/equipment/assignments")).toBe(false);
		expect(appPageOwnsHeading("/en/equipment/assignments/id/extra")).toBe(false);
		expect(appPageOwnsHeading("/en/equipment/employees/id/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/equipment")).toBe(true);
	});
	it("adopts the employee equipment record heading without adopting its collection", () => {
		expect(appPageOwnsHeading("/de/equipment/employees/id")).toBe(true);
		expect(appPageOwnsHeading("/en/equipment/employees")).toBe(false);
	});
	it("adopts both licence pages and the employee check while retaining other descendants and settings headings", () => {
		expect(appPageOwnsHeading("/de/driving-licence")).toBe(true);
		expect(appPageOwnsHeading("/de/team/driving-licence")).toBe(true);
		expect(appPageOwnsHeading("/en/team/driving-licence/employee-1")).toBe(true);
		expect(appPageOwnsHeading("/en/team/driving-licence/employee-1/detail")).toBe(false);
		// The old check route only redirects (#1937).
		expect(appPageOwnsHeading("/en/driving-licence/checks/employee-1")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/driving-licence")).toBe(true);
	});
	it("retains independent approvals page headings", () => {
		// `/approvals` only redirects to the Approval inbox (#1976).
		expect(appPageOwnsHeading("/de/approvals")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/inbox")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/review/org/absence/id")).toBe(true);
	});
	it("keeps Works Council's heading while /settings/compliance only redirects (#1977)", () => {
		expect(appPageOwnsHeading("/de/settings/compliance")).toBe(false);
		expect(appPageOwnsHeading("/de/settings/compliance/works-council")).toBe(true);
	});
	it("adopts only the deputy history record, preserving other approval headings", () => {
		expect(appPageOwnsHeading("/de/approvals/deputy-decisions/absence-1")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/deputy-decisions/absence-1/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/deputy-decisions")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/inbox")).toBe(true);
	});
	it("adopts the exact inbox heading, retaining independent review route ownership", () => {
		expect(appPageOwnsHeading("/de/approvals/inbox")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/inbox/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/review/org/time_entry/id")).toBe(true);
	});
	it("adopts only the complete review arrival route", () => {
		expect(appPageOwnsHeading("/de/approvals/review/org/canonical/id")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/review/org/canonical")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/review/org/canonical/id/detail")).toBe(false);
	});
	it("adopts the exact vacation route while retaining staged descendants", () => {
		expect(appPageOwnsHeading("/de/analytics/vacation-trends")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/vacation-trends/detail")).toBe(false);
	});
	it("adopts only refreshed analytics routes while retaining staged descendants", () => {
		expect(appPageOwnsHeading("/de/analytics/overtime-burn-down")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/overtime-burn-down/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/analytics/team-performance")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/team-performance/detail")).toBe(false);
	});
	it("adopts refreshed analytics without adopting unconverted descendants", () => {
		expect(appPageOwnsHeading("/de/analytics")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/work-hours")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/work-hours/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/calendar")).toBe(true);
		expect(appPageOwnsHeading("/en/calendar/employee-1")).toBe(true);
		expect(appPageOwnsHeading("/en/calendar/employee-1/detail")).toBe(false);
	});
	it("adopts exact report titles and preserves descendant shell headings", () => {
		expect(appPageOwnsHeading("/de/reports/projects")).toBe(true);
		expect(appPageOwnsHeading("/en/reports/vehicles")).toBe(true);
		expect(appPageOwnsHeading("/de/reports/vehicles/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/reports/projects/detail")).toBe(false);
	});
	it.each([
		["/en", "Dashboard"],
		["/de/my-requests", "My Requests"],
		["/en/organization", "Org Explorer"],
		["/en/payroll", "Payroll"],
		["/en/scheduling", "Scheduling"],
		["/en/approvals/inbox", "Approvals"],
		["/en/compliance", "Compliance"],
		["/en/works-council", "Works Council"],
		["/en/team/absences", "Team Absences"],
		["/en/team/driving", "Missing vehicle logs"],
		["/en/driving-licence", "My driving licence"],
		["/en/team/driving-licence", "Driving licences"],
		["/en/team/driving-licence/employee-1", "Driving licences"],
		["/en/travel-expenses/finance", "Expense Finance"],
		["/en/reports/projects", "Project Reports"],
		["/en/reports/vehicles", "Distance per Vehicle"],
		["/en/settings/employees/employee-1", "Employees"],
		["/en/settings/locations/location-1", "Locations"],
		["/en/equipment", "Equipment"],
		["/en/equipment/employees/employee-1", "Equipment"],
		["/en/equipment/assignments/assignment-1", "Equipment"],
		["/de/my-equipment", "My equipment"],
		["/en/settings/equipment", "Settings"],
	])("resolves %s", (pathname, title) => {
		expect(resolveAppRouteMetadata(pathname).titleDefault).toBe(title);
	});

	it("matches route prefixes only at path-segment boundaries", () => {
		expect(resolveAppRouteMetadata("/en/teamwork").titleDefault).toBe("Z8");
	});

	it("normalizes locale and trailing slash segments", () => {
		expect(normalizeAppPath("/de/settings/security/")).toBe("/settings/security");
	});
});
it("adopts only the exact payslip batch detail heading", () => {
	expect(appPageOwnsHeading("/en/personnel-files/payslip-batches/batch-1")).toBe(true);
	expect(appPageOwnsHeading("/de/personnel-files/payslip-batches/batch-1/detail")).toBe(false);
});

it.each([
	["/en/travel-expenses/4053401f-806e-4839-ae66-96b9fa36c054", true],
	["/de/travel-expenses/4053401F-806E-4839-AE66-96B9FA36C054/", true],
	["/travel-expenses/00000000-0000-0000-0000-000000000000", true],
	["/travel-expenses/ffffffff-ffff-ffff-ffff-ffffffffffff", true],
	["/en/travel-expenses/finance", true],
	["/en/travel-expenses/reports", false],
	["/en/travel-expenses/reports/4053401f-806e-4839-ae66-96b9fa36c054", true],
	["/en/travel-expenses/4053401f-806e-4839-ae66-96b9fa36c054/receipts", false],
	["/en/travel-expenses/not-a-claim", false],
	["/en/travel-expenses/4053401f-806e-9839-ae66-96b9fa36c054", false],
])("retained legacy claim heading ownership: %s", (path, owns) => {
	expect(appPageOwnsHeading(path)).toBe(owns);
});

it.each([
	["/travel-expenses/reports/6a020000-0000-4000-8000-000000000001", true],
	["/de/travel-expenses/reports/6A020000-0000-4000-8000-000000000001/", true],
	["/travel-expenses/reports/invalid", false],
	["/travel-expenses/reports/6a020000-0000-f000-8000-000000000001", false],
	["/travel-expenses/reports/6a020000-0000-4000-1000-000000000001", false],
	["/travel-expenses/reports/6a020000-0000-4000-8000-000000000001/receipt", false],
])("report detail heading ownership: %s", (path, owns) => {
	expect(appPageOwnsHeading(path)).toBe(owns);
});
