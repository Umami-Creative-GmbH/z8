import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COVERAGE_RULES_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("coverage rule settings scope actions", () => {
	it("uses the shared scheduling scope helper instead of employee-role checks", () => {
		const source = stripComments(readFileSync(join(COVERAGE_RULES_ROOT, "actions.ts"), "utf8"));

		expect(source.includes("getSchedulingSettingsAccessContext(")).toBe(true);
		expect(source.includes("canManageScopedSchedulingSubarea(")).toBe(true);
		expect(source.includes("filterItemsToManageableSubareas(")).toBe(true);
		expect(source.includes('authContext.employee.role !== "admin"')).toBe(false);
		expect(source.includes('authContext.employee.role !== "manager"')).toBe(false);
	});

	it("checks existing rule targets before update and delete mutations", () => {
		const source = stripComments(readFileSync(join(COVERAGE_RULES_ROOT, "actions.ts"), "utf8"));

		expect(source.includes("getCoverageRuleScopeTarget(")).toBe(true);
		expect(source.includes("canManageScopedSchedulingSubarea(")).toBe(true);
	});

	it("keeps org-wide coverage read actions off manager scope", () => {
		const source = stripComments(readFileSync(join(COVERAGE_RULES_ROOT, "actions.ts"), "utf8"));

		expect(source.includes('accessContext.accessTier !== "orgAdmin"')).toBe(true);
	});
});
