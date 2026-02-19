import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("analytics layout tabs", () => {
	it("includes overtime burn-down navigation tab", () => {
		const source = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");

		expect(source).toContain("Overtime Burn-Down");
		expect(source).toContain('href="/analytics/overtime-burn-down"');
	});
});
