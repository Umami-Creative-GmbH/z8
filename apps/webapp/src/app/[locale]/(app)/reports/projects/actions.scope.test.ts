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

		expect(source).toContain("getManagedProjectIdsForProjectReports");
		expect(source).toContain(
			'currentEmployee.role === "admin" || currentEmployee.role === "manager"',
		);
		expect(source).toContain("managedProjectIds.size > 0");
		expect(source).toContain("inArray(project.id, [...managedProjectIds])");
	});

	it("uses selected-range hours for report totals and cumulative hours for budget health", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("const [periods, cumulativeStats] = await Promise.all");
		expect(source).toContain(
			"const cumulativeHours = Number(cumulativeStats[0]?.totalMinutes ?? 0) / 60",
		);
		expect(source).toContain("const percentBudgetUsed = budgetHours");
		expect(source).toContain("? (cumulativeHours / budgetHours) * 100");
		expect(source).toContain("rangeHours: totalHours");
		expect(source).toContain("cumulativeHours");
	});

	it("uses organization-local half-open overlap boundaries and split segments", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("lt(workPeriod.startTime, rangeEndExclusive)");
		expect(source).toContain("gt(workPeriod.endTime, rangeStart)");
		expect(source).toContain("reportRange.splitPeriod");
		expect(source).toContain("reportRange.dayCount");
	});

	it("selects the current employee in the active organization", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain(
			'eq(employee.organizationId, session.session.activeOrganizationId ?? "")',
		);
	});

	it("scopes the page-gate employee lookup to the active organization", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/actions.ts`, "utf8"));

		expect(source).toContain("getCurrentEmployeeForReports");
		expect(source).toContain(
			'eq(employee.organizationId, session.session.activeOrganizationId ?? "")',
		);
	});
});
