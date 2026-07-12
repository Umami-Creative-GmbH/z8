import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROJECT_REPORTS_ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("ProjectReportsContainer report action boundary", () => {
	it("converts string report ranges to Date values for server actions", () => {
		const source = readFileSync(`${PROJECT_REPORTS_ROOT}/project-reports-container.tsx`, "utf8");

		expect(source).toMatch(
			/getProjectsOverview\(\s*new Date\(range\.startDate\),\s*new Date\(range\.endDate\)/,
		);
		expect(source).toContain("new Date(dateRange.startDate)");
		expect(source).toContain("new Date(dateRange.endDate)");
	});
});
