import { describe, expect, it } from "vitest";
import { normalizeAppPath, resolveAppRouteMetadata } from "./route-metadata";

describe("route metadata", () => {
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
		["/en/reports/projects", "Project Reports"],
		["/en/settings/employees/employee-1", "Employees"],
		["/en/settings/locations/location-1", "Locations"],
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
