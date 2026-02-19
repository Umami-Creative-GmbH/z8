import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("overtime burn-down page source", () => {
	it("contains action wiring and effect-based loading", () => {
		const source = readFileSync(new URL("./overtime-burn-down/page.tsx", import.meta.url), "utf8");

		expect(source).toContain("getOvertimeBurnDownData");
		expect(source).toContain('from "../actions"');
		expect(source).toContain("useEffect(() => {");
		expect(source).toContain("await getOvertimeBurnDownData(");
		expect(source).toContain("[dateRange, teamId, costCenterId, managerId]");
	});

	it("contains required headings, filter labels, and breakdown labels", () => {
		const source = readFileSync(new URL("./overtime-burn-down/page.tsx", import.meta.url), "utf8");

		expect(source).toContain("Overtime Burn-Down");
		expect(source).toContain("Current Overtime");
		expect(source).toContain("Week-over-Week");
		expect(source).toContain("Improving Groups");
		expect(source).toContain("Trend Direction");
		expect(source).toContain("Weekly Burn-Down Trend");
		expect(source).toContain("Breakdown");
		expect(source).toContain("Team");
		expect(source).toContain("Cost Center");
		expect(source).toContain("Manager");
		expect(source).toContain("By Team");
		expect(source).toContain("By Cost Center");
		expect(source).toContain("By Manager");
	});

	it("contains export button wiring and overtime burndown filename prefix", () => {
		const source = readFileSync(new URL("./overtime-burn-down/page.tsx", import.meta.url), "utf8");

		expect(source).toContain("ExportButton");
		expect(source).toContain("overtime-burndown-");
	});
});
