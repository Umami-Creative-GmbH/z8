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
const clockOutEffectsSource = readFileSync(
	fileURLToPath(
		new URL("../../../../../lib/time-tracking/clock-out-effects.ts", import.meta.url),
	),
	"utf8",
);
const projectEligibilitySource = readFileSync(
	fileURLToPath(
		new URL("../../../../../lib/time-tracking/project-eligibility.ts", import.meta.url),
	),
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

const projectReportWorkSource = readFileSync(
	fileURLToPath(new URL("../../../../../lib/reports/project-report-work.ts", import.meta.url)),
	"utf8",
);

function functionBody(source: string, name: string) {
	const start = source.indexOf(`export async function ${name}`);
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

/** A module-private function's source, up to the next top-level declaration. */
function privateFunctionBody(source: string, name: string) {
	const start = source.indexOf(`\nfunction ${name}(`);
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const next = source.slice(start + 1).search(/\n(?:export |async |function |const |type )/);
	return source.slice(start, next === -1 ? undefined : start + 1 + next);
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
		expect(body).toContain("isProjectEligible({ employeeId, teamId, organizationId }");
		expect(body).toContain("eq(project.organizationId, organizationId)");
		// The shared rule scopes both the project and its assignment.
		expect(projectEligibilitySource).toContain("eq(project.organizationId, target.organizationId)");
		expect(projectEligibilitySource).toContain(
			"eq(projectAssignment.organizationId, target.organizationId)",
		);
		// The legacy route leaves project eligibility to the Clocking module (#483).
		expect(apiRouteSource).toContain("clocking.run(");
		expect(apiRouteSource).not.toContain("validateProjectAssignment(");
	});

	it("scopes project selectors and assigned-project reads to the requested organization", () => {
		for (const name of ["getTeamsForSelection", "getEmployeesForSelection"]) {
			expect(functionBody(projectsSource, name)).toContain("getProjectSettingsActorContext({");
		}

		const assignedProjectsBody = functionBody(entryHelpersSource, "getAssignedProjectsWithHours");
		expect(assignedProjectsBody).toContain(
			"listEligibleProjects({ employeeId, teamId, organizationId })",
		);
		expect(projectScopeSource).toContain(
			"const authorizedEmployeeRecord = membershipRecord ? employeeRecord : null",
		);
	});

	it("filters legacy project relationships and aggregates by organization", () => {
		const projectsBody = functionBody(projectsSource, "getProjects");
		const budgetBody = functionBody(clockOutEffectsSource, "checkProjectBudgetAfterClockOut");

		expect(projectsBody).toContain("manager.employee?.organizationId !== organizationId");
		expect(projectsBody).toContain("assignment.team?.organizationId !== organizationId");
		expect(projectsBody).toContain("assignment.employee?.organizationId !== organizationId");
		expect(projectsBody).toContain("eq(workPeriod.organizationId, organizationId)");
		expect(budgetBody).toContain("eq(project.organizationId, organizationId)");
		expect(budgetBody).toContain("getProjectTotalHours(projectId, organizationId)");
	});

	it("scopes detailed report employees and work periods to the active organization", () => {
		const body = functionBody(reportsSource, "getProjectDetailedReport");
		const readerBody = privateFunctionBody(reportsSource, "projectReportReader");

		// The shared report reader authenticates and takes the active organization.
		expect(body).toContain("yield* projectReportReader()");
		expect(readerBody).toContain("await requireAuth()");
		expect(readerBody).toContain("authContext.session.activeOrganizationId");
		// Employees and work are read in that organization only (#902 moved the work query).
		expect(body).toContain("eq(employee.organizationId, organizationId)");
		expect(body).toContain("loadReportedProjectWork(dbService.db, organizationId");
		const workBody = functionBody(projectReportWorkSource, "loadReportedProjectWork");
		expect(workBody).toContain("eq(workPeriod.organizationId, organizationId)");
		expect(workBody).toContain("eq(project.organizationId, organizationId)");
		expect(functionBody(reportsSource, "getProjectsOverview")).toContain(
			"eq(workPeriod.organizationId, organizationId)",
		);
		expect(functionBody(reportsSource, "getProjectsForFilter")).toContain("await requireAuth()");
		expect(functionBody(reportsSource, "getCurrentEmployeeForReports")).toContain(
			"await requireAuth()",
		);
	});
});
