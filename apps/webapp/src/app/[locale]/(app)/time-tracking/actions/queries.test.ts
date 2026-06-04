import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./queries.ts", import.meta.url)), "utf8");
const legacySource = readFileSync(fileURLToPath(new URL("../actions.ts", import.meta.url)), "utf8");

function functionBody(sourceText: string, name: string): string {
	const match = new RegExp(`(?:export\\s+)?async function ${name}\\s*\\(`).exec(sourceText);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);

	const next = sourceText.indexOf("export async function", start + 1);
	return sourceText.slice(start, next === -1 ? undefined : next);
}

describe("time tracking read queries", () => {
	it.each([
		["modular", source],
		["legacy", legacySource],
	])("excludes deleted work periods from %s getWorkPeriods", (_name, sourceText) => {
		expect(functionBody(sourceText, "getWorkPeriods")).toContain("isNull(workPeriod.deletedAt)");
	});

	it.each([
		["modular", source],
		["legacy", legacySource],
	])("excludes deleted work periods from %s getTimeSummary", (_name, sourceText) => {
		expect(functionBody(sourceText, "getTimeSummary")).toContain("isNull(workPeriod.deletedAt)");
	});
});
