import { describe, expect, it } from "vitest";
import source from "./page.tsx?raw";

describe("EmployeeAllowancesContent timezone ownership", () => {
	it("loads the authorized active organization's timezone before computing its year", () => {
		const authorization = source.indexOf("requireOrgAdminSettingsAccess()");
		const timezoneLookup = source.indexOf("db.query.organization.findFirst");
		const connection = source.indexOf("await connection()", timezoneLookup);
		const yearComputation = source.indexOf(
			"const currentYear = calendarYearAt(",
			connection,
		);

		expect(authorization).toBeGreaterThan(-1);
		expect(timezoneLookup).toBeGreaterThan(authorization);
		expect(source).toContain("where: eq(organization.id, organizationId)");
		expect(source).toContain("columns: { timezone: true }");
		expect(source).toMatch(
			/resolveOrganizationTimezone\(\s*ownedOrganization\?\.timezone,?\s*\)\.timezone/,
		);
		expect(connection).toBeGreaterThan(timezoneLookup);
		expect(yearComputation).toBeGreaterThan(connection);
		expect(
			source
				.slice(connection + "await connection();".length, yearComputation)
				.trim(),
		).toBe("");
		expect(source).not.toContain("new Date().getFullYear()");
	});

	it("keeps the allowance query scoped to the authorized organization and computed year", () => {
		expect(source).toContain(
			"getEmployeesWithAllowances(organizationId, currentYear)",
		);
	});
});
