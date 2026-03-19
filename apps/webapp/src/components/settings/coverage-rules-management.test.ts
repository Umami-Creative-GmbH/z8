import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("coverage rules management query gating", () => {
	it("only fetches org-wide coverage settings when the panel is visible", () => {
		const source = readFileSync(new URL("./coverage-rules-management.tsx", import.meta.url), "utf8");

		expect(source.includes("enabled: canManageCoverageSettings")).toBe(true);
	});
});
