import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROJECT_REPORTS_ROOT = fileURLToPath(new URL(".", import.meta.url));

describe("ProjectReportsContainer report action boundary", () => {
	it("sends the report range's calendar days to the server actions as ISO day strings", () => {
		const source = readFileSync(`${PROJECT_REPORTS_ROOT}/project-reports-container.tsx`, "utf8");

		expect(source).toMatch(/getProjectsOverview\(\s*range\.startDate,\s*range\.endDate/);
		expect(source).toMatch(
			/getProjectDetailedReport\(\s*projectId,\s*dateRange\.startDate,\s*dateRange\.endDate/,
		);
		expect(source).not.toContain("new Date(");
	});
});
