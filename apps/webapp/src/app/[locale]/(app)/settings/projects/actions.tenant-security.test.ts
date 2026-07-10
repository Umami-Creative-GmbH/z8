import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectsSource = readFileSync(
	fileURLToPath(new URL("./actions.ts", import.meta.url)),
	"utf8",
);
const projectScopeSource = readFileSync(
	fileURLToPath(new URL("./project-scope.ts", import.meta.url)),
	"utf8",
);
const entryHelpersSource = readFileSync(
	fileURLToPath(new URL("../../time-tracking/actions/entry-helpers.ts", import.meta.url)),
	"utf8",
);
const reportsSource = readFileSync(
	fileURLToPath(new URL("../../reports/projects/actions.ts", import.meta.url)),
	"utf8",
);
const apiRouteSource = readFileSync(
	fileURLToPath(new URL("../../../../api/time-entries/route.ts", import.meta.url)),
	"utf8",
);

function functionBody(source: string, name: string) {
	const start = source.indexOf(`export async function ${name}`);
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("project relationship tenant security", () => {
	it("validates project managers against the project's organization", () => {
		const body = functionBody(projectsSource, "addProjectManager");

		expect(body).toContain("getProjectRelationshipEmployee");
		expect(body).toContain("existingProject.organizationId");
	});

	it("validates team and employee assignment targets against the project's organization", () => {
		const body = functionBody(projectsSource, "addProjectAssignment");

		expect(body).toContain("getProjectAssignmentTarget");
		expect(body).toContain("existingProject.organizationId");
		expect(body).toContain("eq(projectAssignment.organizationId, existingProject.organizationId)");
	});

	it("requires organization scope when validating time-entry project assignments", () => {
		const body = functionBody(entryHelpersSource, "validateProjectAssignment");

		expect(body).toContain("organizationId: string");
		expect(body).toContain("eq(project.organizationId, organizationId)");
		expect(body).toContain("eq(projectAssignment.organizationId, organizationId)");
		const apiValidationCall = apiRouteSource.slice(
			apiRouteSource.indexOf("validateProjectAssignment("),
			apiRouteSource.indexOf(");", apiRouteSource.indexOf("validateProjectAssignment(")),
		);
		expect(apiValidationCall).toContain("requestedOrgId");
	});

	it("scopes project selectors and assigned-project reads to the requested organization", () => {
		for (const name of ["getTeamsForSelection", "getEmployeesForSelection"]) {
			expect(functionBody(projectsSource, name)).toContain("getProjectSettingsActorContext({");
		}

		const assignedProjectsBody = functionBody(entryHelpersSource, "getAssignedProjectsWithHours");
		expect(assignedProjectsBody).toContain("eq(projectAssignment.organizationId, organizationId)");
		expect(projectScopeSource).toContain(
			"const authorizedEmployeeRecord = membershipRecord ? employeeRecord : null",
		);
	});

	it("filters legacy project relationships and aggregates by organization", () => {
		const projectsBody = functionBody(projectsSource, "getProjects");
		const budgetBody = functionBody(entryHelpersSource, "checkProjectBudgetAfterClockOut");

		expect(projectsBody).toContain("manager.employee?.organizationId !== organizationId");
		expect(projectsBody).toContain("assignment.team?.organizationId !== organizationId");
		expect(projectsBody).toContain("assignment.employee?.organizationId !== organizationId");
		expect(projectsBody).toContain("eq(workPeriod.organizationId, organizationId)");
		expect(budgetBody).toContain("eq(project.organizationId, organizationId)");
		expect(budgetBody).toContain("getProjectTotalHours(projectId, organizationId)");
	});

	it("scopes detailed report employees and work periods to the active organization", () => {
		const body = functionBody(reportsSource, "getProjectDetailedReport");

		expect(body).toContain("await requireAuth()");
		expect(body).toContain("authContext.session.activeOrganizationId");
		expect(body).toContain("eq(workPeriod.organizationId, organizationId)");
		expect(functionBody(reportsSource, "getProjectsOverview")).toContain(
			"eq(workPeriod.organizationId, organizationId)",
		);
		expect(functionBody(reportsSource, "getProjectsForFilter")).toContain("await requireAuth()");
		expect(functionBody(reportsSource, "getCurrentEmployeeForReports")).toContain(
			"await requireAuth()",
		);
	});
});
