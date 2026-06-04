import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./queries.ts", import.meta.url)), "utf8");

function functionBody(name: string): string {
	const start = source.indexOf(`export async function ${name}`);
	if (start === -1) return "";

	const next = source.indexOf("export async function", start + 1);
	return source.slice(start, next === -1 ? undefined : next);
}

describe("time tracking read queries", () => {
	it("excludes deleted work periods from getWorkPeriods", () => {
		expect(functionBody("getWorkPeriods")).toContain("isNull(workPeriod.deletedAt)");
	});

	it("excludes deleted work periods from getTimeSummary", () => {
		expect(functionBody("getTimeSummary")).toContain("isNull(workPeriod.deletedAt)");
	});
});
