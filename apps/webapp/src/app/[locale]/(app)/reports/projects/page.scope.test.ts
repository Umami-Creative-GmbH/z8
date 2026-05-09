import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORTS_PROJECTS_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("project reports page access gate", () => {
	it("allows admins, managers, and employees assigned as project managers", () => {
		const source = stripComments(readFileSync(`${REPORTS_PROJECTS_ROOT}/page.tsx`, "utf8"));

		expect(source).toContain("getCurrentEmployeeProjectReportAccess");
		expect(source).toContain("canViewProjectReports");
		expect(source).not.toContain('employee.role !== "admin" && employee.role !== "manager"');
	});
});
