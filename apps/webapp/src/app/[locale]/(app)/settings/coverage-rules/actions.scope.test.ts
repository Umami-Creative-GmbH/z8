import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COVERAGE_RULES_ROOT = fileURLToPath(new URL(".", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("coverage rule settings scope actions", () => {
	const source = stripComments(readFileSync(join(COVERAGE_RULES_ROOT, "actions.ts"), "utf8"));

	it("scopes managers by subarea instead of employee-role checks", () => {
		expect(source.includes("coverageRuleSubareaScope(")).toBe(true);
		expect(source.includes("getSchedulingSettingsAccessContext(")).toBe(false);
		expect(source.includes('employee.role !== "admin"')).toBe(false);
	});

	it("loads existing rules by ID and the session's organization before reading or changing them", () => {
		expect(source.includes("loadCoverageRuleTarget(organizationId")).toBe(true);
	});
});
