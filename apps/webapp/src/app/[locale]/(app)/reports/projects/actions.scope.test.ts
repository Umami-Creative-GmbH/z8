import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORTS_PROJECTS_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("project report portfolio scope", () => {
	it("allows assigned project managers and scopes them to managed projects", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		// Who may read which project: lib/reports/project-report-access.ts (tested there).
		expect(source).toContain("loadProjectReportViewer");
		expect(source).toContain("if (!canViewProjectReports(viewer))");
		expect(source).toContain("if (!canViewProjectReport(viewer, projectId))");
		expect(source).toContain("inArray(project.id, [...viewer.managedProjectIds])");
	});

	it("uses selected-range hours for report totals and cumulative hours for budget health", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("loadReportedProjectWork(dbService.db, organizationId");
		expect(source).toContain("const cumulativeHours = (cumulativeMinutes.get(p.id) ?? 0) / 60");
		expect(source).toContain("const percentBudgetUsed = budgetHours");
		expect(source).toContain("? (cumulativeHours / budgetHours) * 100");
		expect(source).toContain("rangeHours: totalHours");
		expect(source).toContain("cumulativeHours");
	});

	it("scopes project and work-period queries to the active organization", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("const organizationId = authContext.session.activeOrganizationId");
		expect(source).toContain("const currentEmployee = authContext.employee");
		expect(source).toContain("eq(project.organizationId, organizationId)");
		expect(source).toContain("eq(workPeriod.organizationId, organizationId)");
	});

	it("uses the active-organization employee supplied by requireAuth", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("const currentEmployee = authContext.employee");
		expect(source).toContain("if (!organizationId || !currentEmployee)");
	});

	it("scopes the page-gate employee lookup to the active organization", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("getCurrentEmployeeForReports");
		expect(source).toContain(
			'eq(employee.organizationId, authContext.session.activeOrganizationId ?? "")',
		);
	});

	it("serializes detailed report period boundaries as ISO strings", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("startDate: startDate.toISOString()");
		expect(source).toContain("endDate: endDate.toISOString()");
	});
});
