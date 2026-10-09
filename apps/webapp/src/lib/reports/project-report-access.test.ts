import { describe, expect, it } from "vitest";
import {
	billableFiguresAccessFor,
	canViewProjectReport,
	canViewProjectReports,
	type ProjectReportViewer,
} from "./project-report-access";

const MANAGED = "managed-project";
const OTHER = "other-project";

function viewer(overrides: Partial<ProjectReportViewer> = {}): ProjectReportViewer {
	return {
		employeeRole: "employee",
		isOrganizationAdmin: false,
		managedProjectIds: new Set(),
		...overrides,
	};
}

describe("project report access", () => {
	it("gives owners and admins of the organization every project with cost and margin", () => {
		const owner = viewer({ isOrganizationAdmin: true });

		expect(canViewProjectReport(owner, OTHER)).toBe(true);
		expect(billableFiguresAccessFor(owner, OTHER)).toBe("full");
	});

	it("gives project managers their projects with revenue only", () => {
		const manager = viewer({ managedProjectIds: new Set([MANAGED]) });

		expect(canViewProjectReports(manager)).toBe(true);
		expect(canViewProjectReport(manager, MANAGED)).toBe(true);
		expect(canViewProjectReport(manager, OTHER)).toBe(false);
		expect(billableFiguresAccessFor(manager, MANAGED)).toBe("revenue");
		expect(billableFiguresAccessFor(manager, OTHER)).toBeNull();
	});

	it("keeps team managers at hours: every project, no Billable Time figures", () => {
		const teamManager = viewer({ employeeRole: "manager" });

		expect(canViewProjectReport(teamManager, OTHER)).toBe(true);
		expect(billableFiguresAccessFor(teamManager, OTHER)).toBeNull();
	});

	it("gives employees role admin without an admin membership no money", () => {
		const employeeAdmin = viewer({ employeeRole: "admin" });

		expect(canViewProjectReport(employeeAdmin, OTHER)).toBe(true);
		expect(billableFiguresAccessFor(employeeAdmin, OTHER)).toBeNull();
	});

	it("keeps employees who manage no project out of project reports", () => {
		expect(canViewProjectReports(viewer())).toBe(false);
	});
});
