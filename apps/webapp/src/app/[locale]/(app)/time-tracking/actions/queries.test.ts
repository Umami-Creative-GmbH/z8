import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./queries.ts", import.meta.url)), "utf8");
const actionsSource = readFileSync(fileURLToPath(new URL("../actions.ts", import.meta.url)), "utf8");

function functionBody(sourceText: string, name: string): string {
	const match = new RegExp(`(?:export\\s+)?async function ${name}\\s*\\(`).exec(sourceText);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);

	const next = sourceText.indexOf("export async function", start + 1);
	return sourceText.slice(start, next === -1 ? undefined : next);
}

describe("time tracking read queries", () => {
	it.each(["getWorkPeriods", "getTimeSummary"])(
		"excludes deleted work periods from %s",
		(name) => {
			expect(functionBody(source, name)).toContain("isNull(workPeriod.deletedAt)");
		},
	);

	// The presence widget calls the getPresenceStatus server action in ../actions.ts.
	it("excludes deleted work periods from getPresenceStatus", () => {
		expect(functionBody(actionsSource, "getPresenceStatus")).toContain(
			"isNull(workPeriod.deletedAt)",
		);
	});

	it("requires the current employee and organization for period and summary reads", () => {
		for (const name of ["getWorkPeriods", "getTimeSummary"]) {
			const body = functionBody(source, name);
			expect(body).toContain("const currentEmployee = await getCurrentEmployee()");
			expect(body).toContain("eq(workPeriod.organizationId, currentEmployee.organizationId)");
		}
	});
});
