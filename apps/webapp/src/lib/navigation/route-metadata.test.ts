import { describe, expect, it } from "vitest";
import {
	appPageOwnsHeading,
	normalizeAppPath,
	resolveAppRouteMetadata,
} from "./route-metadata";

describe("route metadata", () => {
	it("adopts the due-for-deletion review without adopting deeper or invalid personnel routes", () => {
		expect(appPageOwnsHeading("/de/personnel-files/due-for-deletion")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/due-for-deletion/")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/due-for-deletion/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/personnel-files/requests")).toBe(false);
	});
	it("adopts the request queue without adopting its independent descendants", () => {
		expect(appPageOwnsHeading("/de/personnel-files/document-requests")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/document-requests/extra")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/personnel-files")).toBe(false);
	});
	it("adopts only the report share-link settings heading without other settings or descendants", () => {
		expect(appPageOwnsHeading("/en/settings/report-share-links")).toBe(true);
		expect(appPageOwnsHeading("/de/settings/report-share-links/")).toBe(true);
		expect(appPageOwnsHeading("/en/settings/report-share-links/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/other")).toBe(false);
	});
	it("adopts only selected employee files, leaving other personnel workflows independently staged", () => {
		expect(
			appPageOwnsHeading(
				"/de/personnel-files/af981290-0000-4000-8000-000000000001",
			),
		).toBe(true);
		expect(
			appPageOwnsHeading(
				"/en/personnel-files/af981290-0000-4000-8000-000000000001/detail",
			),
		).toBe(false);
	});
	it("adopts the payslip batch start and detail headings", () => {
		expect(appPageOwnsHeading("/de/personnel-files/payslip-batches")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/payslip-batches/batch-id")).toBe(true);
	});
	it("adopts payroll, the work-balance directory and selected balance without deeper descendants", () => {
		expect(appPageOwnsHeading("/de/payroll")).toBe(true);
		expect(appPageOwnsHeading("/en/payroll/work-balances")).toBe(true);
		expect(appPageOwnsHeading("/en/payroll/work-balances/employee-1")).toBe(
			true,
		);
		expect(
			appPageOwnsHeading("/en/payroll/work-balances/employee-1/other"),
		).toBe(false);
	});
	it("adopts only the notification timeline heading, retaining settings and descendants", () => {
		expect(appPageOwnsHeading("/de/notifications")).toBe(true);
		expect(appPageOwnsHeading("/en/notifications/other")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/notifications")).toBe(false);
	});
	it("adopts only the personal requests page heading", () => {
		expect(appPageOwnsHeading("/de/my-requests")).toBe(true);
		expect(appPageOwnsHeading("/en/my-requests/detail")).toBe(false);
	});
	it("adopts the personal documents heading without officer descendants", () => {
		expect(appPageOwnsHeading("/de/my-documents")).toBe(true);
		expect(appPageOwnsHeading("/en/my-documents/extra")).toBe(false);
		expect(appPageOwnsHeading("/en/personnel-files/employee-1")).toBe(false);
	});
	it("adopts the personnel file directory while preserving independently staged descendant owners", () => {
		expect(appPageOwnsHeading("/de/personnel-files")).toBe(true);
		expect(appPageOwnsHeading("/en/personnel-files/payslip-batches/id")).toBe(true);
		for (const path of [
			"/en/personnel-files/id",
			"/en/personnel-files/sick-leave",
			"/en/settings/personnel-files",
		])
			expect(appPageOwnsHeading(path)).toBe(false);
	});
	it("adopts equipment overview and exact assignment headings, keeping other descendants independent", () => {
		expect(appPageOwnsHeading("/de/equipment")).toBe(true);
		expect(appPageOwnsHeading("/en/equipment/assignments/id")).toBe(true);
		expect(
			appPageOwnsHeading("/de/equipment/assignments/id?back=%2Fequipment"),
		).toBe(true);
		expect(appPageOwnsHeading("/en/equipment/assignments")).toBe(false);
		expect(appPageOwnsHeading("/en/equipment/assignments/id/extra")).toBe(
			false,
		);
		expect(appPageOwnsHeading("/en/equipment/employees/id/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/equipment")).toBe(false);
	});
	it("adopts the employee equipment record heading without adopting its collection", () => {
		expect(appPageOwnsHeading("/de/equipment/employees/id")).toBe(true);
		expect(appPageOwnsHeading("/en/equipment/employees")).toBe(false);
	});
	it("adopts the licence workspace and employee check while retaining other descendants and settings headings", () => {
		expect(appPageOwnsHeading("/de/driving-licence")).toBe(true);
		expect(appPageOwnsHeading("/en/driving-licence/checks/employee-1")).toBe(
			true,
		);
		expect(
			appPageOwnsHeading("/en/driving-licence/checks/employee-1/detail"),
		).toBe(false);
		expect(appPageOwnsHeading("/en/driving-licence/checks")).toBe(false);
		expect(appPageOwnsHeading("/en/settings/driving-licence")).toBe(false);
	});
	it("retains independent approvals page headings", () => {
		expect(appPageOwnsHeading("/de/approvals")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/inbox")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/review/org/absence/id")).toBe(
			true,
		);
	});
	it("adopts only the deputy history record, preserving other approval headings", () => {
		expect(appPageOwnsHeading("/de/approvals/deputy-decisions/absence-1")).toBe(
			true,
		);
		expect(
			appPageOwnsHeading("/en/approvals/deputy-decisions/absence-1/detail"),
		).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/deputy-decisions")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/inbox")).toBe(true);
	});
	it("adopts the exact inbox heading, retaining independent review route ownership", () => {
		expect(appPageOwnsHeading("/de/approvals/inbox")).toBe(true);
		expect(appPageOwnsHeading("/en/approvals/inbox/detail")).toBe(false);
		expect(appPageOwnsHeading("/en/approvals/review/org/time_entry/id")).toBe(
			true,
		);
	});
	it("adopts only the complete review arrival route", () => {
		expect(appPageOwnsHeading("/de/approvals/review/org/canonical/id")).toBe(
			true,
		);
		expect(appPageOwnsHeading("/en/approvals/review/org/canonical")).toBe(
			false,
		);
		expect(
			appPageOwnsHeading("/en/approvals/review/org/canonical/id/detail"),
		).toBe(false);
	});
	it("adopts the exact vacation route while retaining staged descendants", () => {
		expect(appPageOwnsHeading("/de/analytics/vacation-trends")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/vacation-trends/detail")).toBe(
			false,
		);
	});
	it("adopts only refreshed analytics routes while retaining staged descendants", () => {
		expect(appPageOwnsHeading("/de/analytics/overtime-burn-down")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/overtime-burn-down/detail")).toBe(
			false,
		);
		expect(appPageOwnsHeading("/en/analytics/team-performance")).toBe(true);
		expect(appPageOwnsHeading("/en/analytics/team-performance/detail")).toBe(
			false,
		);
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
		["/en/team/driving", "Driving Details"],
		["/en/driving-licence", "My driving authorization"],
		["/en/driving-licence/checks/employee-1", "My driving authorization"],
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
		expect(normalizeAppPath("/de/settings/security/")).toBe(
			"/settings/security",
		);
	});
});
it("adopts only the exact payslip batch detail heading", () => {
	expect(
		appPageOwnsHeading("/en/personnel-files/payslip-batches/batch-1"),
	).toBe(true);
	expect(
		appPageOwnsHeading("/de/personnel-files/payslip-batches/batch-1/detail"),
	).toBe(false);
});
