import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readClockOutSource() {
	return readFileSync(fileURLToPath(new URL("./clock-out.ts", import.meta.url)), "utf8");
}

describe("Teams clock-out command work balance invalidation", () => {
	it("marks the employee work balance dirty after closing the active period", () => {
		const source = readClockOutSource();
		const updateIndex = source.indexOf(".update(workPeriod)");
		const dirtyIndex = source.indexOf("await markEmployeeWorkBalanceDirty");

		expect(source).toContain(
			'import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service"',
		);
		expect(source).toContain("dirtyFromDate:");
		expect(source).toContain("DateTime.fromJSDate(activePeriod.startTime, { zone: \"utc\" }).toISODate()");
		expect(updateIndex).toBeGreaterThanOrEqual(0);
		expect(dirtyIndex).toBeGreaterThan(updateIndex);
	});

	it("logs dirty marker failures without failing the command", () => {
		const source = readClockOutSource();

		expect(source).toContain("try {");
		expect(source).toContain("catch (error) {");
		expect(source).toContain("Failed to mark work balance dirty after Teams clock-out");
	});
});
