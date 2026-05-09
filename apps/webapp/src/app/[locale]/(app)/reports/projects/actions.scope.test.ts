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
});
